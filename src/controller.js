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
    this.ramps = (saved.ramps || []).filter(r => r && Number.isFinite(r.endsAt));
    this.lastTick = this.clock();
    this.lastWrite = new Map();
    this.error = null;
    this.busy = false;
  }

  snapshot() {
    const now = this.clock();
    return {
      monitors: this.monitors,
      ramps: this.ramps.map(r => ({ ...r, current: brightnessAt(r, now) })),
      schedules: this.schedules.map(s => ({ ...s, nextAt: nextOccurrence(s, now)?.at || null })),
      error: this.error,
      now,
      demo: !!this.adapter.demo
    };
  }

  notify() { this.emit(this.snapshot()); }
  save() { this.storage.save({ schedules: this.schedules, ramps: this.ramps }); }

  async refresh() {
    try {
      const found = await this.adapter.list();
      this.monitors = found.map(m => {
        const ramp = this.ramps.find(r => r.monitorId === m.id);
        return ramp ? { ...m, brightness: brightnessAt(ramp, this.clock()) } : m;
      });
      this.error = null;
      this.notify();
    } catch (err) { this.error = `Could not find displays: ${err.message}`; this.notify(); }
  }

  targets(monitorId) {
    return monitorId === 'all' ? [...this.monitors] : this.monitors.filter(m => m.id === monitorId);
  }

  async setNow({ monitorId, target }) {
    target = clamp(Math.round(Number(target)));
    if (!Number.isFinite(target)) throw Error('Enter a brightness from 0 to 100.');
    const targets = this.targets(monitorId);
    if (!targets.length) throw Error('This display is disconnected. Refresh displays and try again.');
    for (const monitor of targets) {
      this.ramps = this.ramps.filter(r => r.monitorId !== monitor.id);
      this.save();
      await this.adapter.set(monitor.id, target);
      monitor.brightness = target;
      this.lastWrite.delete(monitor.id);
    }
    this.save();
    this.error = null;
    this.notify();
  }

  async start({ monitorId, target, durationMinutes, curve = 'linear' }) {
    target = Number(target); durationMinutes = Number(durationMinutes);
    if (!Number.isFinite(target) || target < 0 || target > 100) throw Error('Enter a brightness from 0 to 100.');
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) throw Error('Duration must be 0–1440 minutes.');
    if (!['linear', 'front', 'late'].includes(curve)) throw Error('Choose a valid curve.');
    if (durationMinutes === 0) return this.setNow({ monitorId, target });
    const targets = this.targets(monitorId);
    if (!targets.length) throw Error('This display is disconnected. Refresh displays and try again.');
    const now = this.clock();
    for (const monitor of targets) {
      const previous = this.ramps.find(r => r.monitorId === monitor.id);
      const from = previous ? brightnessAt(previous, now) : monitor.brightness;
      this.ramps = this.ramps.filter(r => r.monitorId !== monitor.id);
      this.ramps.push({ monitorId: monitor.id, from, target: Math.round(target), curve, startsAt: now, endsAt: now + durationMinutes * 60000 });
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
    if (!['linear', 'front', 'late'].includes(curve)) throw Error('Choose a valid curve.');
    if (kind === 'once') {
      if (!Number.isFinite(new Date(startAt).getTime()) || new Date(startAt).getTime() <= this.clock()) throw Error('Choose a future date and time.');
    } else if (kind === 'repeat') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw Error('Choose a time and at least one day.');
    } else throw Error('Choose one time or repeat days.');
    const schedule = { id: crypto.randomUUID(), enabled: true, monitorId, target: Math.round(Number(target)), durationMinutes: Number(durationMinutes), curve, kind, startAt: kind === 'once' ? new Date(startAt).toISOString() : undefined, time: kind === 'repeat' ? time : undefined, days: kind === 'repeat' ? days : undefined };
    this.schedules.push(schedule);
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
      // Cap the catch-up window: a sleeping PC should not execute stale events.
      const after = Math.max(this.lastTick, now - 60000);
      const events = this.schedules.flatMap(s => occurrencesBetween(s, after, now).map(o => ({ s, ...o })));
      events.sort((a, b) => a.at - b.at);
      if (events.length) await this.refresh();
      for (const { s, key } of events) {
        try {
          await this.start(s);
          if (s.kind === 'once') { s.firedAt = new Date(now).toISOString(); s.enabled = false; }
          else s.lastFiredKey = key;
          this.save();
        } catch (err) { this.error = `Schedule failed: ${err.message}`; }
      }
      for (const ramp of [...this.ramps]) {
        const value = brightnessAt(ramp, now);
        const last = this.lastWrite.get(ramp.monitorId);
        if (last?.value !== value && (!last || now - last.at >= 1800 || now >= ramp.endsAt)) {
          try {
            await this.adapter.set(ramp.monitorId, value);
            this.lastWrite.set(ramp.monitorId, { value, at: now });
            const monitor = this.monitors.find(m => m.id === ramp.monitorId);
            if (monitor) monitor.brightness = value;
            this.error = null;
          } catch (err) { this.error = `Brightness change failed: ${err.message}`; }
        }
        if (now >= ramp.endsAt && this.lastWrite.get(ramp.monitorId)?.value === ramp.target) {
          this.ramps = this.ramps.filter(r => r !== ramp);
          this.lastWrite.delete(ramp.monitorId);
          this.save();
        }
      }
    } finally { this.lastTick = now; this.busy = false; this.notify(); }
  }
}

module.exports = { Controller };
