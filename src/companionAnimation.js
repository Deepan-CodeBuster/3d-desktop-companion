import * as THREE from "three";
import { smashMotion } from "./hulkSmash.js";

const normalize = (name) => name.replace(/^mixamorig:?/i, "").replace(/_\d+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BONE_NAMES = {
  hips: ["hips", "spine"],
  spine: ["spine001", "spine01", "spine"],
  chest: ["spine003", "chest", "spine002", "spine2"],
  neck: ["neck"],
  head: ["head"],
  "shoulder.L": ["shoulderL", "leftShoulder"],
  "shoulder.R": ["shoulderR", "rightShoulder"],
  "upper_arm.L": ["upper_armL", "leftArm"],
  "upper_arm.R": ["upper_armR", "rightArm"],
  "forearm.L": ["forearmL", "leftForeArm"],
  "forearm.R": ["forearmR", "rightForeArm"],
  "hand.L": ["handL", "leftHand"],
  "hand.R": ["handR", "rightHand"],
  "thigh.L": ["thighL", "leftUpLeg"],
  "thigh.R": ["thighR", "rightUpLeg"],
  "shin.L": ["shinL", "leftLeg"],
  "shin.R": ["shinR", "rightLeg"],
  "foot.L": ["footL", "leftFoot"],
  "foot.R": ["footR", "rightFoot"],
};

export function createCompanionAnimator(model, character, { profile = "deep" } = {}) {
  model.updateWorldMatrix(true, true);
  const namedBones = new Map();
  model.traverse((object) => {
    if (!object.isBone) return;
    const name = normalize(object.name);
    // FBXLoader nests copies for each skinned mesh. Animate the outer bone:
    // its transform reaches every mesh and the actual child joints together.
    if (object.parent?.isBone && normalize(object.parent.name) === name) return;
    if (!namedBones.has(name)) namedBones.set(name, object);
  });

  const bones = {};
  const modelInverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const [key, aliases] of Object.entries(BONE_NAMES)) {
    const bone = aliases.map((name) => namedBones.get(normalize(name))).find(Boolean);
    if (!bone) continue;
    const frame = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(modelInverse);
    bones[key] = {
      bone,
      bind: bone.quaternion.clone(),
      frame,
      inverseFrame: frame.clone().invert(),
    };
  }

  const offset = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const fingers = profile === "hulk" ? [...namedBones.entries()]
    .filter(([name]) => /^(?:left|right)hand(?:index|middle|ring|pinky|thumb)[123]$/.test(name))
    .map(([name, bone]) => ({ name, bone, bind: bone.quaternion.clone() })) : [];
  const basePosition = character.position.clone();
  const jointPosition = new THREE.Vector3();
  const handPosition = new THREE.Vector3();
  const target = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const worldRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  let time = 0;
  let phase = 0;
  let walkBlend = 0;
  let waveBlend = 0;
  let talkBlend = 0;
  let listenBlend = 0;

  const pose = (key, x = 0, y = 0, z = 0) => {
    const entry = bones[key];
    if (!entry) return;
    // Express offsets in character axes, regardless of the FBX bone roll.
    offset.setFromEuler(euler.set(x, y, z, "XYZ"));
    offset.premultiply(entry.inverseFrame).multiply(entry.frame);
    entry.bone.quaternion.copy(entry.bind).multiply(offset);
  };

  const aimFist = (side, goal) => {
    const hand = bones[`hand.${side}`]?.bone;
    if (!hand) return;
    // Solve on the real rig so the knuckles meet the floor despite Hulk's
    // different proportions, clavicle lengths, and exported bone axes.
    for (let iteration = 0; iteration < 8; iteration++) {
      for (const key of ["forearm", "upper_arm", "shoulder"]) {
        const joint = bones[`${key}.${side}`]?.bone;
        if (!joint) continue;
        joint.getWorldPosition(jointPosition);
        hand.getWorldPosition(handPosition);
        from.copy(handPosition).sub(jointPosition).normalize();
        to.copy(goal).sub(jointPosition).normalize();
        delta.setFromUnitVectors(from, to);
        joint.getWorldQuaternion(worldRotation);
        joint.parent.getWorldQuaternion(parentRotation).invert();
        joint.quaternion.copy(parentRotation).multiply(delta).multiply(worldRotation).normalize();
        joint.updateWorldMatrix(false, true);
      }
    }
  };

  return {
    update(dt, {
      walking = false,
      waving = false,
      jumpProgress = 1,
      smashProgress = 1,
      direction = 1,
      heading = null,
      roaming = false,
      speaking = false,
      listening = false,
      reaction = null,
    } = {}) {
      time += dt;
      walkBlend = THREE.MathUtils.damp(walkBlend, walking ? 1 : 0, 7, dt);
      waveBlend = THREE.MathUtils.damp(waveBlend, waving ? 1 : 0, 9, dt);
      talkBlend = THREE.MathUtils.damp(talkBlend, speaking ? 1 : 0, 9, dt);
      listenBlend = THREE.MathUtils.damp(listenBlend, listening ? 1 : 0, 7, dt);
      phase += dt * 7.5 * walkBlend;
      const stride = Math.sin(phase);
      const breath = Math.sin(time * 2.3);
      const wave = Math.sin(time * 12);
      const jump = Math.sin(THREE.MathUtils.clamp(jumpProgress, 0, 1) * Math.PI);
      const touchProgress = THREE.MathUtils.clamp(reaction?.progress ?? 1, 0, 1);
      const touch = Math.sin(touchProgress * Math.PI);
      const wiggle = Math.sin(touchProgress * Math.PI * 8) * touch;
      const faceTouch = reaction?.region === "face" ? wiggle : 0;
      const bellyTouch = reaction?.region === "belly" ? wiggle : 0;
      const leftKick = reaction?.region === "leg.L" ? touch : 0;
      const rightKick = reaction?.region === "leg.R" ? touch : 0;
      const talkingNod = Math.sin(time * 8) * 0.025 * talkBlend;
      const talkGesture = Math.sin(time * 3.8) * 0.08 * talkBlend;
      const smash = profile === "hulk" ? smashMotion(smashProgress) : smashMotion();

      pose("thigh.L", -stride * 0.45 * walkBlend - jump * 0.12 - leftKick * 0.6);
      pose("thigh.R", stride * 0.45 * walkBlend - jump * 0.12 - rightKick * 0.6);
      pose("shin.L", Math.max(0, stride) * 0.7 * walkBlend + jump * 0.24 + leftKick * 0.85);
      pose("shin.R", Math.max(0, -stride) * 0.7 * walkBlend + jump * 0.24 + rightKick * 0.85);
      pose("foot.L", stride * 0.16 * walkBlend - jump * 0.12);
      pose("foot.R", -stride * 0.16 * walkBlend - jump * 0.12);

      // Lower the exported A-pose into a relaxed stance before adding gestures.
      pose("upper_arm.L", stride * 0.36 * walkBlend, 0,
        -0.62 + breath * 0.012 + jump * 0.3 + talkGesture + bellyTouch * 0.12);
      pose("upper_arm.R", -stride * 0.36 * walkBlend * (1 - waveBlend),
        -0.12 * waveBlend,
        (0.62 - talkGesture - bellyTouch * 0.12) * (1 - waveBlend)
          - 0.95 * waveBlend - jump * 0.3 * (1 - waveBlend));
      pose("forearm.L", -0.1 - Math.max(0, stride) * 0.15 * walkBlend - talkBlend * 0.18,
        0, reaction?.region === "hand.L" ? -wiggle * 0.25 : 0);
      pose("forearm.R", -0.1 * (1 - waveBlend), 0,
        (-1.05 + wave * 0.22) * waveBlend);
      pose("hand.L", 0, 0, -0.04 + (reaction?.region === "hand.L" ? wiggle * 0.35 : 0));
      pose("hand.R", Math.sin(time * 12 + 0.4) * 0.14 * waveBlend,
        0.18 * waveBlend, wave * 0.24 * waveBlend + (reaction?.region === "hand.R" ? wiggle * 0.35 : 0));
      pose("shoulder.L", 0, 0, -jump * 0.04);
      pose("shoulder.R", 0, 0, -0.08 * waveBlend + jump * 0.04);

      pose("hips", 0, stride * 0.035 * walkBlend, stride * 0.025 * walkBlend);
      pose("spine", breath * 0.009, 0, -stride * 0.018 * walkBlend);
      pose("chest", breath * 0.012 + talkingNod * 0.4,
        -stride * 0.035 * walkBlend + bellyTouch * 0.15, 0.025 * waveBlend);
      pose("neck", 0, Math.sin(time * 0.7) * 0.018 * (1 - walkBlend));
      pose("head", Math.sin(time * 1.3) * 0.025 + talkingNod - listenBlend * 0.035,
        Math.sin(time * 0.6) * 0.04 * (1 - walkBlend) + faceTouch * 0.18,
        -0.045 * waveBlend - listenBlend * 0.09 + faceTouch * 0.07);

      if (smash.active) {
        const { raise, slam, tuck } = smash;
        pose("hips", -0.25 * slam);
        pose("spine", -0.1 * raise + 0.65 * slam);
        pose("chest", -0.18 * raise + 0.95 * slam);
        pose("neck", -0.1 * slam);
        pose("head", -0.15 * slam);
        for (const [side, sign] of [["L", 1], ["R", -1]]) {
          pose(`thigh.${side}`, -0.15 * raise - 0.65 * tuck - 1.4 * slam);
          pose(`shin.${side}`, 0.25 * raise + 1.1 * tuck + 2.2 * slam);
          pose(`foot.${side}`, -0.1 * raise - 0.35 * tuck - 0.55 * slam);
          pose(`shoulder.${side}`, 0, 0, sign * 0.05 * raise);
          pose(`upper_arm.${side}`, -0.15 * raise - 0.55 * slam, 0, sign * (-0.62 + 2.9 * raise + 0.4 * slam));
          pose(`forearm.${side}`, -0.1 - 0.2 * slam, 0, sign * 0.8 * raise);
          pose(`hand.${side}`, 0.35 * slam);
        }
      }
      for (const finger of fingers) {
        const curl = (0.35 + 0.7 * Math.min(1, (smash.raise + smash.slam) * 2))
          * (smash.active ? 1 : 1 - waveBlend);
        offset.setFromEuler(euler.set(finger.name.includes("thumb") ? 0.2 * curl : curl, 0, 0));
        finger.bone.quaternion.copy(finger.bind).multiply(offset);
      }

      const previewTravel = Math.sin(time * 0.8);
      const facing = roaming ? (Math.cos(time * 0.8) >= 0 ? 1 : -1) : direction;
      const attention = Math.max(waveBlend * 0.85, talkBlend * 0.8, listenBlend * 0.85, smash.active ? 1 : 0);
      const targetTurn = (heading ?? facing * 1.05) * walkBlend * (1 - attention);
      const turn = THREE.MathUtils.euclideanModulo(targetTurn - character.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
      character.rotation.y += turn * (1 - Math.exp(-6 * dt));
      character.rotation.y = Math.atan2(Math.sin(character.rotation.y), Math.cos(character.rotation.y));
      character.rotation.z = smash.active ? 0 : stride * 0.012 * walkBlend + bellyTouch * 0.025;
      character.position.x = basePosition.x + (roaming ? previewTravel * 0.38 * walkBlend : 0);
      character.position.y = basePosition.y
        + (1 - Math.cos(phase * 2)) * 0.025 * walkBlend
        + breath * 0.008 * (1 - walkBlend)
        + jump * 0.38;
      if (smash.active) {
        character.position.y = basePosition.y + smash.lift - 0.13 * smash.raise - 0.62 * smash.slam;
        character.updateWorldMatrix(true, true);
        const strength = smash.raise + smash.slam;
        if (strength > 0.0001) {
          for (const [side, sign] of [["L", 1], ["R", -1]]) {
            const hand = bones[`hand.${side}`]?.bone;
            if (!hand) continue;
            target.set(sign * (0.2 * smash.raise + 0.32 * smash.slam) / strength,
              basePosition.y + smash.lift - character.position.y + (2.4 * smash.raise + 0.17 * smash.slam) / strength,
              0.85 * smash.slam / strength);
            character.localToWorld(target);
            hand.getWorldPosition(handPosition);
            target.lerpVectors(handPosition, target, strength);
            aimFist(side, target);
          }
        }
      }
    },
  };
}
