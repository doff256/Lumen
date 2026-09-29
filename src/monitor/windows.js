'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// A short-lived helper per request isolates slow DDC drivers from other displays.
class WindowsMonitors {
  constructor({ internal = () => false, spawnProcess = spawn, timeout = 5000 } = {}) {
    this.internal = internal; this.spawn = spawnProcess; this.timeout = timeout;
    this.children = new Set(); this.closed = false;
  }
  run(file, args, input) {
    if (this.closed) return Promise.reject(Error('Monitor service is closed.'));
    return new Promise((resolve, reject) => {
      const child = this.spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.children.add(child);
      let output = '', error = '', done = false;
      const finish = (err, result) => {
        if (done) return; done = true; clearTimeout(timer); this.children.delete(child);
        err ? reject(err) : resolve(result);
      };
      const timer = setTimeout(() => { finish(Error('Display response timed out. Check DDC/CI.')); child.kill(); }, this.timeout);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', err => finish(err));
      child.stdin.on('error', err => { finish(err); child.kill(); });
      child.on('close', code => {
        if (code !== 0) return finish(Error(error.trim() || `Monitor helper stopped (${code}).`));
        try { finish(null, JSON.parse(output.replace(/^\uFEFF/, '').trim())); }
        catch { finish(Error('Invalid monitor response.')); }
      });
      child.stdin.end(input || '');
    });
  }
  native(op, ...args) {
    return this.run(path.join(__dirname, 'native.exe').replace('app.asar', 'app.asar.unpacked'), [op, ...args.map(String)]);
  }
  async wmi(op, fields = {}) {
    const script = fs.readFileSync(path.join(__dirname, 'wmi.ps1').replace('app.asar', 'app.asar.unpacked'), 'utf8');
    const result = await this.run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], JSON.stringify({ id: 1, op, ...fields }) + '\n');
    if (result.error) throw Error(result.error);
    return result.result;
  }
  async list() {
    const [external, internal] = await Promise.all([
      this.native('list').then(async displays => {
        const results = await Promise.allSettled(displays.map(m => this.native('get', m.id)));
        return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      }),
      this.internal() ? this.wmi('list') : Promise.resolve([])
    ]);
    return [...external, ...internal];
  }
  set(id, value) { return id.startsWith('wmi:') ? this.wmi('set', { monitorId: id, value }) : this.native('set', id, value); }
  close() { this.closed = true; for (const child of this.children) child.kill(); }
}
module.exports = { WindowsMonitors };
