'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Controller } = require('./controller');
const { WindowsMonitors } = require('./monitor/windows');
const { DemoMonitors } = require('./monitor/demo');

if (!app.requestSingleInstanceLock()) app.quit();

let window, tray, controller, adapter, refreshTimer, tickTimer;
let quitting = false;

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

function showWindow() {
  if (!window) return;
  const anchor = tray.getBounds();
  const bounds = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  const [width, height] = window.getSize();
  const x = Math.max(bounds.x + 8, Math.min(anchor.x + anchor.width / 2 - width / 2, bounds.x + bounds.width - width - 8));
  const above = anchor.y > bounds.y + bounds.height / 2;
  const y = above ? anchor.y - height - 10 : anchor.y + anchor.height + 10;
  window.setPosition(Math.round(x), Math.round(Math.max(bounds.y + 8, Math.min(y, bounds.y + bounds.height - height - 8))));
  window.show(); window.focus();
  controller.refresh();
}

function createWindow() {
  window = new BrowserWindow({
    width: 432, height: 648, minWidth: 432, minHeight: 648, maxWidth: 432, maxHeight: 648,
    show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#101216', webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.on('blur', () => { if (!window.webContents.isDevToolsOpened()) window.hide(); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('did-finish-load', () => controller.notify());
}

function loginPath() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }
function loginEnabled() { return app.getLoginItemSettings({ path: loginPath() }).openAtLogin; }

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Lumen', click: showWindow },
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
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.hide();
  nativeTheme.themeSource = 'dark';
  adapter = process.platform === 'win32' ? new WindowsMonitors() : new DemoMonitors();
  controller = new Controller({ adapter, storage: createStorage(), emit: state => window?.webContents.send('state', state) });
  createWindow();
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray.setToolTip('Lumen · brightness');
  tray.on('click', () => window.isVisible() ? window.hide() : showWindow());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  ipcMain.handle('state:get', () => controller.snapshot());
  ipcMain.handle('monitors:refresh', () => controller.refresh());
  ipcMain.handle('brightness:set', (_, args) => controller.setNow(args));
  ipcMain.handle('ramp:start', (_, args) => controller.start(args));
  ipcMain.handle('ramp:cancel', (_, id) => controller.cancel(id));
  ipcMain.handle('schedule:add', (_, args) => controller.addSchedule(args));
  ipcMain.handle('schedule:remove', (_, id) => controller.removeSchedule(id));
  ipcMain.handle('schedule:toggle', (_, id) => controller.toggleSchedule(id));
  ipcMain.handle('window:hide', () => window.hide());
  await controller.refresh();
  tickTimer = setInterval(() => controller.tick(), 1000);
  refreshTimer = setInterval(() => controller.refresh(), 300000);
});

app.on('before-quit', () => {
  quitting = true;
  clearInterval(tickTimer); clearInterval(refreshTimer);
  adapter?.close();
});
app.on('window-all-closed', () => { /* Tray app remains running. */ });
