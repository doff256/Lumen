'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

class MonitorSession {
  constructor({ spawnProcess = spawn, timeout = 5000 } = {}) {
    this.spawn = spawnProcess; this.timeout = timeout; this.number = 0;
    this.pending = new Map(); this.closed = false; this.process = null;
  }
  start() {
    const file = path.join(__dirname, 'native.exe').replace('app.asar', 'app.asar.unpacked');
    const child = this.spawn(file, ['serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child; let buffer = '', diagnostic = '';
    const fail = error => { if (this.process === child) this.fail(error); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.process !== child) return;
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/^\uFEFF/, '').trim(); buffer = buffer.slice(end + 1);
        try {
          const response = JSON.parse(line), request = this.pending.get(response.id);
          if (!request) continue;
          clearTimeout(request.timer); this.pending.delete(response.id);
          response.error ? request.reject(Error(response.error)) : request.resolve(response.result);
        } catch { fail(Error('Invalid monitor response.')); return; }
      }
    });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-500); });
    child.stdin.on('error', fail); child.on('error', fail);
    child.on('close', code => fail(Error(diagnostic || `Monitor helper stopped (${code}).`)));
  }
  fail(error) {
    const child = this.process; this.process = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); child?.kill();
  }
  request(op, fields = {}) {
    if (this.closed) return Promise.reject(Error('Monitor service is closed.'));
    return new Promise((resolve, reject) => {
      if (!this.process) this.start();
      const id = ++this.number;
      const timer = setTimeout(() => this.fail(Error('Display response timed out. Check the connection and DDC/CI.')), this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.process.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n'); }
      catch (error) { this.fail(error); }
    });
  }
  close() { this.closed = true; this.fail(Error('Monitor service is closed.')); }
}

function identify(displays) {
  const counts = new Map();
  for (const m of displays) if (m.edidId) counts.set(m.edidId, (counts.get(m.edidId) || 0) + 1);
  return displays.map(m => ({ ...m, transportId: m.id, id: m.edidId && counts.get(m.edidId) === 1 ? m.edidId : m.id, aliases: [m.id] }));
}

function instanceKey(id) {
  if (id.startsWith('wmi:')) return id.slice(4).replace(/_\d+$/, '').toUpperCase();
  const parts = id.split('#');
  return parts.length >= 3 ? `DISPLAY\\${parts[1]}\\${parts[2]}`.toUpperCase() : id;
}

class WindowsMonitors {
  constructor({ internal = () => false, spawnProcess = spawn, timeout = 5000, sessionFactory } = {}) {
    this.internal = internal; this.sessions = new Map(); this.known = [];
    this.makeSession = sessionFactory || (() => new MonitorSession({ spawnProcess, timeout }));
    this.warning = null; this.closed = false;
  }
  session(key) {
    if (this.closed) throw Error('Monitor service is closed.');
    if (!this.sessions.has(key)) this.sessions.set(key, this.makeSession());
    return this.sessions.get(key);
  }
  invalidate() { for (const session of this.sessions.values()) session.close(); this.sessions.clear(); }
  async list() {
    const groups = await Promise.allSettled([
      this.session('discovery:ddc').request('list'),
      this.internal() ? this.session('discovery:wmi').request('wmi-list') : Promise.resolve([])
    ]);
    const displays = [], warnings = [];
    for (const [index, result] of groups.entries()) {
      if (result.status === 'fulfilled') displays.push(...result.value);
      else {
        const type = index === 0 ? 'DDC/CI' : 'WMI';
        warnings.push(index === 0 ? 'External displays could not be refreshed.' : 'The built-in display could not be refreshed.');
        displays.push(...this.known.filter(m => m.type === type).map(m => ({ ...m, id: m.transportId, available: false })));
      }
    }
    // An internal panel exposed through both APIs should use its working WMI path.
    const panels = new Set(displays.filter(m => m.type === 'WMI').map(m => instanceKey(m.id)));
    const found = identify(displays.filter(m => m.type === 'WMI' || !panels.has(instanceKey(m.id))));
    let failed = 0;
    const reads = await Promise.allSettled(found.map(m => m.type === 'WMI' || m.available === false ? Promise.resolve(m) : this.session(m.transportId).request('get', { monitorId: m.transportId })));
    this.known = found.map((m, i) => {
      const read = reads[i];
      if (read.status === 'rejected') {
        failed++; const old = this.known.find(old => old.id === m.id);
        return { ...m, brightness: old?.brightness ?? null, available: false };
      }
      return { ...m, brightness: read.value.brightness, available: m.available !== false };
    });
    if (failed) warnings.push(`${failed} display${failed === 1 ? " didn't" : "s didn't"} respond. Check the connection or DDC/CI, then refresh from the tray menu.`);
    this.warning = warnings.join(' ') || null;
    const connected = new Set(found.map(m => m.transportId));
    for (const [key, session] of this.sessions) if (!key.startsWith('discovery:') && !connected.has(key)) { session.close(); this.sessions.delete(key); }
    return this.known;
  }
  set(id, value) {
    const monitor = this.known.find(m => m.id === id);
    if (!monitor) return Promise.reject(Error('Display is disconnected.'));
    return this.session(monitor.transportId).request('set', { monitorId: monitor.transportId, value });
  }
  close() { this.closed = true; this.invalidate(); }
}
module.exports = { WindowsMonitors, MonitorSession, identify };
