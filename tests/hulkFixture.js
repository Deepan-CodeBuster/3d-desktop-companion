import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCompanionAnimator } from "../src/companionAnimation.js";

export async function hulkFixture({ ground = 0 } = {}) {
  const file = fs.readFileSync(new URL("../public/models/hulk.glb", import.meta.url));
  // Joint/geometry tests do not need a browser image decoder. The production
  // GLTFLoader still loads the original embedded PNG normally.
  const loader = new GLTFLoader().register(() => ({
    name: "geometry_test_texture", loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  const gltf = await loader.parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
  const model = gltf.scene;
  const character = new THREE.Group();
  character.add(model);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const factor = 2.9 / Math.max(size.x, size.y, size.z);
  model.position.set(-center.x, -bounds.min.y, -center.z).multiplyScalar(factor);
  model.scale.multiplyScalar(factor);
  character.position.y = ground;
  const animator = createCompanionAnimator(model, character, { profile: "hulk" });
  const bones = {};
  let mesh;
  model.traverse((object) => {
    if (object.isBone) bones[object.name.replace(/^mixamorig:?/, "").replace(/_\d+$/, "")] = object;
    if (object.isSkinnedMesh) mesh = object;
  });
  return { model, character, animator, bones, mesh, gltf };
}
