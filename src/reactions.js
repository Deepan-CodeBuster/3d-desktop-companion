import * as THREE from "three";

export const REACTIONS = {
  face: ["Hey, that tickles!", "Boop! Hello to you too!", "You found my nose!"],
  belly: ["Ha ha! I'm ticklish!", "That tickles my tummy!"],
  "hand.L": ["High five!", "Let's shake on it!"],
  "hand.R": ["High five!", "A little wave for you!"],
  "leg.L": ["Whoa, watch my toes!", "You found my dancing feet!"],
  "leg.R": ["Oops! That's my foot!", "Time for a little kick!"],
};

export function touchRegion(meshName, point) {
  if (/head|hair|eyes|eyebrow|eyelash/i.test(meshName)) return "face";
  if (/hands/i.test(meshName)) return point.x > 0 ? "hand.L" : "hand.R";
  if (/legs|shoes|shorts/i.test(meshName) || point.y < 0.95) {
    return point.x > 0 ? "leg.L" : "leg.R";
  }
  return "belly";
}

export function createCharacterPicker(model, character, camera, { wholeBody = false } = {}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  return (clientX, clientY, rect) => {
    if (!rect.width || !rect.height) return null;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1);
    // SkinnedMesh refreshes its inverse bind matrix in updateMatrixWorld.
    // Refresh animated bounds too, so raised hands remain clickable.
    character.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    model.traverse((object) => {
      if (!object.isSkinnedMesh) return;
      object.computeBoundingBox();
      if (!object.boundingSphere) object.boundingSphere = new THREE.Sphere();
      object.boundingBox.getBoundingSphere(object.boundingSphere);
    });
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit) return null;
    const point = character.worldToLocal(hit.point.clone());
    if (wholeBody) {
      if (point.y > 2.1) return "face";
      if (point.y < 0.95) return point.x > 0 ? "leg.L" : "leg.R";
      if (Math.abs(point.x) > 0.55) return point.x > 0 ? "hand.L" : "hand.R";
      return "belly";
    }
    return touchRegion(hit.object.name, point);
  };
}
