const { contextBridge, ipcRenderer } = require("electron");

// Minimal bridge for renderer-side native dialogs. Kept intentionally tiny
// (one method) — expand only as the app actually needs more native OS
// interaction, not speculatively.
contextBridge.exposeInMainWorld("electronAPI", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
});
