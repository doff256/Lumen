'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { WindowsMonitors, MonitorSession, identify } = require('../src/monitor/windows');
function child() {
  const p = new EventEmitter(); p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
  p.kill = () => { p.killed = true; p.emit('close', 1); }; return p;
}
function reply(p, id, result) { p.stdout.write(JSON.stringify({ id, result }) + '\n'); }
test('broken pipe rejects safely and next request respawns', async () => {
  const children = []; const session = new MonitorSession({ spawnProcess: () => { const p=child(); children.push(p); return p; } });
  try {
    const failed = session.request('set', { monitorId:'a', value:20 }); children[0].stdin.emit('error',Error('EPIPE')); await assert.rejects(failed,/EPIPE/);
    const next=session.request('set',{monitorId:'a',value:30}); reply(children[1],2,true); assert.equal(await next,true);
  } finally { session.close(); }
});
test('one timeout does not block another display session', async () => {
  const children=[]; const make=()=>new MonitorSession({timeout:20,spawnProcess:()=>{const p=child();children.push(p);return p;}});
  const a=make(),b=make();
  try {
    const slow=assert.rejects(a.request('set'),/timed out/); const fast=b.request('set'); reply(children[1],1,true); assert.equal(await fast,true); await slow; assert.ok(children[0].killed);
  } finally { a.close(); b.close(); }
});
test('writes reuse a session and preserve Unicode responses', async () => {
  let p, spawns=0; const session=new MonitorSession({spawnProcess:()=>{spawns++;return p=child();}});
  try {
    const first=session.request('get');reply(p,1,{name:'Écran 日本語'});assert.equal((await first).name,'Écran 日本語');
    const second=session.request('set');reply(p,2,true);await second;assert.equal(spawns,1);
  } finally { session.close(); }
});
test('external failure preserves a working laptop display and warns', async () => {
  const adapter=new WindowsMonitors({internal:()=>true,sessionFactory:()=>({close(){},async request(op){if(op==='list')throw Error('external failed');return [{id:'wmi:a',type:'WMI',name:'Laptop',brightness:45}];}})});
  try { const found=await adapter.list();assert.equal(found.length,1);assert.equal(found[0].brightness,45);assert.match(adapter.warning,/External displays/); }
  finally {adapter.close();}
});
test('failed DDC read retains an unavailable display and a count', async () => {
  const adapter=new WindowsMonitors({sessionFactory:()=>({close(){},async request(op){if(op==='list')return [{id:'ddc:a',type:'DDC/CI',name:'A'}];throw Error('timeout');}})});
  try { const found=await adapter.list();assert.equal(found[0].available,false);assert.match(adapter.warning,/1 display didn't respond/); }
  finally {adapter.close();}
});
test('EDID identity survives a port change; duplicate or missing serials use paths',()=>{
  const a={id:'port:a',edidId:'edid:ACM:1234:SERIAL',name:'Panel'};
  assert.equal(identify([a])[0].id,identify([{...a,id:'port:b'}])[0].id);
  assert.deepEqual(identify([a,{...a,id:'port:b'}]).map(m=>m.id),['port:a','port:b']);
  assert.equal(identify([{id:'port:c'}])[0].id,'port:c');
});

test('the laptop WMI panel is not duplicated as an unresponsive DDC display',async()=>{
  const adapter=new WindowsMonitors({internal:()=>true,sessionFactory:()=>({close(){},async request(op){
    if(op==='list')return [{id:'ddc:path:\\\\?\\DISPLAY#ACM1234#port#{guid}',type:'DDC/CI',name:'Panel'}];
    if(op==='wmi-list')return [{id:'wmi:DISPLAY\\ACM1234\\port_0',type:'WMI',name:'Panel',brightness:50}];
    throw Error('DDC should not be probed');
  }})});
  try {const displays=await adapter.list();assert.equal(displays.length,1);assert.equal(displays[0].type,'WMI');assert.equal(adapter.warning,null);}
  finally {adapter.close();}
});
