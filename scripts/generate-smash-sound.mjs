import { mkdir, writeFile } from "node:fs/promises";

// Original, deterministic impact sound: sub-bass hit, concrete crack and debris.
const sampleRate = 44100;
const duration = 1.65;
const samples = new Float64Array(Math.floor(sampleRate * duration));
let seed = 78329, phase = 0, rumble = 0, previous = 0;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
for (let i = 0; i < samples.length; i++) {
  const t = i / sampleRate;
  const noise = random();
  rumble += (noise - rumble) * 0.025;
  const crack = noise - previous;
  previous = noise;
  phase += 2 * Math.PI * (36 + 105 * Math.exp(-t * 24)) / sampleRate;
  const attack = Math.min(1, t / 0.004);
  let value = Math.sin(phase) * Math.exp(-t * 6) * 0.9
    + Math.sin(phase * 2) * Math.exp(-t * 8) * 0.22
    + Math.sin(phase * 3) * Math.exp(-t * 12) * 0.1
    + Math.sin(2 * Math.PI * 29 * t) * Math.exp(-t * 3.6) * 0.25
    + rumble * Math.exp(-t * 2.4) * 3
    + crack * Math.exp(-t * 29) * 0.24;
  for (let hit = 0; hit < 12; hit++) {
    const age = t - (0.09 + hit * 0.07);
    if (age >= 0) value += noise * Math.exp(-age * (40 + hit * 2)) * 0.075 * (1 - hit / 15);
  }
  const tail = Math.min(1, (duration - t) / 0.04);
  samples[i] = Math.tanh(value * 1.6) * attack * tail;
}
const peak = samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] / peak * 0.82 * 32767), 44 + i * 2);
const directory = new URL("../public/sounds/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("hulk-smash.wav", directory), wav);
console.log(`Saved public/sounds/hulk-smash.wav (${duration}s, peak 0.82).`);
