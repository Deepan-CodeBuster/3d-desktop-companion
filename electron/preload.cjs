const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  startDrag: () => ipcRenderer.send("pet:drag-start"),
  updateDrag: () => ipcRenderer.send("pet:drag-update"),
  endDrag: () => ipcRenderer.send("pet:drag-end"),
  nextScreen: () => ipcRenderer.send("pet:next-screen"),
  menu: () => ipcRenderer.send("pet:menu"),
  quit: () => ipcRenderer.send("pet:quit"),
  setWalking: (value) => ipcRenderer.send("pet:walking", value),
  setMovement: (value) => ipcRenderer.send("pet:movement", value),
  prepareSmash: () => ipcRenderer.send("pet:prepare-smash"),
  beginSmash: () => ipcRenderer.send("pet:begin-smash"),
  smash: () => ipcRenderer.send("pet:smash"),
  cancelSmash: () => ipcRenderer.send("pet:cancel-smash"),
  beginListening: () => ipcRenderer.invoke("pet:listen"),
  finishSpeech: (id, error) => ipcRenderer.send("pet:speech-finished", id, error),
  onSpeechAudio: (callback) => {
    const listener = (_, packet) => callback(packet);
    ipcRenderer.on("pet:speech-audio", listener);
    return () => ipcRenderer.removeListener("pet:speech-audio", listener);
  },
  onSpeechCancel: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("pet:speech-cancel", listener);
    return () => ipcRenderer.removeListener("pet:speech-cancel", listener);
  },
  getAssistantState: () => ipcRenderer.invoke("pet:assistant-state"),
  setVoiceEnabled: (enabled) => ipcRenderer.invoke("pet:voice-enabled", enabled),
  ask: (text) => ipcRenderer.invoke("pet:ask", text),
  stopReply: () => ipcRenderer.invoke("pet:stop-reply"),
  react: (text) => ipcRenderer.invoke("pet:reaction", text),
  onAssistantState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("pet:assistant-state", listener);
    return () => ipcRenderer.removeListener("pet:assistant-state", listener);
  },
  onAction: (callback) => {
    const listener = (_, action) => callback(action);
    ipcRenderer.on("pet:action", listener);
    return () => ipcRenderer.removeListener("pet:action", listener);
  },
  onWalkingChanged: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("pet:walking-changed", listener);
    return () => ipcRenderer.removeListener("pet:walking-changed", listener);
  },
});
