import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as THREE from "three";
import { hulkFixture } from "../tests/hulkFixture.js";
import { createSmashEffect, smashCamera, SMASH_IMPACT } from "../src/hulkSmash.js";

// Offline geometry preview, not a screenshot of the running desktop app.
const source = await fs.readFile(new URL("../public/models/hulk.glb", import.meta.url));
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const view = json.bufferViews[json.images[0].bufferView];
const binary = 20 + jsonLength + 8;
const { data: pixels, info } = await sharp(source.subarray(binary + view.byteOffset, binary + view.byteOffset + view.byteLength))
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const light = new THREE.Vector3(3, 5, 6).normalize();
const poses = [
  ["Takeoff", { smashProgress: 0.12 }], ["High jump", { smashProgress: 0.38 }],
  ["Descent", { smashProgress: 0.55 }], ["SMASH", { smashProgress: SMASH_IMPACT }],
  ["Recover", { smashProgress: 0.9 }],
];
const panels = [];
for (const [index, [name, pose]] of poses.entries()) {
  const { model, character, animator } = await hulkFixture({ ground: -1.18 });
  const scene = new THREE.Scene();
  scene.add(character);
  const effect = createSmashEffect(scene, -1.18);
  for (let i = 0; i < 90; i++) animator.update(1 / 60, pose);
  effect.update(pose.smashProgress ?? 1);
  const camera = new THREE.PerspectiveCamera(32, 340 / 450, 0.01, 1000);
  camera.position.set(0, 0.05, 8);
  camera.lookAt(0, 0.05, 0);
  const framing = smashCamera(pose.smashProgress);
  camera.position.set(0, framing.y, framing.z);
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const faces = [];
  scene.traverseVisible((mesh) => {
    if (!mesh.isMesh) return;
    if (mesh.skeleton) mesh.skeleton.update();
    const positions = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    const points = Array.from({ length: positions.count }, (_, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    const projected = points.map((point) => point.clone().project(camera));
    const indices = mesh.geometry.index?.array || Array.from({ length: positions.count }, (_, i) => i);
    for (let i = 0; i < indices.length; i += 3) {
      const ids = [indices[i], indices[i + 1], indices[i + 2]];
      const screen = ids.map((id) => projected[id]);
      let color = mesh.material.color?.clone() || new THREE.Color(0x909090);
      if (mesh.isSkinnedMesh && uv) {
        const u = ids.reduce((sum, id) => sum + uv.getX(id), 0) / 3;
        const v = ids.reduce((sum, id) => sum + uv.getY(id), 0) / 3;
        const x = Math.max(0, Math.min(info.width - 1, Math.floor(u * info.width)));
        const y = Math.max(0, Math.min(info.height - 1, Math.floor(v * info.height)));
        const pixel = (y * info.width + x) * info.channels;
        color.setRGB(pixels[pixel] / 255, pixels[pixel + 1] / 255, pixels[pixel + 2] / 255, THREE.SRGBColorSpace);
      }
      const normal = points[ids[1]].clone().sub(points[ids[0]]).cross(points[ids[2]].clone().sub(points[ids[0]])).normalize();
      const shade = mesh.material.isMeshBasicMaterial ? 1 : 0.55 + Math.max(0, normal.dot(light)) * 0.65;
      color.multiplyScalar(shade);
      const polygon = screen.map((point) => `${((point.x + 1) * 170).toFixed(2)},${((1 - point.y) * 225).toFixed(2)}`).join(" ");
      faces.push({ depth: screen.reduce((sum, point) => sum + point.z, 0) / 3,
        svg: `<polygon points="${polygon}" fill="#${color.getHexString()}" opacity="${mesh.material.opacity}"/>` });
    }
  });
  faces.sort((a, b) => b.depth - a.depth);
  panels.push(`<g transform="translate(${index * 340},0)"><rect width="340" height="450" fill="#202630"/>`
    + `<text x="170" y="34" fill="white" text-anchor="middle" font-family="Arial" font-size="18">${name}</text>`
    + faces.map((face) => face.svg).join("") + "</g>");
  model.clear();
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="450">${panels.join("")}</svg>`;
await fs.mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL("../artifacts/hulk-actions.png", import.meta.url)));
console.log("Saved artifacts/hulk-actions.png");
