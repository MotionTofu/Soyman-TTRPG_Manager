const { contextBridge, ipcRenderer } = require("electron");

// Minimal bridge for renderer-side native dialogs/updates. Kept intentionally
// small — expand only as the app actually needs more native OS interaction,
// not speculatively.
contextBridge.exposeInMainWorld("electronAPI", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  // Returns an unsubscribe function, same shape as a DOM addEventListener
  // cleanup — React effects can call it directly on unmount.
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
