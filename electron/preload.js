const { contextBridge, ipcRenderer } = require("electron");

// Minimal bridge for renderer-side native dialogs/updates. Kept intentionally
// small — expand only as the app actually needs more native OS interaction,
// not speculatively.
contextBridge.exposeInMainWorld("electronAPI", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  // После нативного confirm/alert окно на Windows остаётся без клавиатурного
  // фокуса, и страница перестаёт принимать ввод до переключения на другое окно
  // и обратно. Клиент дёргает это сразу после диалога — см.
  // installNativeDialogFocusFix в client/src/electronApi.ts.
  restoreFocus: () => ipcRenderer.send("restore-focus"),
  // Открыть ещё одно окно приложения на указанном маршруте. Все окна работают
  // с одним сервером и одной базой — см. spawnWindow в electron/main.js.
  openWindow: (route) => ipcRenderer.send("open-window", route),
  // Открыть внешний URL в браузере пользователя по умолчанию
  // (shell.openExternal) — сам рендерер открывать его не должен, иначе ссылка
  // уйдёт в новое окно Electron, а не в браузер. См. ipcMain "open-external".
  openExternal: (url) => ipcRenderer.send("open-external", url),
  // Открыть Telegram автора: сначала установленный клиент (tg://), при его
  // отсутствии — страница t.me в браузере. См. ipcMain "open-telegram".
  openTelegram: () => ipcRenderer.send("open-telegram"),
  // Returns an unsubscribe function, same shape as a DOM addEventListener
  // cleanup — React effects can call it directly on unmount.
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
