'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

class WindowsMonitors {
  constructor() {
    this.pending = new Map();
    this.number = 0;
    this.buffer = '';
    this.closed = false;
    const script = path.join(__dirname, 'bridge.ps1').replace('app.asar', 'app.asar.unpacked');
    this.process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', chunk => this.onData(chunk));
    this.process.stderr.on('data', chunk => { this.lastError = String(chunk).slice(-300); });
    this.process.on('error', err => this.failAll(err));
    this.process.on('exit', code => this.failAll(Error(`Monitor service stopped (${code}). ${this.lastError || ''}`)));
  }

  failAll(error) {
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      try {
        const msg = JSON.parse(line);
        const pending = this.pending.get(msg.id);
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(msg.id);
        msg.error ? pending.reject(Error(msg.error)) : pending.resolve(msg.result);
      } catch { /* Startup diagnostics on stdout are ignored. */ }
    }
  }

  send(op, fields = {}) {
    if (this.closed) return Promise.reject(Error('Monitor service is unavailable. Restart Lumen.'));
    return new Promise((resolve, reject) => {
      const id = ++this.number;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Monitor response timed out. Check DDC/CI in the display menu.')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
    });
  }
  async list() { return this.send('list'); }
  async set(monitorId, value) { return this.send('set', { monitorId, value }); }
  close() { this.process.kill(); }
}

module.exports = { WindowsMonitors };
