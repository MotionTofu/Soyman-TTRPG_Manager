// One managed, authenticated window across all GM renderer windows.
function installPlayerDisplay({ BrowserWindow, ipcMain, origin, icon, preload, getDisplays = () => [] }) {
  let managed = null;
  let loading = null;
  const isDisplayRoute = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && (/^\/player-display\/?$/.test(parsed.pathname) || /^\/sessions\/\d+\/live\/show\/?$/.test(parsed.pathname));
    } catch { return false; }
  };
  // The players' page answers cutscene preparation only for the windowId in its URL; the GM is told String(win.id).
  const withWindowId = (url, win) => {
    const parsed = new URL(url);
    parsed.searchParams.set("windowId", String(win.id));
    return parsed.href;
  };
  function register(win) {
    win.webContents.on("did-finish-load", () => {
      const url = win.webContents.getURL();
      if (!isDisplayRoute(url)) return;
      if (new URL(url).searchParams.get("windowId") !== String(win.id)) { win.loadURL(withWindowId(url, win)); return; }
      if (!managed || managed.isDestroyed()) managed = win;
      win.webContents.executeJavaScript("document.documentElement.requestFullscreen()", true).catch(() => {});
    });
  }
  async function open(screen) {
    let created = null;
    try {
      const wasOpen = !!managed && !managed.isDestroyed();
      const bounds = screen && [screen.left, screen.top, screen.width, screen.height].every(Number.isFinite)
        ? { x: Math.round(screen.left), y: Math.round(screen.top), width: Math.max(200, Math.min(20000, Math.round(screen.width))),
            height: Math.max(200, Math.min(20000, Math.round(screen.height))) } : null;
      if (!wasOpen) {
        const win = new BrowserWindow({ width: 960, height: 600, ...(bounds ?? {}), title: "Показ игрокам", icon,
          backgroundColor: "#000", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
            webSecurity: true, allowRunningInsecureContent: false, preload } });
        managed = win;
        created = win;
        register(win);
        loading = win.loadURL(withWindowId(`${origin}/player-display`, win));
      } else if (bounds) {
        const fullscreen = managed.isFullScreen();
        if (fullscreen) managed.setFullScreen(false);
        managed.setBounds(bounds);
        // HTML can still consider itself fullscreen after the native window exits it.
        // Another requestFullscreen() then does nothing; restore the native state explicitly.
        if (fullscreen) managed.setFullScreen(true);
      }
      await loading;
      if (!managed || managed.isDestroyed()) throw new Error("Display closed while opening");
      if (managed.isMinimized()) managed.restore();
      managed.focus();
      return { ok: true, wasOpen, openedByCall: !wasOpen, windowId: String(managed.id), screenId: screen?.id ?? null };
    } catch {
      if (created && !created.isDestroyed()) created.close();
      if (managed === created) { managed = null; loading = null; }
      return { ok: false, reason: "Не удалось открыть окно игроков" };
    }
  }
  const trusted = (event) => {
    try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
  };
  ipcMain.handle("player-display-open", (event, screen) => trusted(event) ? open(screen) : { ok: false, reason: "Недоступно" });
  ipcMain.handle("player-display-screens", event => {
    if (!trusted(event)) return [];
    return getDisplays();
  });
  ipcMain.handle("player-display-close", (event, windowId) => {
    if (!trusted(event) || !managed || managed.isDestroyed() || String(managed.id) !== windowId) return false;
    managed.close(); managed = null; return true;
  });
  return { open, register, isDisplayRoute, getWindow: () => managed };
}
module.exports = { installPlayerDisplay };
