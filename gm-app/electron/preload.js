const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmApp", {
  getState: () => ipcRenderer.invoke("get-state"),
  connect: (serverUrl, username, password, remember) =>
    ipcRenderer.invoke("connect", { serverUrl, username, password, remember }),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  apiGet: (path) => ipcRenderer.invoke("api-get", { path }),
  apiPost: (path, body) => ipcRenderer.invoke("api-post", { path, body }),
});
