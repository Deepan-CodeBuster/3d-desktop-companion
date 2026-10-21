import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechPlayback } from "../src/speechPlayback.js";

function fixture() {
  const audios = [];
  const finished = [];
  const revoked = [];
  const playback = createSpeechPlayback({
    finish: (...args) => finished.push(args), makeUrl: () => `blob:${audios.length}`,
    revokeUrl: (url) => revoked.push(url),
    makeAudio: () => {
      const audio = { play: async () => {}, pause() { this.paused = true; }, removeAttribute() {} };
      audios.push(audio);
      return audio;
    },
  });
  return { playback, audios, finished, revoked };
}

test("playback acknowledges only after actual audio ends and releases its URL", () => {
  const { playback, audios, finished, revoked } = fixture();
  playback.play({ id: "a", wav: new ArrayBuffer(44) });
  assert.equal(finished.length, 0);
  audios[0].onended();
  assert.deepEqual(finished, [["a", ""]]);
  assert.equal(revoked.length, 1);
});

test("cancellation stops audio and suppresses late playback completion", () => {
  const { playback, audios, finished } = fixture();
  playback.play({ id: "a", wav: new ArrayBuffer(44) });
  const lateEnd = audios[0].onended;
  playback.cancel();
  lateEnd();
  assert.equal(audios[0].paused, true);
  assert.equal(finished.length, 0);
});

test("playback errors are reported and component cleanup settles pending speech", () => {
  const { playback, audios, finished } = fixture();
  playback.play({ id: "a", wav: new ArrayBuffer(44) });
  audios[0].onerror();
  assert.match(finished[0][1], /Unable to play/);
  playback.play({ id: "b", wav: new ArrayBuffer(44) });
  playback.dispose();
  assert.deepEqual(finished[1], ["b", "Speech playback closed."]);
});

test("ElevenLabs MP3 packets preserve their audio MIME type", () => {
  let received;
  const playback = createSpeechPlayback({
    finish: () => {}, revokeUrl: () => {},
    makeUrl: (audio, type) => { received = { audio, type }; return "blob:test"; },
    makeAudio: () => ({ play: async () => {}, pause() {}, removeAttribute() {} }),
  });
  const bytes = new ArrayBuffer(128);
  playback.play({ id: "voice", audio: bytes, mimeType: "audio/mpeg" });
  assert.equal(received.audio, bytes);
  assert.equal(received.type, "audio/mpeg");
  playback.cancel();
});
