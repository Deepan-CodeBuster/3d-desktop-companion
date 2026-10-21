import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { clampToArea, dragPosition, nextDisplayPosition } = require("../electron/displays.cjs");

const left = { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
const laptop = { id: 2, bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 824 } };

test("drag coordinates freely cross both positive and negative monitor boundaries", () => {
  assert.deepEqual(dragPosition({ x: -700, y: 250 }, { x: 100, y: 40 }), { x: -800, y: 210 });
  assert.deepEqual(dragPosition({ x: 1700, y: -300 }, { x: 100, y: 40 }), { x: 1600, y: -340 });
});

test("drop clamping uses the destination display, including a monitor above the laptop", () => {
  const bounds = { x: -2000, y: 900, width: 340, height: 450 };
  assert.deepEqual(clampToArea(bounds, left.workArea), { x: -1920, y: 590 });
  assert.deepEqual(clampToArea({ ...bounds, x: 500, y: -2000 },
    { x: 0, y: -1080, width: 1920, height: 1080 }), { x: 500, y: -1080 });
});

test("next screen cycles across monitors and keeps the window visible", () => {
  const bounds = { x: 1100, y: 300, width: 340, height: 450 };
  const onLeft = nextDisplayPosition(bounds, [laptop, left], laptop.id);
  assert.ok(onLeft.x >= -1920 && onLeft.x + 340 <= 0);
  assert.ok(onLeft.y >= 0 && onLeft.y + 450 <= 1040);
  const onLaptop = nextDisplayPosition({ ...bounds, ...onLeft }, [laptop, left], left.id);
  assert.ok(onLaptop.x >= 0 && onLaptop.x + 340 <= 1536);
});
