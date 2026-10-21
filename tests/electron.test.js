import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);

function desktopFixture() {
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 },
    workArea: { x: 0, y: 0, width: 1536, height: 824 } };
  const secondary = { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
  const events = new Map();
  const handles = new Map();
  const screenEvents = new Map();
  const appEvents = new Map();
  const sent = [];
  const smashCalls = [];
  let cursor = { x: 1200, y: 450 };
  let displays = [primary, secondary];
  let window, menu, tick;
  let now = 1000;
  const windowEvents = new Map();
  class FakeWindow {
    constructor(options) {
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = { send: (channel, value) => sent.push({ channel, value }), on() {}, setWindowOpenHandler() {} };
      window = this;
    }
    setAlwaysOnTop() {} loadURL() {} loadFile() {} on(name, fn) { windowEvents.set(name, fn); } isDestroyed() { return false; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    getBounds() { return { ...this.bounds }; }
    setPosition(x, y) { Object.assign(this.bounds, { x, y }); }
  }
  class FakeAssistant {
    state = { enabled: true, phase: "wake" };
    constructor(options) { this.options = options; }
    async start() {}
    async ask(text) { return { reply: `Got ${text}` }; }
    async setEnabled(enabled) { this.state.enabled = enabled; return this.state; }
    async beginListening() { return { ...this.state, phase: "listening" }; }
    stop() { return this.state; }
    async react() {}
    async holdSoundEffect() { smashCalls.push("hold"); }
    async releaseSoundEffect() { smashCalls.push("release"); }
    dispose() {}
  }
  class FakeSpeech {
    finishPlayback() {}
  }
  class FakeRecognizer {}
  class FakeTranscriber {}
  const fakeSmashOverlay = { prepare: () => smashCalls.push("prepare"), show: () => smashCalls.push("show"),
    hide: () => smashCalls.push("hide"), dispose: () => smashCalls.push("dispose") };
  const electron = {
    app: { isPackaged: false, whenReady: () => ({ then: (fn) => fn() }), on: (name, fn) => appEvents.set(name, fn), quit() {} },
    BrowserWindow: FakeWindow,
    Tray: class { setContextMenu(value) { menu = value; } setToolTip() {} on() {} },
    Menu: { buildFromTemplate: (value) => value },
    ipcMain: { on: (name, fn) => events.set(name, fn), handle: (name, fn) => handles.set(name, fn) },
    screen: {
      getPrimaryDisplay: () => primary, getAllDisplays: () => displays,
      getCursorScreenPoint: () => cursor,
      getDisplayMatching: (bounds) => displays.find((display) =>
        bounds.x + bounds.width / 2 >= display.bounds.x && bounds.x + bounds.width / 2 < display.bounds.x + display.bounds.width) || primary,
      getDisplayNearestPoint: (point) => point.x < 0 && displays.includes(secondary) ? secondary : primary,
      on: (name, fn) => screenEvents.set(name, fn),
    },
    nativeImage: { createFromPath() {} }, shell: { openExternal: async () => {} },
  };
  vm.runInNewContext(fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8"), {
    require: (name) => name === "electron" ? electron : name === "path" ? path
      : name === "./assistant.cjs" ? { DeepAssistant: FakeAssistant }
        : name === "./elevenlabs-speech.cjs" ? { ElevenLabsSpeech: FakeSpeech }
          : name === "./local-recognizer.cjs" ? { LocalRecognizer: FakeRecognizer }
            : name === "./local-transcriber.cjs" ? { LocalTranscriber: FakeTranscriber }
              : name === "./smash-overlay.cjs" ? { createSmashOverlay: () => fakeSmashOverlay }
          : name === "./voice-config.cjs" ? { loadVoiceConfig: () => ({ apiKey: "test-only-key" }) }
          : name === "./movement.cjs" ? require("../electron/movement.cjs") : require("../electron/displays.cjs"),
    __dirname: path.resolve("electron"),
    setInterval: (fn) => { tick = fn; }, clearInterval() {},
    Date: { now: () => now },
  });
  return { window, menu, events, handles, sent, screenEvents, tick, windowEvents, smashCalls, advance: (ms) => { now += ms; tick(); },
    setCursor: (point) => { cursor = point; }, removeSecondary: () => { displays = [primary]; } };
}

test("Electron drag IPC crosses to another monitor and clamps only on drop", () => {
  const { window, events, setCursor, tick } = desktopFixture();
  const before = window.getBounds();
  setCursor({ x: before.x + 100, y: before.y + 100 });
  events.get("pet:drag-start")();
  setCursor({ x: -1000, y: 300 });
  events.get("pet:drag-update")();
  tick();
  assert.equal(window.bounds.x, -1100);
  assert.equal(window.bounds.y, 200);
  events.get("pet:drag-end")();
  assert.equal(window.bounds.x, -1100);
  assert.equal(window.bounds.y, 200);
});

test("next-screen button and display removal keep the companion reachable", () => {
  const { window, events, screenEvents, removeSecondary } = desktopFixture();
  events.get("pet:next-screen")();
  assert.ok(window.bounds.x < 0);
  removeSecondary();
  screenEvents.get("display-removed")();
  assert.ok(window.bounds.x >= 0);
  assert.ok(window.bounds.x + window.bounds.width <= 1536);
});

test("assistant IPC connects typed questions and microphone controls", async () => {
  const { handles } = desktopFixture();
  assert.equal((await handles.get("pet:ask")(null, "hello")).reply, "Got hello");
  assert.equal((await handles.get("pet:voice-enabled")(null, false)).enabled, false);
  assert.equal((await handles.get("pet:listen")()).phase, "listening");
});

test("smash IPC holds recognition before the shout and renews it for the landing effect", () => {
  const { events, smashCalls } = desktopFixture();
  events.get("pet:prepare-smash")();
  events.get("pet:begin-smash")();
  assert.deepEqual(smashCalls, ["prepare", "hold"], "takeoff must not show an impact yet");
  events.get("pet:smash")();
  events.get("pet:cancel-smash")();
  assert.deepEqual(smashCalls, ["prepare", "hold", "hold", "show", "hide", "release"]);
});

test("manual movement animates on keydown and stops on keyup or window blur", () => {
  const { window, events, sent, windowEvents, advance } = desktopFixture();
  const start = window.bounds.y;
  events.get("pet:movement")(null, { x: 0, y: -1 });
  advance(50);
  assert.ok(window.bounds.y < start);
  assert.equal(sent.at(-1).value.walking, true);
  events.get("pet:movement")(null, { x: 0, y: 0 });
  const stopped = window.bounds.y;
  advance(50);
  assert.equal(window.bounds.y, stopped);
  events.get("pet:movement")(null, { x: -1, y: 0 });
  windowEvents.get("blur")();
  const stoppedX = window.bounds.x;
  advance(50);
  assert.equal(window.bounds.x, stoppedX);
  assert.equal(sent.at(-1).value.walking, false);
});

test("preload forwards narrow APIs and unsubscribes assistant listeners", () => {
  let api;
  const sent = [];
  const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_, value) => { api = value; } },
      ipcRenderer: {
        send: (...args) => sent.push(args), invoke: (...args) => Promise.resolve(args),
        on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
      },
    }),
  });
  api.startDrag(); api.updateDrag(); api.endDrag(); api.nextScreen();
  assert.deepEqual(sent.map(([channel]) => channel), ["pet:drag-start", "pet:drag-update", "pet:drag-end", "pet:next-screen"]);
  api.beginSmash();
  assert.equal(sent.at(-1)[0], "pet:begin-smash");
  let state;
  const unsubscribe = api.onAssistantState((value) => { state = value; });
  listeners.get("pet:assistant-state")(null, { phase: "listening" });
  assert.equal(state.phase, "listening");
  unsubscribe();
  assert.equal(listeners.size, 0);
});
