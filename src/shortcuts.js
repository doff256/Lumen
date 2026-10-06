'use strict';

const DEFAULT_SCREEN_OFF_SHORTCUT = 'Control+Alt+O';
const SCREEN_OFF_SHORTCUT = /^Control\+Alt\+(?:Shift\+)?(?:[A-Z]|F(?:[1-9]|1[0-2]))$/;

function validScreenOffShortcut(value) {
  return typeof value === 'string' && SCREEN_OFF_SHORTCUT.test(value);
}

module.exports = { DEFAULT_SCREEN_OFF_SHORTCUT, validScreenOffShortcut };
