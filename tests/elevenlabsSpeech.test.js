import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { ElevenLabsSpeech, synthesizeSpeech } = require("../electron/elevenlabs-speech.cjs");
const { loadVoiceConfig, DEFAULT_VOICE_ID } = require("../electron/voice-config.cjs");

const testKey = "sk_unit-test-only";
const mp3 = () => new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });

function fixture(fetchImpl = async () => mp3()) {
  const packets = [];
  const calls = [];
  const recognizer = new EventEmitter();
  recognizer.start = async () => ({ recognitionAvailable: true, speechAvailable: false });
  recognizer.setMode = () => {};
  recognizer.dispose = () => {};
  const speech = new ElevenLabsSpeech({
    apiKey: testKey, onAudio: (packet) => packets.push(packet), onCancel: () => {}, recognizer,
    fetchImpl: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
  });
  return { speech, packets, calls, recognizer };
}

test("ElevenLabs requests the selected voice in the main process and waits for playback", async () => {
  const { speech, packets, calls } = fixture();
  assert.equal((await speech.start()).tts, "ElevenLabs");
  let done = false;
  const pending = speech.speak("Hello Deep").then(() => { done = true; });
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["xi-api-key"], testKey);
  assert.equal(new URL(calls[0].url).hostname, "api.elevenlabs.io");
  assert.ok(calls[0].url.includes(DEFAULT_VOICE_ID));
  assert.equal(JSON.parse(calls[0].init.body).model_id, "eleven_flash_v2_5");
  assert.equal(packets[0].mimeType, "audio/mpeg");
  assert.equal(Buffer.from(packets[0].audio).toString("ascii", 0, 3), "ID3");
  assert.equal(JSON.stringify(packets[0]).includes(testKey), false);
  assert.equal(done, false);
  speech.finishPlayback(packets[0].id);
  await pending;
  assert.equal(done, true);
  speech.dispose();
});

test("cancelling an in-flight request aborts it and suppresses late audio", async () => {
  let complete;
  const { speech, calls, packets } = fixture(() => new Promise((resolve) => { complete = resolve; }));
  const pending = speech.speak("Old reply");
  speech.cancelSpeech();
  await pending;
  assert.equal(calls[0].init.signal.aborted, true);
  complete(mp3());
  await new Promise(setImmediate);
  assert.equal(packets.length, 0);
  speech.dispose();
});

test("voice access failures are actionable and never expose the API key", async () => {
  const { speech, packets } = fixture(async () => new Response(JSON.stringify({
    detail: { message: `Free users cannot use library voices via the API. ${testKey}` },
  }), { status: 402, headers: { "content-type": "application/json" } }));
  await assert.rejects(speech.speak("Hello"), (error) => {
    assert.match(error.message, /Free users cannot use library voices/);
    assert.equal(error.message.includes(testKey), false);
    return true;
  });
  assert.equal(packets.length, 0);
  assert.equal(speech.pending.size, 0);
  speech.dispose();
});

test("network failures can be retried without restarting speech recognition", async () => {
  let attempt = 0;
  const { speech, packets } = fixture(async () => { if (++attempt === 1) throw new Error("fetch failed"); return mp3(); });
  await assert.rejects(speech.speak("Hello"), /Check your internet connection/);
  const pending = speech.speak("Try again");
  await new Promise(setImmediate);
  speech.finishPlayback(packets[0].id);
  await pending;
  speech.dispose();
});

test("missing keys, empty audio, and non-audio API responses fail cleanly", async () => {
  await assert.rejects(synthesizeSpeech({ text: "Hi" }), /ELEVENLABS_API_KEY/);
  await assert.rejects(synthesizeSpeech({ apiKey: testKey, text: "Hi", fetchImpl: async () =>
    new Response("", { headers: { "content-type": "audio/mpeg" } }) }), /empty audio/);
  await assert.rejects(synthesizeSpeech({ apiKey: testKey, text: "Hi", fetchImpl: async () =>
    new Response("{}", { headers: { "content-type": "application/json" } }) }), /does not contain audio/);
});

test("private env files support Windows BOM and environment overrides", () => {
  const readFile = () => "\uFEFFELEVENLABS_API_KEY=local-test-key\nELEVENLABS_VOICE_ID=localvoice\n";
  assert.equal(loadVoiceConfig({ env: {}, readFile }).apiKey, "local-test-key");
  const configured = loadVoiceConfig({ env: { ELEVENLABS_API_KEY: "environment-test-key" }, readFile });
  assert.equal(configured.apiKey, "environment-test-key");
  assert.equal(configured.voiceId, "localvoice");
  const missing = loadVoiceConfig({ env: {}, readFile: () => { const error = new Error(); error.code = "ENOENT"; throw error; } });
  assert.equal(missing.apiKey, "");
  assert.equal(missing.voiceId, "JBFqnCBsd6RMkjVDRZzb");
});
