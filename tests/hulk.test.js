import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { hulkFixture } from "./hulkFixture.js";
import { CHARACTERS, getCharacter, savedCharacter } from "../src/characters.js";
import { createSmashEffect, smashMotion, smashCamera, SMASH_IMPACT, SMASH_VOICE, SMASH_DURATION } from "../src/hulkSmash.js";
import { createCharacterPicker } from "../src/reactions.js";

const advance = (animator, state, frames = 90) => {
  for (let i = 0; i < frames; i++) animator.update(1 / 60, state);
};
const position = (bone) => bone.getWorldPosition(new THREE.Vector3());

test("character choices preserve a valid saved selection and map Space to each character's action", () => {
  assert.deepEqual(CHARACTERS.map((character) => character.id), ["deep", "hulk"]);
  assert.equal(getCharacter("deep").special, "hop");
  assert.equal(getCharacter("hulk").special, "smash");
  assert.equal(savedCharacter({ getItem: () => "hulk" }), "hulk");
  assert.equal(savedCharacter({ getItem: () => "removed-character" }), "deep");
  assert.equal(savedCharacter({ getItem() { throw new Error("Storage unavailable"); } }), "deep");
});

test("the supplied Hulk GLB has a usable rig, mesh, embedded texture, and idle clips", async () => {
  const { mesh, bones, gltf } = await hulkFixture();
  assert.ok(mesh.isSkinnedMesh);
  assert.ok(mesh.material.map);
  for (const name of ["Hips", "Spine", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot"]) assert.ok(bones[name], name);
  assert.equal(gltf.animations.length, 2);
});

test("Hulk walks with alternating feet and waves above his shoulder", async () => {
  const { animator, bones, character, mesh } = await hulkFixture();
  advance(animator);
  character.updateMatrixWorld(true);
  mesh.skeleton.update();
  const idle = position(bones.RightHand);
  advance(animator, { walking: true, direction: -1 });
  character.updateMatrixWorld(true);
  const footDepth = () => character.worldToLocal(position(bones.LeftFoot)).z - character.worldToLocal(position(bones.RightFoot)).z;
  const firstStep = footDepth();
  advance(animator, { walking: true, direction: -1 }, 25);
  character.updateMatrixWorld(true);
  assert.ok(firstStep * footDepth() < 0, "the opposite foot leads after half a stride");
  assert.ok(character.rotation.y < -0.9);
  advance(animator, { waving: true });
  character.updateMatrixWorld(true);
  assert.ok(position(bones.RightHand).y > position(bones.RightArm).y + 0.3);
  assert.ok(position(bones.RightHand).y > idle.y + 1);
});

test("Hulk leaps high with both feet airborne, descends into a grounded smash, and stands again", async () => {
  const { animator, bones, character, model } = await hulkFixture();
  advance(animator);
  const root = character.position.y;
  animator.update(0, { smashProgress: 0.38 });
  character.updateMatrixWorld(true);
  const windup = [position(bones.LeftHand), position(bones.RightHand)];
  assert.ok(character.position.y - root > 1.1, "the leap must be much higher than Deep's regular hop");
  assert.ok([bones.LeftFoot, bones.RightFoot].every((bone) => position(bone).y > 1.2), "both feet leave the ground");
  assert.ok(windup.every((point) => point.y > 3.5), "raised fists must travel up with Hulk");
  const apex = character.position.y;
  animator.update(0, { smashProgress: 0.57 });
  assert.ok(character.position.y < apex - 0.5 && character.position.y > root, "Hulk falls toward the floor before impact");
  animator.update(0, { smashProgress: SMASH_IMPACT });
  character.updateMatrixWorld(true);
  for (const [index, hand] of [bones.LeftHand, bones.RightHand].entries()) {
    const hit = position(hand);
    assert.ok(hit.y < 0.35 && hit.y > 0.1, "the large knuckles must strike the floor");
    assert.ok(windup[index].y - hit.y > 2, "both fists must swing down from overhead");
    assert.ok(hit.z > 0.7, "impact must be in front of Hulk");
  }
  advance(animator, { smashProgress: 1 }, 120);
  character.updateMatrixWorld(true);
  assert.ok(position(bones.Head).y > 2.3);
  assert.ok(Math.abs(character.position.y) < 0.01);
  model.traverse((object) => {
    assert.ok(object.position.toArray().every(Number.isFinite));
    assert.ok(object.quaternion.toArray().every(Number.isFinite));
  });
});

test("the shout happens in flight, with impact and camera reset only at landing", () => {
  assert.equal(getCharacter("hulk").duration, SMASH_DURATION);
  assert.ok(SMASH_VOICE > 0.12 && SMASH_VOICE < SMASH_IMPACT);
  assert.ok(smashMotion(SMASH_VOICE).lift > 0.5);
  assert.ok(smashMotion(SMASH_IMPACT - 0.01).lift > 0);
  assert.equal(smashMotion(SMASH_IMPACT - 0.01).impact, 0);
  assert.equal(smashMotion(SMASH_IMPACT).lift, 0);
  assert.equal(smashMotion(SMASH_IMPACT).impact, 1);
  assert.ok(smashCamera(0.38).z > 10);
  assert.deepEqual(smashCamera(SMASH_IMPACT), { y: 0.05, z: 8 });
  for (const progress of [-1, 1, Infinity, NaN]) assert.equal(smashMotion(progress).active, false);
});

test("smash impact grows a shockwave and debris, and clears on completion or character switch", () => {
  const scene = new THREE.Scene();
  const effect = createSmashEffect(scene, -1.18);
  effect.update(0.3);
  assert.equal(effect.group.visible, false);
  effect.update(SMASH_IMPACT + 0.02);
  assert.equal(effect.group.visible, true);
  const firstSize = effect.group.children[0].scale.x;
  const shake = effect.update(SMASH_IMPACT + 0.12);
  assert.ok(effect.group.children[0].scale.x > firstSize);
  assert.ok(effect.group.children.slice(3).some((rock) => rock.position.y > 0.1));
  assert.ok(Math.abs(shake.x) < 0.05 && Math.abs(shake.y) < 0.05);
  effect.update(1);
  assert.equal(effect.group.visible, false);
});

test("Hulk's single mesh still distinguishes face, belly, hands, and legs when clicked", async () => {
  const { animator, model, character } = await hulkFixture({ ground: -1.18 });
  advance(animator);
  const camera = new THREE.PerspectiveCamera(32, 340 / 450, 0.01, 1000);
  camera.position.set(0, 0.05, 8);
  camera.lookAt(0, 0.05, 0);
  camera.updateMatrixWorld();
  const pick = createCharacterPicker(model, character, camera, { wholeBody: true });
  const rect = { left: 0, top: 0, width: 340, height: 450 };
  for (const [x, y, expected] of [[0, 2.35, "face"], [0, 1.45, "belly"], [0.22, 0.6, "leg.L"], [-0.22, 0.6, "leg.R"], [0.8, 1.3, "hand.L"]]) {
    const point = new THREE.Vector3(x, y - 1.18, 0).project(camera);
    assert.equal(pick((point.x + 1) * 170, (1 - point.y) * 225, rect), expected);
  }
});

test("Hulk stays in frame throughout takeoff, high jump, descent, impact, recovery, and wave", async () => {
  const { animator, character, mesh } = await hulkFixture({ ground: -1.18 });
  const camera = new THREE.PerspectiveCamera(32, 340 / 450, 0.01, 1000);
  camera.position.set(0, 0.05, 8);
  camera.lookAt(0, 0.05, 0);
  camera.updateMatrixWorld();
  const flight = Array.from({ length: 41 }, (_, i) => ({ smashProgress: i / 40 }));
  for (const state of [{}, { waving: true }, ...flight, { smashProgress: SMASH_IMPACT }]) {
    advance(animator, state);
    const framing = smashCamera(state.smashProgress);
    camera.position.set(0, framing.y, framing.z);
    camera.updateMatrixWorld();
    character.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += 9) {
      const point = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).project(camera);
      const x = (point.x + 1) * 170;
      const y = (1 - point.y) * 225;
      assert.ok(x > 0 && x < 340 && y > 0 && y < 378, `pose ${state.smashProgress} clips the viewport or controls at ${x}, ${y}`);
    }
  }
});
