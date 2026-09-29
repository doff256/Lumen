'use strict';
const SunCalc = require('suncalc');

function localKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function occurrencesBetween(schedule, after, before) {
  if (!schedule.enabled) return [];
  if (schedule.kind === 'once') {
    const at = new Date(schedule.startAt).getTime();
    return Number.isFinite(at) && at > after && at <= before && !schedule.firedAt ? [{ at, key: 'once' }] : [];
  }
  const found = [];
  const [hour, minute] = (schedule.time || '00:00').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return found;
  const d = new Date(Math.max(after - 86400000, before - 10 * 86400000));
  d.setHours(0, 0, 0, 0);
  // Reconstruct each local wall time, so DST transitions cannot drift a daily schedule.
  for (let i = 0; i < 12 && d.getTime() <= before + 86400000; i++) {
    if (schedule.days.includes(d.getDay())) {
      let at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
      if (schedule.kind === 'solar') {
        const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
        at = SunCalc.getTimes(noon, schedule.latitude, schedule.longitude)[schedule.event]?.getTime() + (schedule.offsetMinutes || 0) * 60000;
      }
      const key = localKey(d);
      if (at > after && at <= before && schedule.lastFiredKey !== key) found.push({ at, key });
    }
    d.setDate(d.getDate() + 1);
  }
  return found.sort((a, b) => a.at - b.at);
}

function latestOccurrence(schedule, after, before) {
  if (schedule.kind === 'once') return occurrencesBetween(schedule, after, before).at(-1) || null;
  // Weekly times need at most eight days; solar events may be absent all winter.
  const days = schedule.kind === 'solar' ? 370 : 8;
  for (let end = before; end > after; end -= 8 * 86400000) {
    const start = Math.max(after, end - 8 * 86400000);
    const event = occurrencesBetween(schedule, start, end).at(-1);
    if (event) return event;
    if (before - start >= days * 86400000) break;
  }
  return null;
}

function nextOccurrence(schedule, now) {
  return occurrencesBetween(schedule, now - 1, now + 8 * 86400000)[0] || null;
}

module.exports = { occurrencesBetween, latestOccurrence, nextOccurrence, localKey };
