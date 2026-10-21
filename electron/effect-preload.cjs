const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("effects", {
  onSmash(callback) {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("effect:smash", listener);
    return () => ipcRenderer.removeListener("effect:smash", listener);
  },
});
