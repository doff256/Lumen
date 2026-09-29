'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { WindowsMonitors } = require('../src/monitor/windows');

function child() {
  const p = new EventEmitter();
  p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
  p.kill = () => { p.killed = true; p.emit('close', 1); };
  return p;
}
test('broken pipe rejects safely and a later request uses a fresh helper', async () => {
  const children = [];
  const adapter = new WindowsMonitors({ spawnProcess: () => { const p = child(); children.push(p); return p; } });
  const failed = adapter.set('ddc:a', 20);
  children[0].stdin.emit('error', Error('EPIPE'));
  await assert.rejects(failed, /EPIPE/);
  const next = adapter.set('ddc:a', 30);
  children[1].stdout.end('true\n'); children[1].emit('close', 0);
  assert.equal(await next, true);
  adapter.close();
});
test('one timed-out monitor does not block another request', async () => {
  const children = [];
  const adapter = new WindowsMonitors({ timeout: 20, spawnProcess: () => { const p = child(); children.push(p); return p; } });
  const slow = assert.rejects(adapter.set('ddc:a', 20), /timed out/);
  const fast = adapter.set('ddc:b', 30);
  children[1].stdout.end('true\n'); children[1].emit('close', 0);
  assert.equal(await fast, true);
  await slow; assert.ok(children[0].killed);
});
test('UTF-8 responses retain non-ASCII display names', async () => {
  let p;
  const adapter = new WindowsMonitors({ spawnProcess: () => (p = child()) });
  const response = adapter.native('list');
  p.stdout.end(JSON.stringify([{ id: 'x', name: 'Écran 日本語' }])); p.emit('close', 0);
  assert.equal((await response)[0].name, 'Écran 日本語');
});
test('desktop enumeration does not start PowerShell', async () => {
  const adapter = new WindowsMonitors();
  adapter.native = async op => op === 'list' ? [{ id: 'a' }] : [{ id: 'a', brightness: 50 }];
  adapter.wmi = () => { throw Error('must remain lazy'); };
  assert.equal((await adapter.list())[0].brightness, 50);
});
