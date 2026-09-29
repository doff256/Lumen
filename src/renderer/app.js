'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = { monitors: [], ramps: [], schedules: [] };
let duration = 15, curve = 'perceptual', mode = 'repeat', toastTimer;
let monitorSignature = '', scheduleSignature = '', dragging = false;
let previousError = null;
const curveName = name => ({ linear: 'linear', perceptual: 'perceptual', front: 'early', late: 'late' })[name] || name;
let settingsLoaded = false;

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 5500);
}

async function call(promise) { try { await promise; } catch (err) { toast(err.message || String(err)); } }
function setFill(input) { input.style.setProperty('--fill', `${input.value}%`); }
function clock(at) { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at)); }
function dayString(days) {
  if (days.length === 7) return 'Every day';
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays';
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].filter((_, index) => days.includes(index)).join(' · ');
}

function updateScopes() {
  for (const select of [$('#scope'), $('#schedule-scope')]) {
    const current = select.value;
    select.replaceChildren();
    const options = [{ id: 'all', name: state.monitors.length > 1 ? 'All displays' : 'This display' }, ...state.monitors.map(m => ({ id: m.id, name: m.name }))];
    for (const option of options) { const el = document.createElement('option'); el.value = option.id; el.textContent = option.name; select.append(el); }
    select.value = options.some(o => o.id === current) ? current : 'all';
  }
}

function bindLiveSlider(input, value, monitorId) {
  let timer, pending, running = false, last = 0;
  async function flush() {
    clearTimeout(timer);
    if (running || pending === undefined) return;
    const target = pending; pending = undefined; running = true; last = Date.now();
    await call(window.lumen.set({ monitorId, target, calibrated: monitorId !== 'all' }));
    running = false;
    if (pending !== undefined) timer = setTimeout(flush, Math.max(0, 125 - (Date.now() - last)));
  }
  input.addEventListener('pointerdown', () => { dragging = true; });
  for (const event of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(event, () => { dragging = false; });
  input.addEventListener('input', () => {
    value.firstChild.textContent = input.value; setFill(input);
    pending = Number(input.value);
    clearTimeout(timer); timer = setTimeout(flush, Math.max(0, 125 - (Date.now() - last)));
  });
}

function renderMonitors() {
  const signature = state.monitors.map(m => `${m.id}|${m.name}`).join(';');
  if (signature !== monitorSignature) {
    monitorSignature = signature;
    updateScopes();
    const list = $('#monitor-list'); list.replaceChildren();
    for (const monitor of state.monitors) {
      const row = document.createElement('div'); row.className = 'monitor'; row.dataset.id = monitor.id;
      const head = document.createElement('div'); head.className = 'monitor-head';
      const name = document.createElement('div'); name.className = 'monitor-name'; name.textContent = monitor.name;
      const type = document.createElement('span'); type.className = 'monitor-type'; type.textContent = monitor.type;
      name.append(type);
      const value = document.createElement('div'); value.className = 'monitor-value'; value.innerHTML = '0<span>%</span>';
      head.append(name, value);
      const input = document.createElement('input'); input.className = 'range'; input.type = 'range'; input.min = 0; input.max = 100; input.setAttribute('aria-label', `${monitor.name} brightness`);
      bindLiveSlider(input, value, monitor.id);
      row.append(head, input); list.append(row);
    }
    if (state.monitors.length > 1) {
      const row = document.createElement('div'); row.className = 'monitor all-monitor'; row.dataset.id = 'all';
      const head = document.createElement('div'); head.className = 'monitor-head';
      const name = document.createElement('div'); name.className = 'monitor-name'; name.textContent = 'All displays';
      const type = document.createElement('span'); type.className = 'monitor-type'; type.textContent = 'GROUP'; name.append(type);
      const value = document.createElement('div'); value.className = 'monitor-value'; value.innerHTML = '0<span>%</span>';
      head.append(name, value);
      const input = document.createElement('input'); input.className = 'range'; input.type = 'range'; input.min = 0; input.max = 100; input.setAttribute('aria-label', 'All displays brightness');
      bindLiveSlider(input, value, 'all');
      row.append(head, input); list.append(row);
    }
  }
  $('#display-count').textContent = `${state.monitors.length} CONNECTED`;
  $('#empty-state').classList.toggle('hidden', !!state.monitors.length);
  for (const monitor of state.monitors) {
    const row = [...$$('.monitor')].find(el => el.dataset.id === monitor.id);
    if (!row) continue;
    const input = row.querySelector('input');
    if (!dragging && document.activeElement !== input) { input.value = monitor.brightness; row.querySelector('.monitor-value').firstChild.textContent = monitor.brightness; setFill(input); }
  }
  const all = $('.all-monitor');
  if (all && !dragging && document.activeElement !== all.querySelector('input')) {
    const average = Math.round(state.monitors.reduce((sum, m) => sum + m.brightness, 0) / state.monitors.length);
    const input = all.querySelector('input'); input.value = average; setFill(input);
    all.querySelector('.monitor-value').firstChild.textContent = average;
    all.querySelector('.monitor-value').title = 'Average brightness; drag to set every display to the same level';
  }
}

function renderActive() {
  const el = $('#active-ramp');
  if (!state.ramps.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden'); el.replaceChildren();
  const top = document.createElement('div'); top.className = 'active-top';
  const heading = document.createElement('strong'); heading.textContent = state.ramps.length > 1 ? `${state.ramps.length} TRANSITIONS RUNNING` : 'TRANSITION RUNNING';
  const cancel = document.createElement('button'); cancel.textContent = 'STOP'; cancel.addEventListener('click', () => call(window.lumen.cancel('all')));
  top.append(heading, cancel);
  const text = document.createElement('p');
  const end = Math.max(...state.ramps.map(r => r.endsAt));
  text.textContent = `${state.ramps.map(r => `${state.monitors.find(m => m.id === r.monitorId)?.name || 'Display'} ${r.current}% → ${r.target}%`).join(' · ')}  ·  Done ${clock(end)}`;
  const track = document.createElement('div'); track.className = 'progress-line'; const fill = document.createElement('span');
  const first = state.ramps[0]; fill.style.width = `${Math.max(0, Math.min(100, (state.now - first.startsAt) / (first.endsAt - first.startsAt) * 100))}%`;
  track.append(fill); el.append(top, text, track);
}

function renderSchedules() {
  const signature = JSON.stringify(state.schedules);
  if (signature === scheduleSignature) return;
  scheduleSignature = signature;
  $('#schedule-count').textContent = state.schedules.filter(s => s.enabled).length;
  const list = $('#schedule-list'); list.replaceChildren();
  if (!state.schedules.length) { const empty = document.createElement('div'); empty.className = 'empty-schedules'; empty.textContent = 'Nothing scheduled yet. Add a time below.'; list.append(empty); return; }
  for (const s of [...state.schedules].sort((a, b) => (a.nextAt || Infinity) - (b.nextAt || Infinity))) {
    const row = document.createElement('div'); row.className = 'schedule-item' + (s.enabled ? '' : ' disabled');
    const toggle = document.createElement('button'); toggle.className = 'schedule-toggle'; toggle.title = s.firedAt ? 'Completed' : s.enabled ? 'Disable' : 'Enable'; toggle.disabled = !!s.firedAt; toggle.setAttribute('aria-label', toggle.title + ' schedule'); toggle.addEventListener('click', () => call(window.lumen.toggleSchedule(s.id)));
    const main = document.createElement('div'); main.className = 'schedule-main';
    const title = document.createElement('strong'); title.textContent = `${s.target}% in ${s.durationMinutes ? s.durationMinutes + ' min' : 'an instant'}`;
    const detail = document.createElement('small'); detail.textContent = `${s.kind === 'once' ? 'Once · ' + new Date(s.startAt).toLocaleDateString() + ' ' + clock(s.startAt) : dayString(s.days) + ' · ' + (s.kind === 'solar' ? s.event + (s.offsetMinutes ? ` ${s.offsetMinutes > 0 ? '+' : ''}${s.offsetMinutes} min` : '') : s.time)} · ${curveName(s.curve)}`;
    main.append(title, detail);
    const meta = document.createElement('div'); meta.className = 'schedule-meta';
    const next = document.createElement('span'); next.textContent = s.nextAt ? 'NEXT ' + clock(s.nextAt) : s.firedAt ? 'DONE' : s.kind === 'once' && s.enabled ? 'MISSED' : 'PAUSED';
    const remove = document.createElement('button'); remove.textContent = 'REMOVE'; remove.addEventListener('click', () => call(window.lumen.removeSchedule(s.id)));
    meta.append(next, remove); row.append(toggle, main, meta); list.append(row);
  }
}

function minutes() { return duration === 'custom' ? Number($('#minutes').value) : duration; }
function renderAction() {
  const amount = Number($('#target-number').value);
  setFill($('#target-slider'));
  $('#curve-block').classList.toggle('hidden', minutes() === 0);
  const selected = $('#scope').value;
  const monitor = state.monitors.find(m => m.id === selected);
  const start = monitor ? `${monitor.brightness}%` : state.monitors.length === 1 ? `${state.monitors[0].brightness}%` : 'current';
  $('#action-summary').textContent = `${start} → ${Number.isFinite(amount) ? amount : '—'}%  ·  ${minutes() ? `${minutes()} min · ${curveName(curve)}` : 'instant'}`;
  $('#start').firstChild.textContent = minutes() ? 'START TRANSITION ' : 'SET BRIGHTNESS ';
  $('#start').disabled = state.monitors.length === 0;
}

function render(next) {
  state = next;
  renderMonitors(); renderActive(); renderSchedules(); renderAction();
  if (!settingsLoaded && state.settings) {
    settingsLoaded = true;
    $('#hotkeys').checked = state.settings.hotkeys;
    for (const [id, key] of [['night-level', 'night'], ['work-level', 'work'], ['idle-minutes', 'idleMinutes'], ['idle-level', 'idleBrightness']]) $('#' + id).value = state.settings[key];
  }
  const select = $('#limits-scope');
  if (select.dataset.signature !== monitorSignature) {
    select.dataset.signature = monitorSignature;
    const selected = select.value; select.replaceChildren();
    for (const monitor of state.monitors) { const option = document.createElement('option'); option.value = monitor.id; option.textContent = monitor.name; select.append(option); }
    if (state.monitors.some(m => m.id === selected)) select.value = selected;
    renderLimits();
  }
  if (state.error && state.error !== previousError) toast(state.error);
  previousError = state.error;
}

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $('#now-panel').classList.toggle('hidden', tab.dataset.tab !== 'now');
  $('#schedule-panel').classList.toggle('hidden', tab.dataset.tab !== 'schedule');
  $('#settings-panel').classList.toggle('hidden', tab.dataset.tab !== 'settings');
  $('main').scrollTop = 0;
}));
$('#refresh').addEventListener('click', () => call(window.lumen.refresh()));
$('#close').addEventListener('click', () => window.lumen.hide());
$('#target-number').addEventListener('input', event => { $('#target-slider').value = event.target.value; renderAction(); });
$('#target-slider').addEventListener('input', event => { $('#target-number').value = event.target.value; renderAction(); });
$('#scope').addEventListener('change', renderAction);
$$('[data-minutes]').forEach(button => button.addEventListener('click', () => {
  duration = button.dataset.minutes === 'custom' ? 'custom' : Number(button.dataset.minutes);
  $$('[data-minutes]').forEach(b => b.classList.toggle('selected', b === button));
  $('#custom-duration').classList.toggle('hidden', duration !== 'custom'); renderAction();
}));
$('#minutes').addEventListener('input', renderAction);
$$('[data-curve]').forEach(button => button.addEventListener('click', () => {
  curve = button.dataset.curve; $$('[data-curve]').forEach(b => b.classList.toggle('selected', b === button)); renderAction();
}));
$('#start').addEventListener('click', () => call(window.lumen.start({ monitorId: $('#scope').value, target: Number($('#target-number').value), durationMinutes: minutes(), curve })));
$$('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode; $$('[data-mode]').forEach(b => b.classList.toggle('selected', b === button));
  $('#repeat-fields').classList.toggle('hidden', mode === 'once'); $('#once-fields').classList.toggle('hidden', mode !== 'once');
  $('#solar-fields').classList.toggle('hidden', mode !== 'solar'); $('#schedule-time').classList.toggle('hidden', mode === 'solar');
  $('#latitude').required = mode === 'solar'; $('#longitude').required = mode === 'solar';
  $('#schedule-time').required = mode === 'repeat'; $('#schedule-date').required = mode === 'once';
}));
$$('[data-day]').forEach(button => button.addEventListener('click', () => button.classList.toggle('selected')));
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const selectedDays = $$('[data-day].selected').map(b => Number(b.dataset.day)).sort();
  const input = {
    monitorId: $('#schedule-scope').value, target: Number($('#schedule-target').value), durationMinutes: Number($('#schedule-minutes').value),
    curve: $('#schedule-curve').value, kind: mode,
    ...(mode === 'once' ? { startAt: $('#schedule-date').value } : { time: $('#schedule-time').value, days: selectedDays }),
    ...(mode === 'solar' ? { event: $('#solar-event').value, latitude: Number($('#latitude').value), longitude: Number($('#longitude').value), offsetMinutes: Number($('#solar-offset').value) } : {})
  };
  try { await window.lumen.addSchedule(input); toast('Schedule saved.'); $('main').scrollTop = 0; }
  catch (err) { toast(err.message || String(err)); }
});
function renderLimits() {
  const limits = state.limits?.[$('#limits-scope').value] || { min: 0, max: 100, offset: 0 };
  for (const key of ['min', 'max', 'offset']) $('#limit-' + key).value = limits[key];
}
$('#limits-scope').addEventListener('change', renderLimits);
$$('[data-preset]').forEach(button => button.addEventListener('click', () => call(window.lumen.preset(button.dataset.preset))));
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await window.lumen.configure({ settings: { hotkeys: $('#hotkeys').checked, night: Number($('#night-level').value), work: Number($('#work-level').value), idleMinutes: Number($('#idle-minutes').value), idleBrightness: Number($('#idle-level').value) } }); toast('Settings saved.'); }
  catch (error) { toast(error.message); }
});
$('#limits-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await window.lumen.configure({ monitorId: $('#limits-scope').value, limits: { min: Number($('#limit-min').value), max: Number($('#limit-max').value), offset: Number($('#limit-offset').value) } }); toast('Display limits saved.'); }
  catch (error) { toast(error.message); }
});
window.lumen.onState(render);
window.lumen.getState().then(render);
