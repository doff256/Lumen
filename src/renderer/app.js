'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = { monitors: [], ramps: [], schedules: [] };
let duration = 15, curve = 'linear', mode = 'repeat', toastTimer;
let monitorSignature = '', scheduleSignature = '', dragging = false;
let previousError = null;

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
      input.addEventListener('pointerdown', () => dragging = true);
      input.addEventListener('pointerup', () => dragging = false);
      input.addEventListener('input', () => { value.firstChild.textContent = input.value; setFill(input); });
      input.addEventListener('change', () => call(window.lumen.set({ monitorId: monitor.id, target: Number(input.value) })));
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
      input.addEventListener('pointerdown', () => dragging = true);
      input.addEventListener('pointerup', () => dragging = false);
      input.addEventListener('input', () => { value.firstChild.textContent = input.value; setFill(input); });
      input.addEventListener('change', () => call(window.lumen.set({ monitorId: 'all', target: Number(input.value) })));
      row.append(head, input); list.append(row);
    }
  }
  $('#display-count').textContent = `${state.monitors.length} CONNECTED`;
  $('#empty-state').classList.toggle('hidden', !!state.monitors.length);
  for (const monitor of state.monitors) {
    const row = [...$$('.monitor')].find(el => el.dataset.id === monitor.id);
    if (!row) continue;
    const input = row.querySelector('input');
    if (!dragging) { input.value = monitor.brightness; row.querySelector('.monitor-value').firstChild.textContent = monitor.brightness; setFill(input); }
  }
  const all = $('.all-monitor');
  if (all && !dragging) {
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
    const detail = document.createElement('small'); detail.textContent = `${s.kind === 'once' ? 'Once · ' + new Date(s.startAt).toLocaleDateString() + ' ' + clock(s.startAt) : dayString(s.days) + ' · ' + s.time} · ${s.curve === 'linear' ? 'even' : s.curve === 'front' ? 'early' : 'late'}`;
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
  $('#action-summary').textContent = `${start} → ${Number.isFinite(amount) ? amount : '—'}%  ·  ${minutes() ? `${minutes()} min · ${curve === 'linear' ? 'even' : curve === 'front' ? 'early change' : 'late change'}` : 'instant'}`;
  $('#start').firstChild.textContent = minutes() ? 'START TRANSITION ' : 'SET BRIGHTNESS ';
  $('#start').disabled = state.monitors.length === 0;
}

function render(next) {
  state = next;
  renderMonitors(); renderActive(); renderSchedules(); renderAction();
  if (state.error && state.error !== previousError) toast(state.error);
  previousError = state.error;
}

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $('#now-panel').classList.toggle('hidden', tab.dataset.tab !== 'now');
  $('#schedule-panel').classList.toggle('hidden', tab.dataset.tab !== 'schedule');
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
  $('#repeat-fields').classList.toggle('hidden', mode !== 'repeat'); $('#once-fields').classList.toggle('hidden', mode !== 'once');
  $('#schedule-time').required = mode === 'repeat'; $('#schedule-date').required = mode === 'once';
}));
$$('[data-day]').forEach(button => button.addEventListener('click', () => button.classList.toggle('selected')));
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const selectedDays = $$('[data-day].selected').map(b => Number(b.dataset.day)).sort();
  const input = {
    monitorId: $('#schedule-scope').value, target: Number($('#schedule-target').value), durationMinutes: Number($('#schedule-minutes').value),
    curve: $('#schedule-curve').value, kind: mode,
    ...(mode === 'once' ? { startAt: $('#schedule-date').value } : { time: $('#schedule-time').value, days: selectedDays })
  };
  try { await window.lumen.addSchedule(input); toast('Schedule saved.'); $('main').scrollTop = 0; }
  catch (err) { toast(err.message || String(err)); }
});
window.lumen.onState(render);
window.lumen.getState().then(render);
