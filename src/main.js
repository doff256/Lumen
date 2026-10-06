'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, powerMonitor, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Controller } = require('./controller');
const { WindowsMonitors } = require('./monitor/windows');
const { DemoMonitors } = require('./monitor/demo');
const { validScreenOffShortcut } = require('./shortcuts');
const runFile = promisify(execFile);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let window, tray, controller, adapter, refreshTimer, tickTimer;
let quitting = false;
let hiddenAt = 0, displayTimer;
let idleTimer, shortcutBusy = false, screenOffPending = false, lastScreenOff = 0;
function report(error) { controller.error = error.message; controller.notify(); }
async function turnOffDisplays() {
  if (process.platform !== 'win32') throw Error('Turning displays off is available on Windows.');
  if (screenOffPending || Date.now() - lastScreenOff < 1500) return;
  screenOffPending = true;
  lastScreenOff = Date.now();
  try {
    if (window?.isVisible()) hideWindow();
    // Let the shortcut keys or tray click finish before asking Windows to sleep the displays.
    await new Promise(resolve => setTimeout(resolve, 650));
    const filename = path.join(__dirname, 'monitor', 'native.exe').replace('app.asar', 'app.asar.unpacked');
    const { stdout } = await runFile(filename, ['display-off'], { windowsHide: true, timeout: 5000 });
    if (JSON.parse(stdout.trim()) !== true) throw Error('Windows did not accept the display power request.');
  } finally { screenOffPending = false; }
}
function registerHotkeys({ strictScreenOff = false } = {}) {
  globalShortcut.unregisterAll();
  if (controller.settings.hotkeys) {
    for (const [key, delta] of [['Up', 5], ['Down', -5]]) {
      const registered = globalShortcut.register(`CommandOrControl+Alt+${key}`, async () => {
        if (shortcutBusy) return;
        shortcutBusy = true;
        try { await controller.adjust(delta); } catch (error) { report(error); }
        finally { shortcutBusy = false; }
      });
      if (!registered) report(Error(`Ctrl+Alt+${key} is already used by another app. Disable Lumen hotkeys in Settings if needed.`));
    }
  }
  if (controller.settings.screenOffEnabled) {
    const shortcut = controller.settings.screenOffShortcut;
    if (!validScreenOffShortcut(shortcut) || !globalShortcut.register(shortcut, () => turnOffDisplays().catch(report))) {
      const error = Error(`${shortcut} is unavailable. Choose another display-off shortcut in Settings.`);
      if (strictScreenOff) throw error;
      report(error);
    }
  }
}
function hideWindow() { hiddenAt = Date.now(); globalShortcut.setSuspended(false); window.hide(); }

function createStorage() {
  const filename = path.join(app.getPath('userData'), 'settings.json');
  return {
    load() { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return {}; } },
    save(data) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(filename + '.tmp', filename);
    }
  };
}

function positionWindow() {
  if (!window || !tray) return;
  const anchor = tray.getBounds();
  const bounds = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const [width, height] = window.getSize();
  const x = Math.max(bounds.x + 8, Math.min(anchor.x + anchor.width / 2 - width / 2, bounds.x + bounds.width - width - 8));
  const above = anchor.y > bounds.y + bounds.height / 2;
  const y = above ? anchor.y - height - 10 : anchor.y + anchor.height + 10;
  window.setPosition(Math.round(x), Math.round(Math.max(bounds.y + 8, Math.min(y, bounds.y + bounds.height - height - 8))));
}

function showWindow() {
  if (!window) return;
  positionWindow(); window.show(); window.focus();
  controller.refresh();
}

function createWindow() {
  window = new BrowserWindow({
    width: 432, height: 320, minWidth: 432, minHeight: 160, maxWidth: 432, maxHeight: 800,
    show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#101216', webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.on('blur', () => { if (!window.webContents.isDevToolsOpened()) hideWindow(); });
  window.on('hide', () => globalShortcut.setSuspended(false));
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('did-finish-load', () => controller.notify());
}

function loginPath() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }
function loginEnabled() { return app.getLoginItemSettings({ path: loginPath() }).openAtLogin; }

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Lumen', click: showWindow },
    { label: 'Turn displays off', click: () => turnOffDisplays().catch(report) },
    { label: 'Refresh displays', click: () => controller.refresh() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: loginEnabled(), click: item => {
      app.setLoginItemSettings({ openAtLogin: item.checked, path: loginPath(), args: [] });
    } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

app.on('second-instance', showWindow);
if (primaryInstance) app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.hide();
  nativeTheme.themeSource = 'dark';
  adapter = process.platform === 'win32' && !process.argv.includes('--demo') ? new WindowsMonitors({ internal: () => screen.getAllDisplays().some(d => d.internal) }) : new DemoMonitors();
  controller = new Controller({ adapter, storage: createStorage(), emit: state => window?.webContents.send('state', state) });
  createWindow();
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray.setToolTip('Lumen · brightness');
  tray.on('click', () => { if (Date.now() - hiddenAt > 200) window.isVisible() ? hideWindow() : showWindow(); });
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  ipcMain.handle('state:get', () => controller.snapshot());
  ipcMain.handle('monitors:refresh', () => controller.refresh());
  ipcMain.handle('brightness:set', (_, args) => controller.setNow(args));
  ipcMain.handle('ramp:start', (_, args) => controller.start(args));
  ipcMain.handle('ramp:cancel', (_, id) => controller.cancel(id));
  ipcMain.handle('schedule:add', (_, args) => controller.addSchedule(args));
  ipcMain.handle('schedule:remove', (_, id) => controller.removeSchedule(id));
  ipcMain.handle('schedule:toggle', (_, id) => controller.toggleSchedule(id));
  ipcMain.handle('preset:apply', (_, name) => controller.preset(name));
  ipcMain.handle('settings:save', async (_, args) => {
    const previous = { ...controller.settings };
    await controller.configure(args);
    if (!args.settings || !['hotkeys', 'screenOffEnabled', 'screenOffShortcut'].some(key => key in args.settings)) return;
    try { registerHotkeys({ strictScreenOff: !!controller.settings.screenOffEnabled }); }
    catch (error) {
      await controller.configure({ settings: previous });
      registerHotkeys();
      throw error;
    }
  });
  ipcMain.handle('shortcuts:capture', (_, active) => globalShortcut.setSuspended(!!active));
  ipcMain.handle('displays:off', () => turnOffDisplays());
  ipcMain.handle('monitors:migrate', (_, args) => controller.migrate(args));
  ipcMain.handle('window:hide', () => window.hide());
  ipcMain.handle('window:resize', (_, height) => {
    if (!Number.isFinite(height)) return;
    const area = screen.getDisplayNearestPoint(tray.getBounds()).workArea;
    window.setSize(432, Math.max(160, Math.min(Math.round(height), 720, area.height - 24)));
    positionWindow();
  });
  await controller.refresh();
  registerHotkeys();
  powerMonitor.on('resume', () => { adapter.invalidate?.(); controller.resume().catch(report); });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => { clearTimeout(displayTimer); displayTimer = setTimeout(() => { adapter.invalidate?.(); controller.refresh(); }, 500); });
  }
  tickTimer = setInterval(() => controller.tick().catch(report), 1000);
  idleTimer = setInterval(() => controller.updateIdle(powerMonitor.getSystemIdleTime()).catch(report), 1000);
  refreshTimer = setInterval(() => controller.refresh(), 300000);
});

app.on('before-quit', () => {
  quitting = true;
  clearInterval(tickTimer); clearInterval(refreshTimer);
  clearTimeout(displayTimer);
  clearInterval(idleTimer); globalShortcut.unregisterAll();
  adapter?.close();
});
app.on('window-all-closed', () => { /* Tray app remains running. */ });
