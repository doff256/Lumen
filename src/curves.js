'use strict';

const clamp = (n, low = 0, high = 100) => Math.min(high, Math.max(low, n));

function progress(shape, fraction) {
  const t = clamp(fraction, 0, 1);
  if (shape === 'front') return Math.log1p(9 * t) / Math.log(10);
  if (shape === 'late') return 1 - Math.log1p(9 * (1 - t)) / Math.log(10);
  return t;
}

function brightnessAt(ramp, now) {
  if (now >= ramp.endsAt) return ramp.target;
  const elapsed = (now - ramp.startsAt) / (ramp.endsAt - ramp.startsAt);
  if (ramp.curve === 'perceptual') {
    const t = clamp(elapsed, 0, 1);
    return Math.round(100 * Math.pow(Math.pow(ramp.from / 100, 1 / 2.2) * (1 - t) + Math.pow(ramp.target / 100, 1 / 2.2) * t, 2.2));
  }
  return Math.round(clamp(ramp.from + (ramp.target - ramp.from) * progress(ramp.curve, elapsed)));
}

module.exports = { clamp, progress, brightnessAt };
