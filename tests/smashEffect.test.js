import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createScreenSmash, screenSmashFrame, SCREEN_SMASH_MS } from "../electron/smash-geometry.js";
import { createSmashSound } from "../src/smashSound.js";
const require = createRequire(import.meta.url);
const { createSmashOverlay } = require("../electron/smash-overlay.cjs");

function fixture() {
  const windows = [];
  const timers = new Map();
  const screen = { getDisplayMatching: () => ({ bounds: { x: -1920, y: -200, width: 1920, height: 1080 } }) };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.sent = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (channel, payload) => this.sent.push({ channel, payload });
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setAlwaysOnTop() {}
    loadFile() { return Promise.resolve(); }
    setBounds(bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; }
  }
  const effect = createSmashOverlay({ BrowserWindow: FakeWindow, screen,
    setTimer: (fn) => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimer: (id) => timers.delete(id) });
  return { effect, windows, timers };
}

test("the smash covers the current monitor, including negative desktop coordinates, without taking focus or mouse input", () => {
  const { effect, windows } = fixture();
  effect.prepare();
  const overlay = windows[0];
  overlay.webContents.emit("did-finish-load");
  effect.show({ x: -500, y: 400, width: 340, height: 450 });
  assert.deepEqual(overlay.bounds, { x: -1920, y: -200, width: 1920, height: 1080 });
  assert.equal(overlay.options.focusable, false);
  assert.equal(overlay.options.transparent, true);
  assert.equal(overlay.ignoresMouse, true);
  assert.equal(overlay.visible, true);
  assert.deepEqual(overlay.sent[0].payload.origin, { x: 1590, y: 960 });
  effect.dispose();
  assert.equal(overlay.destroyed, true);
});

test("first smash waits for its renderer, repeated smashes reuse the window, and the overlay hides automatically", () => {
  const { effect, windows, timers } = fixture();
  const companion = { x: -500, y: 400, width: 340, height: 450 };
  effect.show(companion);
  assert.equal(windows[0].visible, undefined);
  windows[0].webContents.emit("did-finish-load");
  assert.equal(windows[0].visible, true);
  effect.show(companion);
  assert.equal(windows.length, 1);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(windows[0].visible, false);
  effect.dispose();
});

test("cancelling before the effect window finishes loading prevents a delayed screen effect", () => {
  const { effect, windows } = fixture();
  effect.show({ x: -500, y: 400, width: 340, height: 450 });
  effect.hide();
  windows[0].webContents.emit("did-finish-load");
  assert.equal(windows[0].visible, false);
  assert.equal(windows[0].sent.length, 0);
  effect.dispose();
});

test("the shockwave expands across an entire monitor and all effects expire", () => {
  const geometry = createScreenSmash(1920, 1080, { x: 1680, y: 900 }, 53);
  const early = screenSmashFrame(geometry, 40);
  const late = screenSmashFrame(geometry, 800);
  assert.ok(late.rings[0].radius > 1500, "the impact must reach far beyond the companion's window");
  assert.ok(late.rings[0].radius > early.rings[0].radius);
  assert.ok(geometry.cracks.some((crack) => crack.points.some((point) => point.x < 300)));
  assert.ok(late.debris.every((piece) => [piece.x, piece.y, piece.rotation].every(Number.isFinite)));
  assert.equal(screenSmashFrame(geometry, SCREEN_SMASH_MS).done, true);
  assert.equal(screenSmashFrame(geometry, SCREEN_SMASH_MS).crackOpacity, 0);
});

test("the bundled smash sound is valid, audible PCM with a bounded peak and a quiet ending", () => {
  const wav = fs.readFileSync(new URL("../public/sounds/hulk-smash.wav", import.meta.url));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt16LE(34), 16);
  let peak = 0, energy = 0;
  for (let i = 44; i < wav.length; i += 2) {
    const value = wav.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(value)); energy += value * value;
  }
  assert.ok(peak > 0.7 && peak < 0.9);
  assert.ok(Math.sqrt(energy / ((wav.length - 44) / 2)) > 0.08);
  assert.ok(Math.abs(wav.readInt16LE(wav.length - 2)) < 10);
});

test("the cached shout plays separately, remains audible over the impact, and both clips stop on character change", async () => {
  const clips = [];
  const sound = createSmashSound({ makeAudio: (src) => {
    const audio = { src, currentTime: 42, paused: true, ended: false, pauseCount: 0, plays: 0,
      pause() { this.paused = true; this.pauseCount++; },
      play() { this.paused = false; this.plays++; return Promise.resolve(); },
      removeAttribute() { this.released = true; }, load() {} };
    clips.push(audio);
    return audio;
  } });
  const [impact, voice] = clips;
  assert.ok(voice.src.endsWith("hulk-smash-voice.mp3"));
  assert.equal(sound.speaking, false);
  await sound.speak();
  assert.equal(sound.speaking, true);
  assert.equal(voice.currentTime, 0);
  assert.equal(voice.volume, 1);
  assert.equal(impact.plays, 0, "the shout must not trigger an early impact sound");
  await sound.play();
  assert.equal(impact.currentTime, 0);
  assert.equal(impact.plays, 1);
  assert.equal(impact.volume, 0.55);
  voice.ended = true;
  assert.equal(sound.speaking, false);
  await sound.play();
  assert.equal(impact.plays, 2);
  assert.equal(impact.volume, 0.75);
  sound.stop();
  assert.ok(clips.every((audio) => audio.paused && audio.currentTime === 0));
  sound.dispose();
  assert.ok(clips.every((audio) => audio.released));
  assert.equal(voice.pauseCount, 3);
  assert.equal(impact.pauseCount, 4);
});
