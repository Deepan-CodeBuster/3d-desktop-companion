import assert from "node:assert/strict";
import test from "node:test";
import { touchRegion } from "../src/reactions.js";

test("character mesh hits distinguish face, hands, belly, and both legs", () => {
  assert.equal(touchRegion("Head", { x: 0, y: 2.2 }), "face");
  assert.equal(touchRegion("Hair", { x: 0, y: 2.8 }), "face");
  assert.equal(touchRegion("Hands", { x: -0.3, y: 1.1 }), "hand.R");
  assert.equal(touchRegion("Hands", { x: 0.3, y: 1.1 }), "hand.L");
  assert.equal(touchRegion("Plush", { x: 0.1, y: 1.5 }), "belly");
  assert.equal(touchRegion("Shoes", { x: 0.2, y: 0.1 }), "leg.L");
  assert.equal(touchRegion("Legs", { x: -0.2, y: 0.6 }), "leg.R");
});
