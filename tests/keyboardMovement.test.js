import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createKeyboardMovement } from "../src/keyboardMovement.js";
const require = createRequire(import.meta.url);
const { normalizeMovement, keyboardStep } = require("../electron/movement.cjs");

function key(key, editing = false) {
  return { key, prevented: false, target: { closest: () => editing }, preventDefault() { this.prevented = true; } };
}

test("holding arrows handles diagonals, ignores repeats, and stops on release or blur", () => {
  const sent = [];
  const keyboard = createKeyboardMovement((value) => sent.push(value));
  keyboard.keyDown(key("ArrowLeft"));
  keyboard.keyDown(key("ArrowLeft"));
  keyboard.keyDown(key("ArrowUp"));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.at(-1), { x: -1, y: -1 });
  keyboard.keyUp(key("ArrowLeft"));
  assert.deepEqual(sent.at(-1), { x: 0, y: -1 });
  keyboard.keyUp(key("ArrowUp"));
  assert.deepEqual(sent.at(-1), { x: 0, y: 0 });
  keyboard.keyDown(key("ArrowDown"));
  keyboard.reset();
  assert.deepEqual(sent.at(-1), { x: 0, y: 0 });
});

test("Chat text editing and modifier shortcuts do not move the companion", () => {
  const sent = [];
  const keyboard = createKeyboardMovement((value) => sent.push(value));
  const editing = key("ArrowLeft", true);
  keyboard.keyDown(editing);
  keyboard.keyDown({ ...key("ArrowUp"), ctrlKey: true });
  assert.equal(sent.length, 0);
  assert.equal(editing.prevented, false);
});

test("movement is normalized, supports all four directions, and crosses monitor edges", () => {
  const displays = [
    { bounds: { x: -1000, y: 0, width: 1000, height: 900 }, workArea: { x: -1000, y: 0, width: 1000, height: 860 } },
    { bounds: { x: 0, y: 0, width: 1200, height: 900 }, workArea: { x: 0, y: 0, width: 1200, height: 860 } },
  ];
  assert.ok(Math.abs(Math.hypot(...Object.values(normalizeMovement({ x: 1, y: 1 }))) - 1) < 0.00001);
  assert.deepEqual(normalizeMovement({ x: NaN, y: Infinity }), { x: 0, y: 0 });
  const bounds = { x: 300, y: 200, width: 340, height: 450 };
  assert.ok(keyboardStep(bounds, { x: -1, y: 0 }, 0.05, displays).x < bounds.x);
  assert.ok(keyboardStep(bounds, { x: 1, y: 0 }, 0.05, displays).x > bounds.x);
  assert.ok(keyboardStep(bounds, { x: 0, y: -1 }, 0.05, displays).y < bounds.y);
  assert.ok(keyboardStep(bounds, { x: 0, y: 1 }, 0.05, displays).y > bounds.y);
  const crossing = keyboardStep({ ...bounds, x: -5 }, { x: 1, y: 0 }, 0.05, displays);
  assert.equal(crossing.x, 6);
  assert.equal(keyboardStep({ ...bounds, x: -999 }, { x: -1, y: 0 }, 0.05, displays).x, -1000);
});

test("WASD combines with arrows without double-counting a direction", () => {
  const sent = [];
  const keyboard = createKeyboardMovement((value) => sent.push(value));
  keyboard.keyDown(key("w"));
  keyboard.keyDown(key("ArrowUp"));
  keyboard.keyDown(key("D"));
  assert.deepEqual(sent.at(-1), { x: 1, y: -1 });
  keyboard.keyUp(key("w"));
  assert.deepEqual(sent.at(-1), { x: 1, y: -1 });
  keyboard.keyUp(key("ArrowUp"));
  assert.deepEqual(sent.at(-1), { x: 1, y: 0 });
  keyboard.keyDown(key("a"));
  assert.deepEqual(sent.at(-1), { x: 0, y: 0 });
  keyboard.reset();
  keyboard.keyDown(key("s"));
  assert.deepEqual(sent.at(-1), { x: 0, y: 1 });
});

test("Space hops and H waves once per press, including when a button has focus", () => {
  const gestures = [];
  const keyboard = createKeyboardMovement(() => {}, (value) => gestures.push(value));
  const space = key(" ");
  keyboard.keyDown(space);
  keyboard.keyDown({ ...key(" "), repeat: true });
  assert.equal(space.prevented, true);
  keyboard.keyUp(key(" "));
  keyboard.keyDown(key(" "));
  keyboard.keyDown(key("h"));
  keyboard.keyDown({ ...key("H"), repeat: true });
  keyboard.keyUp(key("h"));
  keyboard.keyDown({ ...key("H"), code: "KeyH" });
  assert.deepEqual(gestures, ["hop", "hop", "wave", "wave"]);
});

test("WASD, Space, and H remain normal characters in Chat", () => {
  const sent = [];
  const gestures = [];
  const keyboard = createKeyboardMovement((value) => sent.push(value), (value) => gestures.push(value));
  for (const value of ["w", "a", "s", "d", "h", " "]) {
    const event = key(value, true);
    keyboard.keyDown(event);
    assert.equal(event.prevented, false);
  }
  assert.equal(sent.length, 0);
  assert.equal(gestures.length, 0);
});
