'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = { monitors: [], ramps: [], schedules: [], settings: {}, limits: {} };
let monitorSignature = '', scheduleSignature = '', migrationSignature = '', settingsLoaded = false;
let duration = 15;
const time = at => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
function error(message) { $('#error').textContent = message || ''; $('#error').classList.toggle('hidden', !message); }
async function call(action) { try { const result = await action; error(null); return result; } catch (err) { error(err.message || String(err)); throw err; } }
function act(action) { call(action).catch(() => {}); }
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function updateScopes() {
  for (const select of [$('#scope'), $('#schedule-scope')]) {
    const value = select.value; select.replaceChildren();
    for (const monitor of [{ id: 'all', name: state.monitors.length > 1 ? 'all displays' : 'this display' }, ...state.monitors.filter(m => m.available !== false)]) {
      const option = element('option', '', monitor.name); option.value = monitor.id; select.append(option);
    }
    select.value = [...select.options].some(o => o.value === value) ? value : 'all';
  }
}
function bindSlider(input, output, id) {
  let pending, running = false, timer, last = 0, held = false;
  const editing = () => { input.dataset.editing = String(held || running || pending !== undefined); };
  async function flush() {
    clearTimeout(timer); if (running || pending === undefined || !input.isConnected) return;
    const target = pending; pending = undefined; running = true; last = Date.now(); editing();
    try { await call(window.lumen.set({ monitorId: id, target, calibrated: id !== 'all' })); } catch { }
    running = false;
    if (pending !== undefined) timer = setTimeout(flush, Math.max(0, 125 - (Date.now() - last)));
    editing();
  }
  input.addEventListener('pointerdown', () => { held = true; editing(); });
  for (const event of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(event, () => { held = false; editing(); });
  input.addEventListener('input', () => { output.textContent = input.value + '%'; pending = Number(input.value); editing(); clearTimeout(timer); timer = setTimeout(flush, Math.max(0, 125 - (Date.now() - last))); });
}
function presets() {
  const chips = element('div', 'chips');
  for (const [id, label] of [['night', 'Night'], ['work', 'Work']]) {
    const button = element('button', '', label); button.dataset.preset = id;
    button.addEventListener('click', () => act(window.lumen.preset(id))); chips.append(button);
  }
  return chips;
}
function makeMonitor(monitor) {
  const row = element('div', 'monitor-row'); row.dataset.id = monitor.id;
  const heading = element('div', 'monitor-heading'); heading.append(element('strong', '', monitor.name));
  if (monitor.id === 'all' || state.monitors.length === 1) heading.append(presets());
  const output = element('output', '', '—'); heading.append(output);
  const input = element('input', 'live-slider'); input.type = 'range'; input.min = 0; input.max = 100; input.setAttribute('aria-label', monitor.name + ' brightness'); input.disabled = monitor.available === false;
  bindSlider(input, output, monitor.id); row.append(heading, input);
  if (monitor.id !== 'all') {
    const details = element('details', 'display-details'); details.append(element('summary', '', 'Details'));
    const fields = element('div', 'calibration');
    const values = state.limits[monitor.id] || { min: 0, max: 100, offset: 0 };
    for (const [key, label] of [['min', 'Min'], ['max', 'Max'], ['offset', 'Offset']]) {
      const field = element('label', '', label); const number = element('input'); number.type = 'number'; number.min = key === 'offset' ? -100 : 0; number.max = 100; number.value = values[key]; number.required = true; number.dataset.limit = key; number.setAttribute('aria-label', monitor.name + ' ' + label); field.append(number); fields.append(field);
      number.addEventListener('change', () => {
        const inputs = [...fields.querySelectorAll('input')];
        if (!inputs.every(el => el.reportValidity())) return;
        const limits = Object.fromEntries(inputs.map(el => [el.dataset.limit, Number(el.value)]));
        act(window.lumen.configure({ monitorId: monitor.id, limits }));
      });
    }
    details.append(fields, element('p', 'hint', 'Limits apply immediately. Offset adjusts group changes, fades and presets.'));
    if (monitor.available === false) details.append(element('p', 'hint', 'Display did not respond. Refresh from the tray menu to retry.'));
    row.append(details);
  }
  return row;
}
function renderMonitors() {
  const signature = JSON.stringify(state.monitors.map(m => [m.id, m.name, m.available]));
  if (signature !== monitorSignature) {
    monitorSignature = signature; updateScopes(); const list = $('#monitor-list'); list.replaceChildren();
    if (state.monitors.length > 1) list.append(makeMonitor({ id: 'all', name: 'All displays', available: state.monitors.some(m => m.available !== false) }));
    for (const m of state.monitors) list.append(makeMonitor(m));
  }
  const available = state.monitors.filter(m => m.available !== false);
  for (const row of $$('.monitor-row')) {
    const input = row.querySelector('.live-slider'); if (input.dataset.editing === 'true') continue;
    const monitor = state.monitors.find(m => m.id === row.dataset.id);
    const value = monitor ? monitor.brightness : Math.round(available.reduce((sum, m) => sum + m.brightness, 0) / Math.max(1, available.length));
    input.value = value ?? 0; row.querySelector('output').textContent = monitor?.available === false ? '—' : value + '%';
  }
  $('#empty-state').classList.toggle('hidden', state.monitors.length > 0); $('#start').disabled = !available.length;
  for (const button of $$('[data-preset]')) { button.disabled = !available.length; button.title = `${button.textContent}: ${state.settings[button.dataset.preset]}%`; }
  const active = $('#active-ramp'); active.replaceChildren(); active.classList.toggle('hidden', !state.ramps.length);
  if (state.ramps.length) {
    active.append(element('span', '', `Fading · done ${time(Math.max(...state.ramps.map(r => r.endsAt)))}`));
    const stop = element('button', '', 'Stop'); stop.addEventListener('click', () => act(window.lumen.cancel('all'))); active.append(stop);
  }
}
function daysText(days) {
  if (days?.length === 7) return 'Every day';
  if ([...(days || [])].sort().join() === '1,2,3,4,5') return 'Weekdays';
  return (days || []).map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
}
function renderSchedules() {
  const signature = JSON.stringify([state.schedules, state.settings.night, state.settings.work, state.monitors.map(m => [m.id, m.name])]);
  if (signature === scheduleSignature) return; scheduleSignature = signature;
  const list = $('#schedule-list'); list.replaceChildren();
  if (!state.schedules.length) list.append(element('p', 'hint', 'No schedules yet. Add a time to wake up or wind down.'));
  for (const s of state.schedules) {
    const row = element('div', 'schedule-row' + (s.enabled ? '' : ' disabled'));
    const toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = s.enabled; toggle.disabled = !!s.firedAt; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', 'Enable schedule'); toggle.addEventListener('change', () => act(window.lumen.toggleSchedule(s.id)));
    const when = s.kind === 'once' ? new Date(s.startAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : daysText(s.days) + (s.kind === 'solar' ? ` at ${s.event}${s.offsetMinutes ? ` (${s.offsetMinutes > 0 ? '+' : ''}${s.offsetMinutes} min)` : ''}` : ` at ${time('2000-01-01T' + s.time)}`);
    const target = s.preset ? s.preset === 'night' ? 'Night' : 'Work' : s.target + '%';
    const text = element('p', '', `${when} → ${target}${s.durationMinutes ? `, over ${s.durationMinutes} min` : ', instantly'}`);
    const display = s.monitorId === 'all' ? 'All displays' : state.monitors.find(m => m.id === s.monitorId)?.name || 'Disconnected display';
    text.append(element('small', '', `${display}${s.preset ? ` · ${state.settings[s.preset]}%` : ''}${s.firedAt ? ' · Done' : ''}`));
    const remove = element('button', '', 'Remove'); remove.addEventListener('click', () => act(window.lumen.removeSchedule(s.id))); row.append(toggle, text, remove); list.append(row);
  }
}
function render(next) {
  state = next; renderMonitors(); renderSchedules();
  if (!settingsLoaded && state.settings) {
    settingsLoaded = true; $('#hotkeys').checked = state.settings.hotkeys; $('#idle-enabled').checked = state.settings.idleMinutes > 0;
    for (const [id, key] of [['night-level','night'],['work-level','work'],['idle-level','idleBrightness']]) $('#' + id).value = state.settings[key];
    $('#idle-minutes').value = state.settings.idleMinutes || 5;
    $('#idle-options').classList.toggle('hidden', !$('#idle-enabled').checked);
  }
  $('#warning').textContent = state.warning || ''; $('#warning').classList.toggle('hidden', !state.warning);
  if (state.error) error(state.error);
  const signature = JSON.stringify(state.migrations || []);
  if (signature !== migrationSignature) {
    migrationSignature = signature; $('#migrations').replaceChildren();
    for (const migration of state.migrations || []) {
      const row = element('div', 'migration'); row.append(element('p', 'hint', `A saved display is missing. ${migration.name} is the only matching connected display.`));
      const button = element('button', '', `Use ${migration.name}`); button.addEventListener('click', () => act(window.lumen.migrate(migration))); row.append(button); $('#migrations').append(row);
    }
  }
}
$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(button => { button.classList.toggle('active', button === tab); button.setAttribute('aria-current', button === tab ? 'page' : 'false'); });
  for (const id of ['now', 'schedule', 'settings']) $('#' + id + '-panel').classList.toggle('hidden', tab.dataset.tab !== id);
  $('main').scrollTop = 0;
}));
$$('[data-minutes]').forEach(button => button.addEventListener('click', () => {
  duration = button.dataset.minutes === 'custom' ? 'custom' : Number(button.dataset.minutes);
  $$('[data-minutes]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', b === button); });
  $('#custom-duration').classList.toggle('hidden', duration !== 'custom');
}));
$('#fade-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await call(window.lumen.start({ monitorId: $('#scope').value, target: Number($('#target-number').value), durationMinutes: duration === 'custom' ? Number($('#minutes').value) : duration, curve: $('#fade-curve').value })); $('#fade-builder').open = false; } catch { }
});
function scheduleFields() {
  const once = $('#schedule-kind').value === 'once', solar = !once && $('#schedule-trigger').value !== 'time';
  for (const [id, show] of [['schedule-trigger',!once],['schedule-time',!once && !solar],['schedule-date',once],['solar-fields',solar],['schedule-days',$('#schedule-kind').value === 'custom']]) $('#' + id).classList.toggle('hidden', !show);
  $('#schedule-time').required = !once && !solar; $('#schedule-date').required = once; $('#latitude').required = solar; $('#longitude').required = solar;
  $('#time-word').classList.toggle('hidden', once);
}
$('#schedule-kind').addEventListener('change', scheduleFields); $('#schedule-trigger').addEventListener('change', scheduleFields);
$('#schedule-duration').addEventListener('change', () => $('#schedule-custom').classList.toggle('hidden', $('#schedule-duration').value !== 'custom'));
$$('[data-day]').forEach(button => button.addEventListener('click', () => button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') !== 'true')));
$('#new-schedule').addEventListener('click', () => { $('#schedule-form').classList.remove('hidden'); $('#new-schedule').disabled = true; $('#schedule-kind').focus(); });
function closeSchedule() { $('#schedule-form').classList.add('hidden'); $('#new-schedule').disabled = false; $('#new-schedule').focus(); }
$('#cancel-schedule').addEventListener('click', closeSchedule);
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault(); const repeat = $('#schedule-kind').value, trigger = $('#schedule-trigger').value;
  const days = repeat === 'weekdays' ? [1,2,3,4,5] : repeat === 'custom' ? $$('[data-day][aria-pressed=true]').map(b => Number(b.dataset.day)) : [0,1,2,3,4,5,6];
  const kind = repeat === 'once' ? 'once' : trigger === 'time' ? 'repeat' : 'solar';
  const input = { kind, monitorId: $('#schedule-scope').value, preset: $('#schedule-preset').value, durationMinutes: Number($('#schedule-duration').value === 'custom' ? $('#schedule-minutes').value : $('#schedule-duration').value), curve: 'perceptual', days, time: $('#schedule-time').value, startAt: $('#schedule-date').value, event: trigger, latitude: Number($('#latitude').value), longitude: Number($('#longitude').value), offsetMinutes: Number($('#solar-offset').value) };
  try { await call(window.lumen.addSchedule(input)); closeSchedule(); } catch { }
});
async function saveSettings(settings) {
  $('#settings-status').textContent = 'Saving…';
  try { await call(window.lumen.configure({ settings })); $('#settings-status').textContent = 'Saved automatically.'; }
  catch { $('#settings-status').textContent = 'Could not save. Check the values and try again.'; }
}
for (const [id,key] of [['night-level','night'],['work-level','work'],['idle-level','idleBrightness']]) $('#' + id).addEventListener('change', event => { if (event.target.reportValidity()) saveSettings({ [key]: Number(event.target.value) }); });
$('#hotkeys').addEventListener('change', event => saveSettings({ hotkeys: event.target.checked }));
function saveIdle() { const enabled = $('#idle-enabled').checked; $('#idle-options').classList.toggle('hidden', !enabled); if (!enabled || $('#idle-minutes').reportValidity()) saveSettings({ idleMinutes: enabled ? Number($('#idle-minutes').value) : 0 }); }
$('#idle-enabled').addEventListener('change', saveIdle); $('#idle-minutes').addEventListener('change', saveIdle);
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.lumen.hide(); });
let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => window.lumen.resize?.(Math.ceil($('#content').getBoundingClientRect().height + 48)), 20); }).observe($('#content'));
window.lumen.onState(render); window.lumen.getState().then(render).catch(err => error(err.message));
