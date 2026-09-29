'use strict';

const crypto = require('node:crypto');
const { clamp, brightnessAt } = require('./curves');
const { occurrencesBetween, nextOccurrence } = require('./schedule');

class Controller {
  constructor({ adapter, storage, clock = () => Date.now(), emit = () => {} }) {
    this.adapter = adapter;
    this.storage = storage;
    this.clock = clock;
    this.emit = emit;
    this.monitors = [];
    this.ramps = [];
    const saved = storage.load();
    this.schedules = saved.schedules || [];
    this.settings = { hotkeys: true, idleMinutes: 0, idleBrightness: 15, night: 20, work: 80, ...saved.settings };
    this.limits = saved.limits || {};
    this.idle = false;
    this.ramps = (saved.ramps || []).filter(r => r && Number.isFinite(r.endsAt));
    this.lastTick = this.clock();
    this.lastWrite = new Map();
    this.error = null;
    this.busy = false;
    this.writes = new Map();
    this.revisions = new Map();
  }

  snapshot() {
    const now = this.clock();
    return {
      monitors: this.monitors,
      settings: this.settings, limits: this.limits, idle: this.idle,
      ramps: this.ramps.map(r => ({ ...r, current: brightnessAt(r, now) })),
      schedules: this.schedules.map(s => ({ ...s, nextAt: nextOccurrence(s, now)?.at || null })),
      error: this.error,
      now,
      demo: !!this.adapter.demo
    };
  }

  notify() { this.emit(this.snapshot()); }
  save() { this.storage.save({ schedules: this.schedules, ramps: this.ramps, settings: this.settings, limits: this.limits }); }

  limited(id, value, offset = true) {
    const limit = this.limits[id] || { min: 0, max: 100, offset: 0 };
    return Math.round(clamp(value + (offset ? limit.offset : 0), limit.min, limit.max));
  }

  configure({ settings, monitorId, limits }) {
    if (settings) {
      const next = { ...this.settings, ...settings };
      for (const [key, max] of [['idleMinutes', 1440], ['idleBrightness', 100], ['night', 100], ['work', 100]]) {
        if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > max) throw Error('Enter valid brightness and idle settings.');
      }
      this.settings = { ...next, hotkeys: !!next.hotkeys };
    }
    if (limits) {
      if (!this.monitors.some(m => m.id === monitorId)) throw Error('Choose a connected display.');
      const { min, max, offset } = limits;
      if (![min, max, offset].every(Number.isFinite) || min < 0 || max > 100 || min > max || Math.abs(offset) > 100) throw Error('Limits must be 0–100 with minimum no higher than maximum.');
      this.limits[monitorId] = { min, max, offset };
      for (const ramp of this.ramps.filter(r => r.monitorId === monitorId)) {
        ramp.from = this.limited(monitorId, ramp.from, false); ramp.target = this.limited(monitorId, ramp.target, false);
      }
      this.lastWrite.delete(monitorId);
    }
    this.save(); this.notify();
  }

  async preset(name) {
    if (!['night', 'work'].includes(name)) throw Error('Unknown preset.');
    return this.setNow({ monitorId: 'all', target: this.settings[name] });
  }

  async adjust(delta) {
    const results = await Promise.allSettled(this.monitors.map(m => this.setNow({ monitorId: m.id, target: clamp(m.brightness + delta), calibrated: true })));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
  }

  async updateIdle(seconds) {
    const idle = this.settings.idleMinutes > 0 && seconds >= this.settings.idleMinutes * 60;
    if (idle === this.idle) return;
    this.idle = idle;
    const results = await Promise.allSettled(this.monitors.map(m => this.write(m.id, () => {
      const ramp = this.ramps.find(r => r.monitorId === m.id);
      return ramp ? brightnessAt(ramp, this.clock()) : this.monitors.find(current => current.id === m.id)?.brightness ?? m.brightness;
    })));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) this.error = `Idle brightness failed: ${failed.reason.message}`;
    this.notify();
  }

  async refresh() {
    try {
      const revisions = new Map(this.revisions);
      const found = await this.adapter.list();
      this.monitors = found.map(m => {
        const previous = this.monitors.find(old => old.id === m.id);
        if (previous && (this.idle || revisions.get(m.id) !== this.revisions.get(m.id))) return { ...m, brightness: previous.brightness };
        const ramp = this.ramps.find(r => r.monitorId === m.id);
        return ramp ? { ...m, brightness: brightnessAt(ramp, this.clock()) } : m;
      });
      this.error = null;
      const legacy = [...this.schedules, ...this.ramps].some(item => /^ddc:-?\d+:/.test(item.monitorId) && !found.some(m => m.id === item.monitorId));
      if (legacy) this.error = 'An older saved transition or schedule uses a display-position ID. Recreate it for the connected display to use its stable device ID.';
      this.notify();
    } catch (err) { this.error = `Could not find displays: ${err.message}`; this.notify(); }
  }

  targets(monitorId) {
    return monitorId === 'all' ? [...this.monitors] : this.monitors.filter(m => m.id === monitorId);
  }

  write(id, value, valid = () => true) {
    const next = (this.writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (!valid()) return false;
      const requested = typeof value === 'function' ? value() : value;
      await this.adapter.set(id, this.limited(id, this.idle ? Math.min(requested, this.settings.idleBrightness) : requested, false));
      return true;
    });
    this.writes.set(id, next);
    return next;
  }

  async resume() { await this.refresh(); await this.tick(); }

  async setNow({ monitorId, target, calibrated = false }) {
    target = clamp(Math.round(Number(target)));
    if (!Number.isFinite(target)) throw Error('Enter a brightness from 0 to 100.');
    const targets = this.targets(monitorId);
    if (!targets.length) throw Error('This display is disconnected. Refresh displays and try again.');
    this.ramps = this.ramps.filter(r => !targets.some(m => m.id === r.monitorId));
    for (const monitor of targets) this.revisions.set(monitor.id, (this.revisions.get(monitor.id) || 0) + 1);
    this.save();
    const results = await Promise.allSettled(targets.map(async monitor => {
      const value = this.limited(monitor.id, target, !calibrated);
      await this.write(monitor.id, value);
      monitor.brightness = value;
      this.lastWrite.delete(monitor.id);
    }));
    this.save();
    const failed = results.find(r => r.status === 'rejected');
    this.error = failed ? failed.reason.message : null;
    this.notify();
    if (failed) throw failed.reason;
  }

  async start({ monitorId, target, durationMinutes, curve = 'linear' }, startsAt = this.clock()) {
    target = Number(target); durationMinutes = Number(durationMinutes);
    if (!Number.isFinite(target) || target < 0 || target > 100) throw Error('Enter a brightness from 0 to 100.');
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) throw Error('Duration must be 0–1440 minutes.');
    if (!['linear', 'perceptual', 'front', 'late'].includes(curve)) throw Error('Choose a valid curve.');
    if (durationMinutes === 0) return this.setNow({ monitorId, target });
    const targets = this.targets(monitorId);
    if (!targets.length) throw Error('This display is disconnected. Refresh displays and try again.');
    const now = this.clock();
    for (const monitor of targets) {
      const previous = this.ramps.find(r => r.monitorId === monitor.id);
      const from = this.limited(monitor.id, previous ? brightnessAt(previous, now) : monitor.brightness, false);
      this.revisions.set(monitor.id, (this.revisions.get(monitor.id) || 0) + 1);
      this.ramps = this.ramps.filter(r => r.monitorId !== monitor.id);
      this.ramps.push({ monitorId: monitor.id, from, target: this.limited(monitor.id, target), curve, startsAt, endsAt: startsAt + durationMinutes * 60000 });
      this.lastWrite.delete(monitor.id);
    }
    this.save();
    this.error = null;
    this.notify();
  }

  cancel(monitorId) {
    this.ramps = this.ramps.filter(r => monitorId === 'all' ? false : r.monitorId !== monitorId);
    this.save();
    this.notify();
  }

  addSchedule(data) {
    const { monitorId, target, durationMinutes, curve, kind, startAt, time, days } = data;
    if (monitorId !== 'all' && !this.monitors.some(m => m.id === monitorId)) throw Error('Choose a connected display.');
    if (!Number.isFinite(Number(target)) || target < 0 || target > 100) throw Error('Enter a brightness from 0 to 100.');
    if (!Number.isFinite(Number(durationMinutes)) || durationMinutes < 0 || durationMinutes > 1440) throw Error('Duration must be 0–1440 minutes.');
    if (!['linear', 'perceptual', 'front', 'late'].includes(curve)) throw Error('Choose a valid curve.');
    if (kind === 'once') {
      if (!Number.isFinite(new Date(startAt).getTime()) || new Date(startAt).getTime() <= this.clock()) throw Error('Choose a future date and time.');
    } else if (kind === 'repeat') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw Error('Choose a time and at least one day.');
    } else if (kind === 'solar') {
      if (!['sunrise', 'sunset'].includes(data.event) || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180 || !Number.isFinite(data.offsetMinutes) || Math.abs(data.offsetMinutes) > 720 || !Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw Error('Choose valid solar coordinates, offset and days.');
    } else throw Error('Choose one time, repeat days, or sunrise/sunset.');
    const schedule = { id: crypto.randomUUID(), enabled: true, monitorId, target: Math.round(Number(target)), durationMinutes: Number(durationMinutes), curve, kind, startAt: kind === 'once' ? new Date(startAt).toISOString() : undefined, time: kind === 'repeat' ? time : undefined, days: kind === 'repeat' ? days : undefined };
    this.schedules.push(schedule);
    if (kind === 'solar') Object.assign(schedule, { event: data.event, latitude: data.latitude, longitude: data.longitude, offsetMinutes: data.offsetMinutes, days });
    this.save(); this.notify();
    return schedule;
  }

  removeSchedule(id) { this.schedules = this.schedules.filter(s => s.id !== id); this.save(); this.notify(); }
  toggleSchedule(id) { const s = this.schedules.find(s => s.id === id); if (s) { s.enabled = !s.enabled; this.save(); this.notify(); } }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    const now = this.clock();
    try {
      let tickError = null;
      // Ramps last at most 24 hours; older occurrences cannot still be active.
      const after = Math.max(this.lastTick, now - 86400000);
      const events = this.schedules.flatMap(s => occurrencesBetween(s, after, now).map(o => ({ s, ...o })));
      events.sort((a, b) => a.at - b.at);
      if (events.length) await this.refresh();
      const latest = new Map();
      for (const event of events) {
        for (const monitor of this.targets(event.s.monitorId)) latest.set(monitor.id, event);
      }
      for (const event of events) {
        const { s, key, at } = event;
        try {
          if (at + s.durationMinutes * 60000 > now || now - this.lastTick <= 60000) {
            const targets = this.targets(s.monitorId).filter(m => latest.get(m.id) === event);
            if (!this.targets(s.monitorId).length) throw Error('The scheduled display is disconnected.');
            for (const monitor of targets) await this.start({ ...s, monitorId: monitor.id }, at);
          }
          if (s.kind === 'once') { s.firedAt = new Date(now).toISOString(); s.enabled = false; }
          else s.lastFiredKey = key;
          this.save();
        } catch (err) { tickError = `Schedule failed: ${err.message}`; }
      }
      await Promise.all([...this.ramps].map(async ramp => {
        if (!this.ramps.includes(ramp)) return;
        const value = brightnessAt(ramp, now);
        const last = this.lastWrite.get(ramp.monitorId);
        if (last?.value !== value && (!last || now - last.at >= 1800 || now >= ramp.endsAt)) {
          try {
            if (!await this.write(ramp.monitorId, value, () => this.ramps.includes(ramp))) return;
            if (!this.ramps.includes(ramp)) return;
            this.lastWrite.set(ramp.monitorId, { value, at: now });
            const monitor = this.monitors.find(m => m.id === ramp.monitorId);
            if (monitor) monitor.brightness = value;
            this.error = null;
          } catch (err) { tickError = `Brightness change failed: ${err.message}`; }
        }
        if (now >= ramp.endsAt && this.lastWrite.get(ramp.monitorId)?.value === ramp.target) {
          this.ramps = this.ramps.filter(r => r !== ramp);
          this.lastWrite.delete(ramp.monitorId);
          this.save();
        }
      }));
      if (tickError) this.error = tickError;
    } finally { this.lastTick = now; this.busy = false; this.notify(); }
  }
}

module.exports = { Controller };
