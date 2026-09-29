'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../src/controller');
const { progress } = require('../src/curves');
const { occurrencesBetween } = require('../src/schedule');

function fixture(at = '2026-09-29T12:00:00') {
  let now = new Date(at).getTime();
  let saved = {};
  const writes = [];
  const adapter = {
    async list() { return [{ id: 'a', name: 'A', brightness: 80 }, { id: 'b', name: 'B', brightness: 40 }]; },
    async set(id, value) { writes.push({ id, value }); }
  };
  const storage = { load: () => saved, save: data => { saved = structuredClone(data); } };
  const controller = new Controller({ adapter, storage, clock: () => now });
  return { controller, writes, storage, advance: ms => { now += ms; }, get saved() { return saved; } };
}

test('independent monitor ramps interpolate and reach exact targets', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'all', target: 20, durationMinutes: 10, curve: 'linear' });
  f.advance(5 * 60000); await f.controller.tick();
  assert.deepEqual(f.writes, [{ id: 'a', value: 50 }, { id: 'b', value: 30 }]);
  f.advance(5 * 60000); await f.controller.tick();
  assert.deepEqual(f.writes.slice(-2), [{ id: 'a', value: 20 }, { id: 'b', value: 20 }]);
  assert.equal(f.controller.ramps.length, 0);
});

test('manual brightness cancels only the affected display transition', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'all', target: 10, durationMinutes: 15, curve: 'front' });
  await f.controller.setNow({ monitorId: 'a', target: 75 });
  assert.deepEqual(f.controller.ramps.map(r => r.monitorId), ['b']);
  assert.equal(f.saved.ramps.length, 1);
});

test('curve names describe early versus late movement', () => {
  assert.equal(progress('linear', .5), .5);
  assert.ok(progress('front', .5) > .5);
  assert.ok(progress('late', .5) < .5);
  for (const curve of ['linear', 'front', 'late']) {
    assert.equal(progress(curve, 0), 0);
    assert.equal(progress(curve, 1), 1);
  }
});

test('repeat schedule fires once on its local day and survives a restart', async () => {
  const f = fixture('2026-09-29T22:59:59'); await f.controller.refresh();
  const day = new Date('2026-09-29T23:00:00').getDay();
  f.controller.addSchedule({ kind: 'repeat', time: '23:00', days: [day], monitorId: 'a', target: 30, durationMinutes: 15, curve: 'linear' });
  f.advance(1000); await f.controller.tick();
  assert.equal(f.controller.ramps.length, 1);
  assert.equal(f.saved.schedules[0].lastFiredKey, '2026-09-29');
  assert.equal(f.saved.ramps.length, 1);
  assert.deepEqual(occurrencesBetween(f.saved.schedules[0], new Date('2026-09-29T22:59:59').getTime(), new Date('2026-09-29T23:01:00').getTime()), []);
});

test('one-time schedule becomes done, while a missed stale event is skipped', async () => {
  const f = fixture('2026-09-29T12:00:00'); await f.controller.refresh();
  f.controller.addSchedule({ kind: 'once', startAt: '2026-09-29T12:01:00', monitorId: 'b', target: 55, durationMinutes: 0, curve: 'linear' });
  f.advance(60000); await f.controller.tick();
  assert.equal(f.writes[0].value, 55);
  assert.equal(f.saved.schedules[0].enabled, false);
  assert.ok(f.saved.schedules[0].firedAt);
});
