import { SMASH_DURATION } from "./hulkSmash.js";

export const CHARACTERS = [
  { id: "deep", name: "Deep", path: "./models/companion.fbx", format: "fbx", special: "hop", duration: 900 },
  { id: "hulk", name: "Hulk", path: "./models/hulk.glb", format: "gltf", special: "smash", duration: SMASH_DURATION },
];

export function getCharacter(id) {
  return CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
}

export function savedCharacter(storage) {
  try { return getCharacter(storage.getItem("deep.character")).id; }
  catch { return "deep"; }
}
