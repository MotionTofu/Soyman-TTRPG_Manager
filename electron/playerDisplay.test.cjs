const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installPlayerDisplay } = require('./playerDisplay');

test('одно окно через разные обращения и закрытие только по его идентичности', async () => {
  const handlers = {}, windows = [];
  class Window {
    constructor(options) { this.options = options; this.id = windows.length + 1; this.destroyed = false; this.events = {};
      this.webContents = { on: (name, cb) => { this.events[name] = cb; }, getURL: () => this.url, executeJavaScript: async () => {} }; windows.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); } isDestroyed() { return this.destroyed; }
    isMinimized() { return false; } isFullScreen() { return false; } focus() {} setBounds(bounds) { this.bounds = bounds; } close() { this.destroyed = true; }
  }
  installPlayerDisplay({ BrowserWindow: Window, ipcMain: { handle: (name, cb) => { handlers[name] = cb; } },
    origin: 'http://127.0.0.1:4732', icon: 'fixture', preload: 'fixture' });
  const event = { senderFrame: { url: 'http://127.0.0.1:4732/' } };
  const first = await handlers['player-display-open'](event, null), second = await handlers['player-display-open'](event, null);
  assert.equal(first.openedByCall, true); assert.equal(second.wasOpen, true); assert.equal(windows.length, 1);
  // The players' page answers cutscene preparation only for the windowId in its URL.
  assert.equal(new URL(windows[0].url).searchParams.get('windowId'), first.windowId);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(handlers['player-display-close'](event, 'stale'), false);
  assert.equal(handlers['player-display-close'](event, first.windowId), true);
  assert.equal(handlers['player-display-open']({ senderFrame: { url: 'https://other.invalid/' } }, null).ok, false);
});

test('окно показа, открытое иначе, перезагружается со своим windowId', () => {
  const loads = [];
  const win = { id: 7, events: {}, loadURL: url => { loads.push(url); win.url = url; },
    webContents: { on: (name, cb) => { win.events[name] = cb; }, getURL: () => win.url, executeJavaScript: async () => {} } };
  const display = installPlayerDisplay({ BrowserWindow: class {}, ipcMain: { handle() {} }, origin: 'http://127.0.0.1:4732', icon: 'fixture', preload: 'fixture' });
  display.register(win);
  win.url = 'http://127.0.0.1:4732/player-display'; win.events['did-finish-load']();
  assert.deepEqual(loads, ['http://127.0.0.1:4732/player-display?windowId=7']);
  win.events['did-finish-load']();
  assert.equal(loads.length, 1); assert.equal(display.getWindow(), win);
});

test('перенос существующего показа сохраняет нативный fullscreen при уже полноэкранном DOM', async () => {
  const handlers = {}, windows = [];
  class Window {
    constructor() { this.id = 1; this.fullscreen = true; this.fullscreenChanges = []; this.events = {};
      this.webContents = { on: (name, cb) => { this.events[name] = cb; }, getURL: () => this.url,
        // DOM is already fullscreen: repeating its request does not re-enter native fullscreen.
        executeJavaScript: async () => {} }; windows.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); } isDestroyed() { return false; }
    isMinimized() { return false; } isFullScreen() { return this.fullscreen; } focus() {}
    setFullScreen(value) { this.fullscreen = value; this.fullscreenChanges.push(value); }
    setBounds(bounds) { this.bounds = bounds; }
  }
  installPlayerDisplay({ BrowserWindow: Window, ipcMain: { handle: (name, cb) => { handlers[name] = cb; } },
    origin: 'http://127.0.0.1:4732', icon: 'fixture', preload: 'fixture' });
  const event = { senderFrame: { url: 'http://127.0.0.1:4732/' } };
  const first = await handlers['player-display-open'](event, null);
  const screen = { id: 'portrait', left: 1920, top: -840, width: 1080, height: 1920 };
  const reused = await handlers['player-display-open'](event, screen);
  assert.equal(reused.windowId, first.windowId); assert.equal(reused.wasOpen, true); assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].bounds, { x: 1920, y: -840, width: 1080, height: 1920 });
  assert.equal(windows[0].isFullScreen(), true); assert.deepEqual(windows[0].fullscreenChanges, [false, true]);
});
