const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require("electron");
const path = require("path");
const { DeepAssistant } = require("./assistant.cjs");
const { ElevenLabsSpeech } = require("./elevenlabs-speech.cjs");
const { loadVoiceConfig } = require("./voice-config.cjs");
const { LocalRecognizer } = require("./local-recognizer.cjs");
const { LocalTranscriber } = require("./local-transcriber.cjs");
const { createSmashOverlay } = require("./smash-overlay.cjs");
const { clampToArea, dragPosition, nextDisplayPosition } = require("./displays.cjs");
const { normalizeMovement, keyboardStep } = require("./movement.cjs");

let win, tray, timer;
let walking = false;
let direction = 1;
let dragging = null;
let assistant;
let speech;
let smashOverlay;
let movement = { x: 0, y: 0 };
const dev = !app.isPackaged;

function publishWalking() {
  const manual = !!(movement.x || movement.y);
  win?.webContents.send("pet:walking-changed", {
    walking: walking || manual, automatic: walking, direction,
    heading: manual ? (movement.x ? Math.atan2(movement.x, movement.y) * 0.8 : movement.y < 0 ? Math.PI : 0) : null,
  });
}

function setWalking(value) {
  walking = !!value;
  publishWalking();
}

function setMovement(value) {
  movement = normalizeMovement(value);
  if (movement.x || movement.y) {
    walking = false;
    if (movement.x) direction = Math.sign(movement.x);
  }
  publishWalking();
}

function emit(channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function moveToNextDisplay() {
  if (!win) return;
  const bounds = win.getBounds();
  const position = nextDisplayPosition(bounds, screen.getAllDisplays(), screen.getDisplayMatching(bounds).id);
  win.setPosition(position.x, position.y);
}

function endDrag() {
  if (!dragging || !win) return;
  if (dragging.moved) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const position = clampToArea(win.getBounds(), area);
    win.setPosition(position.x, position.y);
  }
  dragging = null;
}

function updateDrag() {
  if (!dragging?.moved || !win) return;
  const position = dragPosition(screen.getCursorScreenPoint(), dragging.offset);
  // Do not clamp to the old monitor while the cursor crosses to another one.
  win.setPosition(position.x, position.y);
}

function create() {
  smashOverlay = createSmashOverlay({ BrowserWindow, screen });
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 340, height: 450,
    x: area.x + area.width - 370, y: area.y + area.height - 470,
    frame: false, transparent: true, backgroundColor: "#00000000",
    alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.webContents.on("did-finish-load", () => {
    publishWalking();
    if (assistant) emit("pet:assistant-state", { ...assistant.state });
  });
  win.on("blur", () => { endDrag(); setMovement({ x: 0, y: 0 }); });
  win.webContents.on("did-start-loading", () => { smashOverlay?.hide(); void assistant?.stop(); });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (dev) win.loadURL("http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.on("closed", () => { win = null; });

  let lastWalk = 0;
  let lastFrame = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!win) return;
    if (dragging) { updateDrag(); return; }
    if (movement.x || movement.y) {
      const position = keyboardStep(win.getBounds(), movement, dt, screen.getAllDisplays());
      win.setPosition(position.x, position.y);
      return;
    }
    if (!walking || Date.now() - lastWalk < 45) return;
    lastWalk = Date.now();
    const [x, y] = win.getPosition();
    const bounds = win.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    let next = x + direction * 3;
    if (next < workArea.x || next + bounds.width > workArea.x + workArea.width) {
      direction *= -1;
      next = x + direction * 3;
      publishWalking();
    }
    next = Math.max(workArea.x, Math.min(workArea.x + workArea.width - bounds.width, next));
    win.setPosition(Math.round(next), y);
  }, 16);

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show companion", click: () => win?.show() },
    { label: "Pause / resume walking", click: () => setWalking(!walking) },
    { label: "Move to next screen", click: moveToNextDisplay },
    { label: "Toggle Hey Deep microphone", click: () => { void assistant?.setEnabled(!assistant.state.enabled); } },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.setToolTip("Desktop Companion");
  tray.on("double-click", () => win?.show());

  speech = new ElevenLabsSpeech({
    ...loadVoiceConfig({ localPath: dev ? path.join(__dirname, "../.env.local") : path.join(app.getPath("userData"), ".env.local") }),
    onAudio: (packet) => emit("pet:speech-audio", packet),
    onCancel: () => emit("pet:speech-cancel"),
    recognizer: new LocalRecognizer({ transcriber: new LocalTranscriber({
      cacheDir: dev ? path.join(__dirname, "../.cache/whisper") : path.join(app.getPath("userData"), "whisper"),
    }) }),
  });
  assistant = new DeepAssistant({
    speech,
    openExternal: (url) => shell.openExternal(url),
    onState: (state) => emit("pet:assistant-state", state),
    onAction: (action) => {
      if (action === "walk") setWalking(true);
      else if (action === "stop") setWalking(false);
      else if (action === "next-screen") moveToNextDisplay();
      else emit("pet:action", action);
    },
  });
  void assistant.start();

  const recoverDisplay = () => {
    smashOverlay?.hide();
    if (!win) return;
    endDrag();
    const position = clampToArea(win.getBounds(), screen.getDisplayMatching(win.getBounds()).workArea);
    win.setPosition(position.x, position.y);
  };
  screen.on("display-removed", recoverDisplay);
  screen.on("display-metrics-changed", recoverDisplay);
}

app.whenReady().then(create);
ipcMain.on("pet:drag-start", () => {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  dragging = { moved: false, offset: { x: cursor.x - bounds.x, y: cursor.y - bounds.y } };
});
ipcMain.on("pet:drag-update", () => {
  if (!dragging) return;
  dragging.moved = true;
  updateDrag();
});
ipcMain.on("pet:drag-end", endDrag);
ipcMain.on("pet:next-screen", moveToNextDisplay);
ipcMain.on("pet:menu", () => tray?.popUpContextMenu());
ipcMain.on("pet:quit", () => app.quit());
ipcMain.on("pet:walking", (_, value) => setWalking(value));
ipcMain.on("pet:movement", (_, value) => setMovement(value));
ipcMain.on("pet:speech-finished", (_, id, error) => speech.finishPlayback(id, error));
ipcMain.on("pet:prepare-smash", () => smashOverlay?.prepare());
ipcMain.on("pet:begin-smash", () => { void assistant?.holdSoundEffect(); });
ipcMain.on("pet:smash", () => {
  if (!win) return;
  void assistant?.holdSoundEffect();
  smashOverlay?.show(win.getBounds());
});
ipcMain.on("pet:cancel-smash", () => {
  smashOverlay?.hide();
  void assistant?.releaseSoundEffect();
});
ipcMain.handle("pet:assistant-state", () => ({ ...assistant.state }));
ipcMain.handle("pet:voice-enabled", (_, enabled) => assistant.setEnabled(enabled));
ipcMain.handle("pet:listen", () => assistant.beginListening());
ipcMain.handle("pet:ask", async (_, text) => {
  try { return await assistant.ask(text); }
  catch (error) { return { ...assistant.state, error: error.message }; }
});
ipcMain.handle("pet:stop-reply", () => assistant.stop());
ipcMain.handle("pet:reaction", (_, text) => assistant.react(text));
app.on("before-quit", () => {
  clearInterval(timer);
  smashOverlay?.dispose();
  assistant?.dispose();
});
app.on("window-all-closed", () => {});
