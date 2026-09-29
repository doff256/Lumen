'use strict';

class DemoMonitors {
  constructor() {
    this.demo = true;
    this.displays = [
      { id: 'demo:main', name: 'Main display', brightness: 68, type: 'DEMO' },
      { id: 'demo:secondary', name: 'Second display', brightness: 42, type: 'DEMO' }
    ];
  }
  async list() { return this.displays.map(m => ({ ...m })); }
  async set(id, value) { const monitor = this.displays.find(m => m.id === id); if (!monitor) throw Error('Display disconnected.'); monitor.brightness = value; }
  close() {}
}
module.exports = { DemoMonitors };
