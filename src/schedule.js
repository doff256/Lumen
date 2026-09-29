'use strict';

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
  const [hour, minute] = schedule.time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return found;
  const d = new Date(after);
  d.setHours(0, 0, 0, 0);
  // Reconstruct each local wall time, so DST transitions cannot drift a daily schedule.
  for (let i = 0; i < 9 && d.getTime() <= before; i++) {
    if (schedule.days.includes(d.getDay())) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
      const key = localKey(d);
      if (at > after && at <= before && schedule.lastFiredKey !== key) found.push({ at, key });
    }
    d.setDate(d.getDate() + 1);
  }
  return found;
}

function nextOccurrence(schedule, now) {
  return occurrencesBetween(schedule, now - 1, now + 8 * 86400000)[0] || null;
}

module.exports = { occurrencesBetween, nextOccurrence, localKey };
