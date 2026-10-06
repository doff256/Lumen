'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../src/controller');
const { progress } = require('../src/curves');
const { occurrencesBetween } = require('../src/schedule');

test('display-off shortcut settings accept a safe chord and reject invalid input', async () => {
  const f = fixture('2026-09-29T12:00:00');
  assert.equal(f.controller.settings.screenOffShortcut, 'Control+Alt+O');
  assert.equal(f.controller.settings.screenOffEnabled, true);
  await f.controller.configure({ settings: { screenOffShortcut: 'Control+Alt+Shift+F12', screenOffEnabled: false } });
  assert.equal(f.controller.settings.screenOffShortcut, 'Control+Alt+Shift+F12');
  await assert.rejects(f.controller.configure({ settings: { screenOffShortcut: 'Control+Alt+Delete' } }), /Ctrl \+ Alt/);
  assert.equal(f.controller.settings.screenOffShortcut, 'Control+Alt+Shift+F12');
});

test('overnight sleep applies expired morning target instead of saved night ramp', async () => {
  const f = fixture('2026-09-29T22:59:00'); await f.controller.refresh();
  for (const [time, target] of [['23:00',20], ['07:00',80]]) f.controller.addSchedule({ kind:'repeat', time, days:[0,1,2,3,4,5,6], monitorId:'all', target, durationMinutes:30, curve:'linear' });
  f.advance(60000); await f.controller.tick();
  f.advance(10*60000); await f.controller.tick();
  f.advance((8*60+50)*60000); await f.controller.resume();
  assert.deepEqual(f.writes.slice(-2), [{id:'a',value:80},{id:'b',value:80}]);
  assert.equal(f.controller.ramps.length,0);
});

test('newer saved ramp wins over an older missed schedule', async () => {
  const f=fixture('2026-09-29T06:59:00');await f.controller.refresh();
  f.controller.addSchedule({kind:'repeat',time:'07:00',days:[0,1,2,3,4,5,6],monitorId:'a',target:80,durationMinutes:30,curve:'linear'});
  f.advance(46*60000);await f.controller.start({monitorId:'a',target:40,durationMinutes:30});
  f.advance(15*60000);await f.controller.resume();
  assert.equal(f.writes.at(-1).value,60);
  assert.equal(f.controller.ramps[0].target,40);
});

test('expired schedule target survives adapter failure and retries without old ramp', async () => {
  const f=fixture('2026-09-29T06:59:00');await f.controller.refresh();
  await f.controller.start({monitorId:'a',target:20,durationMinutes:30});
  f.controller.addSchedule({kind:'repeat',time:'07:00',days:[0,1,2,3,4,5,6],monitorId:'a',target:80,durationMinutes:30,curve:'linear'});
  const set=f.controller.adapter.set;f.controller.adapter.set=async()=>{throw Error('offline');};
  f.advance(61*60000);await f.controller.resume();assert.equal(f.controller.ramps[0].target,80);
  f.controller.adapter.set=set;f.advance(1000);await f.controller.tick();assert.equal(f.writes.at(-1).value,80);
});

test('a newer occurrence discards the old ramp even while its display is offline', async()=>{
  const f=fixture('2026-09-29T06:59:00');await f.controller.refresh();
  await f.controller.start({monitorId:'a',target:20,durationMinutes:30});
  f.controller.addSchedule({kind:'repeat',time:'07:00',days:[0,1,2,3,4,5,6],monitorId:'a',target:80,durationMinutes:30,curve:'linear'});
  f.controller.adapter.list=async()=>[];f.advance(61*60000);await f.controller.resume();
  assert.equal(f.controller.ramps.length,0);assert.equal(f.writes.length,0);
  f.controller.adapter.list=async()=>[{id:'a',name:'A',brightness:20}];await f.controller.refresh();f.advance(1000);await f.controller.tick();
  assert.equal(f.writes.at(-1).value,80);
});

test('preset-based schedules resolve the current preset at execution', async()=>{
  const f=fixture('2026-09-29T06:59:00');await f.controller.refresh();
  const s=f.controller.addSchedule({kind:'repeat',time:'07:00',days:[0,1,2,3,4,5,6],monitorId:'a',preset:'work',durationMinutes:30,curve:'perceptual'});
  assert.equal(s.target,undefined);await f.controller.configure({settings:{work:65}});
  f.advance(61*60000);await f.controller.resume();assert.equal(f.writes.at(-1).value,65);
});

test('limits clamp hardware immediately without applying the offset twice', async()=>{
  const f=fixture();await f.controller.refresh();await f.controller.configure({monitorId:'a',limits:{min:10,max:60,offset:-5}});
  assert.deepEqual(f.writes,[{id:'a',value:60}]);assert.equal(f.controller.monitors[0].brightness,60);
});

test('one-click migration is offered only for an unambiguous connected display',async()=>{
  const f=fixture();await f.controller.refresh();
  f.controller.schedules.push({id:'old',monitorId:'ddc:0:0:1920:1080:0',kind:'repeat',time:'07:00',days:[1],enabled:true});
  assert.equal(f.controller.migrations().length,0);
  f.controller.monitors=[{id:'edid:unique',name:'Panel',type:'DDC/CI'}];
  const migration=f.controller.migrations()[0];f.controller.migrate(migration);
  assert.equal(f.saved.schedules[0].monitorId,'edid:unique');
});

test('restart reconciles old saved ramps without a saved last-tick timestamp',async()=>{
  const now=new Date('2026-09-30T08:00:00').getTime();
  const saved={ramps:[{monitorId:'a',from:80,target:20,startsAt:new Date('2026-09-29T23:00:00').getTime(),endsAt:new Date('2026-09-29T23:30:00').getTime(),curve:'linear'}],schedules:[{id:'morning',kind:'repeat',enabled:true,time:'07:00',days:[0,1,2,3,4,5,6],monitorId:'a',target:80,durationMinutes:30,curve:'linear'}]};
  const writes=[];const controller=new Controller({clock:()=>now,storage:{load:()=>saved,save(){}},adapter:{list:async()=>[{id:'a',brightness:20}],set:async(id,value)=>writes.push(value)}});
  await controller.resume();assert.deepEqual(writes,[80]);assert.equal(controller.ramps.length,0);
});

test('path-to-EDID migration preserves the newest saved state',async()=>{
  const f=fixture();await f.controller.refresh();
  f.controller.ramps=[{monitorId:'ddc:path:old',startsAt:1,endsAt:10,target:20},{monitorId:'edid:new',startsAt:2,endsAt:10,target:80}];
  f.controller.remap('ddc:path:old','edid:new');assert.equal(f.controller.ramps.length,1);assert.equal(f.controller.ramps[0].target,80);
});

test('manual set during a tick prevents a stale write to the next display', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'all', target: 0, durationMinutes: 10 });
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.controller.adapter.set = async (id, value) => {
    f.writes.push({ id, value });
    if (id === 'a') { entered(); await new Promise(resolve => { release = resolve; }); }
  };
  f.advance(300000); const tick = f.controller.tick(); await ready;
  const beforeManual = f.writes.length;
  await f.controller.setNow({ monitorId: 'b', target: 77 });
  release(); await tick;
  assert.deepEqual(f.writes.slice(beforeManual).filter(w => w.id === 'b'), [{ id: 'b', value: 77 }]);
});

test('a queued ramp write is invalidated by manual adjustment', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'a', target: 0, durationMinutes: 10 });
  let release;
  f.controller.writes.set('a', new Promise(resolve => { release = resolve; }));
  f.advance(300000); const tick = f.controller.tick();
  const manual = f.controller.setNow({ monitorId: 'a', target: 77 });
  release(); await Promise.all([tick, manual]);
  assert.deepEqual(f.writes, [{ id: 'a', value: 77 }]);
});

test('a hung display does not block another display ramp', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'all', target: 0, durationMinutes: 10 });
  let release; f.controller.adapter.set = async (id, value) => {
    if (id === 'a') await new Promise(resolve => { release = resolve; });
    f.writes.push({ id, value });
  };
  f.advance(300000); const tick = f.controller.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.writes, [{ id: 'b', value: 20 }]);
  release(); await tick;
});

test('limits and offsets apply once to presets and ramps', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.configure({ monitorId: 'a', limits: { min: 10, max: 65, offset: -10 } });
  await f.controller.preset('work');
  assert.deepEqual(f.writes.slice(-2), [{ id: 'a', value: 65 }, { id: 'b', value: 80 }]);
  await f.controller.start({ monitorId: 'a', target: 30, durationMinutes: 1, curve: 'perceptual' });
  f.advance(60000); await f.controller.tick();
  assert.equal(f.writes.at(-1).value, 20);
});

test('idle dimming restores the current ramp position without cancelling it', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.configure({ settings: { idleMinutes: 1, idleBrightness: 10 } });
  await f.controller.start({ monitorId: 'a', target: 20, durationMinutes: 10 });
  await f.controller.updateIdle(61);
  assert.equal(f.writes[0].value, 10);
  f.advance(300000); await f.controller.tick();
  assert.equal(f.writes.at(-1).value, 10);
  await f.controller.updateIdle(0);
  assert.equal(f.writes.at(-2).value, 50);
  assert.equal(f.controller.ramps.length, 1);
});

test('perceptual ramp interpolates perceived intensity with exact endpoints', () => {
  const { brightnessAt } = require('../src/curves');
  const ramp = { from: 0, target: 100, startsAt: 0, endsAt: 100, curve: 'perceptual' };
  assert.equal(brightnessAt(ramp, 0), 0);
  assert.equal(brightnessAt(ramp, 50), 22);
  assert.equal(brightnessAt(ramp, 100), 100);
});

test('refresh while idle preserves the brightness to restore', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.configure({ settings: { idleMinutes: 1, idleBrightness: 10 } });
  await f.controller.updateIdle(61);
  f.controller.adapter.list = async () => [{ id: 'a', name: 'A', brightness: 10 }];
  await f.controller.refresh(); await f.controller.updateIdle(0);
  assert.equal(f.writes.at(-1).value, 80);
});

test('solar schedules follow the date and skip polar days without an event', () => {
  const schedule = { enabled: true, kind: 'solar', event: 'sunset', latitude: 51.5, longitude: -0.1, offsetMinutes: 30, days: [0,1,2,3,4,5,6] };
  const after = new Date('2026-09-29T00:00:00').getTime();
  const events = occurrencesBetween(schedule, after, after + 86400000);
  assert.equal(events.length, 1);
  const expected = require('suncalc').getTimes(new Date('2026-09-29T12:00:00'), 51.5, -0.1).sunset.getTime() + 1800000;
  assert.equal(events[0].at, expected);
  assert.deepEqual(occurrencesBetween({ ...schedule, latitude: 90 }, new Date('2026-06-21T00:00:00').getTime(), new Date('2026-06-22T00:00:00').getTime()), []);
});

test('disconnected scheduled display reports failure without stopping other work', async () => {
  const f = fixture(); await f.controller.refresh();
  f.controller.addSchedule({ kind: 'once', startAt: '2026-09-29T12:01:00', monitorId: 'a', target: 20, durationMinutes: 10, curve: 'linear' });
  f.controller.adapter.list = async () => [];
  f.advance(60000); await f.controller.tick();
  assert.match(f.controller.error, /disconnected/);
  assert.equal(f.controller.busy, false);
});

test('adapter failure retains a ramp for retry', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.start({ monitorId: 'a', target: 20, durationMinutes: 1 });
  const set = f.controller.adapter.set;
  f.controller.adapter.set = async () => { throw Error('offline'); };
  f.advance(60000); await f.controller.tick();
  assert.equal(f.controller.ramps.length, 1);
  assert.match(f.controller.error, /offline/);
  f.controller.adapter.set = set;
  f.advance(1000); await f.controller.tick();
  assert.equal(f.controller.ramps.length, 0);
});

test('resume after a long gap jumps to the active schedule curve', async () => {
  const f = fixture('2026-09-29T22:59:00'); await f.controller.refresh();
  f.controller.addSchedule({ kind: 'repeat', time: '23:00', days: [0,1,2,3,4,5,6], monitorId: 'a', target: 20, durationMinutes: 10, curve: 'linear' });
  f.advance(14 * 86400000 + 6 * 60000); await f.controller.resume();
  assert.equal(f.writes.at(-1).value, 50);
  assert.equal(f.controller.ramps[0].endsAt - f.controller.clock(), 5 * 60000);
});

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
