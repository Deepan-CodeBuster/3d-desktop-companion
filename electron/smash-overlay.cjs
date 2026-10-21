const path = require("node:path");

function createSmashOverlay({ BrowserWindow, screen, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let window, ready = false, pending, hideTimer;

  function hide() {
    clearTimer(hideTimer);
    pending = null;
    window?.hide();
  }

  function display(payload) {
    if (!window || !ready) return;
    clearTimer(hideTimer);
    window.setBounds(payload.bounds, false);
    window.showInactive();
    window.webContents.send("effect:smash", payload);
    hideTimer = setTimer(hide, 1800);
  }

  function prepare() {
    if (window) return;
    const overlay = new BrowserWindow({
      width: 1, height: 1, show: false, frame: false, transparent: true,
      backgroundColor: "#00000000", alwaysOnTop: true, skipTaskbar: true,
      focusable: false, resizable: false, movable: false, hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, "effect-preload.cjs"),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    window = overlay;
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, "floating");
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    overlay.webContents.on("did-finish-load", () => {
      if (window !== overlay) return;
      ready = true;
      if (pending) { const payload = pending; pending = null; display(payload); }
    });
    overlay.on("closed", () => {
      if (window !== overlay) return;
      window = null;
      ready = false;
      clearTimer(hideTimer);
    });
    void overlay.loadFile(path.join(__dirname, "smash-effect.html")).catch(() => {
      if (window !== overlay) return;
      window = null;
      ready = false;
      pending = null;
      overlay.destroy();
    });
  }

  return {
    prepare,
    show(companion) {
      const { bounds } = screen.getDisplayMatching(companion);
      const payload = {
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        origin: {
          x: Math.max(0, Math.min(bounds.width, companion.x + companion.width / 2 - bounds.x)),
          y: Math.max(0, Math.min(bounds.height, companion.y + companion.height * 0.8 - bounds.y)),
        },
        seed: Date.now() >>> 0,
      };
      prepare();
      if (ready) display(payload);
      else pending = payload;
    },
    hide,
    dispose() {
      hide();
      const previous = window;
      window = null;
      ready = false;
      previous?.destroy();
    },
  };
}

module.exports = { createSmashOverlay };
