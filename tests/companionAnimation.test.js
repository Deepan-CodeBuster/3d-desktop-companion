import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { createCompanionAnimator } from "../src/companionAnimation.js";
import { createCharacterPicker } from "../src/reactions.js";

const file = fs.readFileSync(new URL("../public/models/companion.fbx", import.meta.url));

function fixture() {
  const model = new FBXLoader().parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), ""
  );
  const character = new THREE.Group();
  character.add(model);
  const joints = new Map();
  const meshes = new Map();
  model.traverse((object) => {
    if (object.isBone && !joints.has(object.name)) joints.set(object.name, object);
    if (object.isSkinnedMesh) meshes.set(object.name, object);
  });
  return { model, character, joints, meshes, animator: createCompanionAnimator(model, character) };
}

function advance(animator, frames, state) {
  for (let frame = 0; frame < frames; frame++) animator.update(1 / 60, state);
}

function vertices(model, mesh) {
  model.updateWorldMatrix(true, true);
  mesh.skeleton.update();
  const result = [];
  const count = mesh.geometry.attributes.position.count;
  for (let index = 0; index < count; index += Math.max(1, Math.floor(count / 200))) {
    result.push(mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  }
  return result;
}

function maxDisplacement(before, after) {
  return Math.max(...before.map((point, index) => point.distanceTo(after[index])));
}

test("wave raises the hand and deforms both skin and sleeve across duplicate skeletons", () => {
  const { model, joints, meshes, animator } = fixture();
  advance(animator, 120);
  const handsBefore = vertices(model, meshes.get("Hands"));
  const sleeveBefore = vertices(model, meshes.get("Plush"));
  const handBefore = joints.get("handR").getWorldPosition(new THREE.Vector3());

  advance(animator, 120, { waving: true });
  const handsAfter = vertices(model, meshes.get("Hands"));
  const sleeveAfter = vertices(model, meshes.get("Plush"));
  const handAfter = joints.get("handR").getWorldPosition(new THREE.Vector3());
  const shoulder = joints.get("upper_armR").getWorldPosition(new THREE.Vector3());
  assert.ok(handAfter.y > shoulder.y + 30, "waving hand must be above the shoulder");
  assert.ok(handAfter.y > handBefore.y + 100, "hand must rise from the relaxed pose");
  assert.ok(maxDisplacement(handsBefore, handsAfter) > 50, "hand mesh must follow the gesture");
  assert.ok(maxDisplacement(sleeveBefore, sleeveAfter) > 30, "sleeve must follow the arm");

  for (const mesh of meshes.values()) {
    for (const name of ["handR", "forearmR", "Head"]) {
      const copy = mesh.skeleton.bones.find((bone) => bone.name === name);
      const actual = copy.getWorldPosition(new THREE.Vector3());
      const expected = joints.get(name).getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(expected) < 0.00001, `${mesh.name}: ${name} must stay attached`);
    }
  }
});

test("walking alternates the feet and moves leg and shoe geometry", () => {
  const { model, joints, meshes, animator } = fixture();
  advance(animator, 120);
  const legsBefore = vertices(model, meshes.get("Legs"));
  const shoesBefore = vertices(model, meshes.get("Shoes"));
  advance(animator, 120, { walking: true });
  assert.ok(maxDisplacement(legsBefore, vertices(model, meshes.get("Legs"))) > 5);
  assert.ok(maxDisplacement(shoesBefore, vertices(model, meshes.get("Shoes"))) > 5);

  const footDepth = () => {
    model.updateWorldMatrix(true, true);
    const left = model.worldToLocal(joints.get("footL").getWorldPosition(new THREE.Vector3()));
    const right = model.worldToLocal(joints.get("footR").getWorldPosition(new THREE.Vector3()));
    return left.z - right.z;
  };
  const firstStep = footDepth();
  advance(animator, 25, { walking: true });
  assert.ok(firstStep * footDepth() < 0, "opposite foot must lead half a stride later");
});

test("stopping smoothly returns legs and facing to idle without position drift", () => {
  const { joints, character, animator } = fixture();
  const bind = joints.get("thighL").quaternion.clone();
  advance(animator, 120, { walking: true, direction: -1 });
  assert.ok(character.rotation.y < -1, "character must face the desktop travel direction");
  advance(animator, 180);
  assert.ok(joints.get("thighL").quaternion.angleTo(bind) < 0.00001);
  assert.ok(Math.abs(character.rotation.y) < 0.00001);
  assert.equal(character.position.x, 0);
  assert.ok(Math.abs(character.position.y) < 0.01);
});

test("hop lifts and lands the character while walking and waving remain finite", () => {
  const { character, model, animator } = fixture();
  advance(animator, 120);
  const idleHeight = character.position.y;
  animator.update(0, { jumpProgress: 0.5 });
  assert.ok(Math.abs(character.position.y - idleHeight - 0.38) < 0.00001);
  animator.update(0, { jumpProgress: 1 });
  assert.ok(Math.abs(character.position.y - idleHeight) < 0.00001);

  for (let frame = 0; frame < 180; frame++) {
    animator.update(1 / 60, {
      walking: true, waving: true, roaming: true, jumpProgress: (frame % 54) / 54,
    });
  }
  model.traverse((object) => {
    assert.ok(object.quaternion.toArray().every(Number.isFinite));
    assert.ok(object.position.toArray().every(Number.isFinite));
  });
  assert.ok(Math.abs(character.position.x) <= 0.38);
});

test("3D ray hits on the fitted and animated character identify face, belly, and legs", () => {
  const { model, character } = fixture();
  character.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const factor = 2.9 / Math.max(size.x, size.y, size.z);
  model.position.set(-center.x, -box.min.y, -center.z).multiplyScalar(factor);
  model.scale.multiplyScalar(factor);
  character.position.y = -1.45;
  const animator = createCompanionAnimator(model, character);
  advance(animator, 120);
  const camera = new THREE.PerspectiveCamera(32, 340 / 450, 0.01, 1000);
  camera.position.set(0, 0.05, 8);
  camera.lookAt(0, 0.05, 0);
  camera.updateMatrixWorld();
  const pick = createCharacterPicker(model, character, camera);
  const rect = { left: 0, top: 0, width: 340, height: 450 };
  for (const [x, y, expected] of [[0, 0.95, "face"], [0, -0.05, "belly"],
    [0.2, -0.9, "leg.L"], [-0.2, -0.9, "leg.R"]]) {
    const point = new THREE.Vector3(x, y, 0).project(camera);
    assert.equal(pick((point.x + 1) * 170, (1 - point.y) * 225, rect), expected);
  }
  assert.equal(pick(0, 0, rect), null, "transparent background should not trigger a reaction");
});

test("touching a leg gives a local kick; face touch and speaking animate the head", () => {
  const { joints, animator } = fixture();
  advance(animator, 120);
  const left = joints.get("thighL").quaternion.clone();
  const right = joints.get("thighR").quaternion.clone();
  const head = joints.get("Head").quaternion.clone();
  animator.update(0, { reaction: { region: "leg.L", progress: 0.5 } });
  assert.ok(joints.get("thighL").quaternion.angleTo(left) > 0.5);
  assert.ok(joints.get("thighR").quaternion.angleTo(right) < 0.00001);
  animator.update(0, { reaction: { region: "face", progress: 0.2 } });
  assert.ok(joints.get("Head").quaternion.angleTo(head) > 0.08);
  advance(animator, 90, { speaking: true, listening: true });
  assert.ok(joints.get("Head").quaternion.angleTo(head) > 0.03);
});
