'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, data) => ipcRenderer.invoke(channel, data);
contextBridge.exposeInMainWorld('lumen', {
  getState: () => invoke('state:get'),
  onState: callback => ipcRenderer.on('state', (_, state) => callback(state)),
  refresh: () => invoke('monitors:refresh'),
  set: args => invoke('brightness:set', args),
  start: args => invoke('ramp:start', args),
  cancel: id => invoke('ramp:cancel', id),
  addSchedule: args => invoke('schedule:add', args),
  removeSchedule: id => invoke('schedule:remove', id),
  toggleSchedule: id => invoke('schedule:toggle', id),
  hide: () => invoke('window:hide')
});
