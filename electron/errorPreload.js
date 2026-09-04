// Мост для аварийного экрана (error.html). Отдельный от preload.js
// сознательно: тот открывает рендереру полтора десятка каналов, включая
// диалоги и запуск внешних ссылок, а этому окну нужно ровно три действия и
// текст ошибки. Экран показывается в состоянии, когда о приложении ничего не
// известно, — давать ему больше прав, чем нужно, незачем.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("startupError", {
  details: () => ipcRenderer.invoke("startup-error-details"),
  openLog: () => ipcRenderer.send("startup-error-open-log"),
  openDataDir: () => ipcRenderer.send("startup-error-open-data"),
  close: () => ipcRenderer.send("startup-error-close"),
});
