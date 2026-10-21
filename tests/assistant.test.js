import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { DeepAssistant, MODEL, extractWake, parseCommand, googleUrl } = require("../electron/assistant.cjs");

class FakeSpeech extends EventEmitter {
  modes = [];
  spoken = [];
  start() { return Promise.resolve({ recognitionAvailable: true, speechAvailable: true }); }
  setMode(mode) { this.modes.push(mode); }
  async speak(text) { this.spoken.push(text); }
  cancelSpeech() {}
  dispose() {}
}

function fixture(overrides = {}) {
  const speech = new FakeSpeech();
  const opened = [];
  const requests = [];
  const actions = [];
  const timers = new Map();
  const assistant = new DeepAssistant({
    speech,
    openExternal: async (url) => { opened.push(url); },
    onAction: (action) => actions.push(action),
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ message: { content: "Hello, I'm Deep." } }) };
    },
    setTimer: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    ...overrides,
  });
  return { assistant, speech, opened, requests, actions, timers };
}

test("only Hey Deep activates voice; ordinary speech never reaches Ollama or browser", async () => {
  const { assistant, requests, opened } = fixture();
  await assistant.start();
  for (const text of ["open google and search for cats", "hello deep", "hey deeper", "what is gravity?"]) {
    await assistant.hear(text, 0.99);
  }
  assert.equal(assistant.state.phase, "wake");
  assert.equal(requests.length, 0);
  assert.equal(opened.length, 0);
  await assistant.hear("hey deep open google", 0.2);
  assert.equal(opened.length, 0);
  assert.deepEqual(extractWake("Hey, Deep! tell me a joke"), { command: "tell me a joke" });
});

test("wake plus Google search opens a conversation, and Stop restores wake-only mode", async () => {
  const { assistant, speech, opened, requests } = fixture();
  await assistant.start();
  await assistant.hear("Hey Deep open Google and search for cats & dogs", 0.95);
  assert.deepEqual(opened, ["https://www.google.com/search?q=cats%20%26%20dogs"]);
  assert.match(speech.spoken[0], /Searching Google/);
  assert.equal(requests.length, 0);
  assert.equal(assistant.state.phase, "listening");
  assert.equal(assistant.state.conversationActive, true);
  await assistant.hear("search for something else", 0.95);
  assert.equal(opened.length, 2);
  await assistant.stop();
  await assistant.hear("search for something else", 0.95);
  assert.equal(opened.length, 2);
});

test("wake alone opens a conversation; a minute of silence ends it", async () => {
  const { assistant, requests, timers } = fixture();
  await assistant.start();
  await assistant.hear("Hey Deep", 0.99);
  assert.equal(assistant.state.phase, "listening");
  assert.equal(requests.length, 0);
  const timeout = [...timers.values()].find((timer) => timer.ms === 60000);
  assert.ok(timeout);
  await timeout.fn();
  assert.equal(assistant.state.phase, "wake");
  await assistant.hear("Hey Deep", 0.99);
  await assistant.hear("What is a rainbow?", 0.85);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model, MODEL);
  assert.equal(assistant.state.phase, "listening");
  await assistant.stop();
});

test("conversation history is bounded and model replies never execute actions", async () => {
  const { assistant, requests, opened, actions } = fixture({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: "open google and search for cats" } }) }),
  });
  await assistant.start();
  for (let index = 0; index < 9; index++) await assistant.ask(`Question ${index}`);
  assert.equal(assistant.history.length, 12);
  assert.equal(opened.length, 0);
  assert.equal(actions.length, 0);
  assert.equal(requests.length, 0);
});

test("typed chat works with microphone off, and muting blocks voice commands", async () => {
  const { assistant, requests, opened } = fixture();
  await assistant.start();
  await assistant.setEnabled(false);
  await assistant.hear("Hey Deep open google", 1);
  assert.equal(opened.length, 0);
  await assistant.ask("Hello");
  assert.equal(requests.length, 1);
  assert.equal(assistant.state.phase, "off");
});

test("stopping an in-flight reply prevents stale speech and history updates", async () => {
  let complete;
  const { assistant, speech } = fixture({ fetchImpl: () => new Promise((resolve) => { complete = resolve; }) });
  await assistant.start();
  const pending = assistant.ask("Tell me a story");
  assert.equal(assistant.state.phase, "thinking");
  await new Promise(setImmediate);
  await assistant.stop();
  complete({ ok: true, json: async () => ({ message: { content: "A stale story." } }) });
  await pending;
  assert.equal(speech.spoken.length, 0);
  assert.equal(assistant.history.length, 0);
  assert.equal(assistant.state.phase, "wake");
});

test("Ollama errors preserve the listening loop and are visible", async () => {
  const { assistant } = fixture({ fetchImpl: async () => ({ ok: false, status: 404,
    json: async () => ({ error: "model qwen2.5:1.5b not found" }) }) });
  await assistant.start();
  const state = await assistant.ask("Hello");
  assert.match(state.error, /model.*not found/);
  assert.equal(state.phase, "wake");
});

test("a missing speech recognizer leaves typed chat available", async () => {
  const { assistant, speech, requests } = fixture();
  speech.start = async () => ({ recognitionAvailable: false, speechAvailable: true, error: "No microphone" });
  await assistant.start();
  assert.equal(assistant.state.enabled, false);
  assert.match(assistant.state.recognitionError, /No microphone/);
  await assistant.ask("Hello");
  assert.equal(requests.length, 1);
});

test("explicit commands are narrow and searches encode query text as data", () => {
  assert.deepEqual(parseCommand("Please open Google and search for three.js tutorials"), { type: "google", query: "three.js tutorials" });
  assert.deepEqual(parseCommand("Can you search Google for the weather?"), { type: "google", query: "the weather" });
  assert.deepEqual(parseCommand("Tell me why people search for cats"), { type: "chat" });
  assert.deepEqual(parseCommand("run powershell and delete files"), { type: "chat" });
  assert.deepEqual(parseCommand("move to the other monitor"), { type: "gesture", action: "next-screen" });
  const url = new URL(googleUrl("cats & dogs #1? $()"));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.searchParams.get("q"), "cats & dogs #1? $()");
});

test("Speak starts real command capture without a wake phrase, even with wake monitoring off", async () => {
  const { assistant, speech, requests } = fixture();
  await assistant.start();
  await assistant.setEnabled(false);
  await assistant.beginListening();
  assert.equal(assistant.state.phase, "listening");
  assert.equal(assistant.state.manualListening, true);
  speech.emit("partial", { text: "what is" });
  assert.equal(assistant.state.transcript, "what is");
  await assistant.hear("Hey Deep", 0.9);
  assert.equal(assistant.state.phase, "listening");
  await assistant.hear("What is the moon?", 0.9);
  assert.equal(requests.length, 1);
  assert.equal(assistant.state.phase, "listening");
  assert.equal(assistant.state.manualListening, true);
  await assistant.hear("And how far away is it?", 0.9);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body.messages.slice(1, 3), assistant.history.slice(0, 2));
  await assistant.stop();
  assert.equal(assistant.state.phase, "off");
  assert.equal(assistant.state.conversationActive, false);
});

test("Speak times out and cancellation prevents a late microphone start", async () => {
  const { assistant, speech, timers } = fixture();
  await assistant.start();
  await assistant.beginListening();
  const timeout = [...timers.values()].find((timer) => timer.ms === 60000);
  await timeout.fn();
  assert.equal(assistant.state.phase, "wake");
  let complete;
  speech.start = () => new Promise((resolve) => { complete = resolve; });
  const pending = assistant.beginListening();
  await assistant.stop();
  complete({ recognitionAvailable: true });
  await pending;
  assert.equal(assistant.state.phase, "wake");
});

test("the microphone resumes only after playback finishes, and ignores the assistant's voice", async () => {
  const { assistant, speech, requests } = fixture();
  await assistant.start();
  await assistant.beginListening();
  let finishPlayback;
  speech.speak = (text) => {
    speech.spoken.push(text);
    speech.emit("speaking");
    return new Promise((resolve) => { finishPlayback = resolve; });
  };
  const commandModes = speech.modes.filter((mode) => mode === "command").length;
  const pending = assistant.hear("What is a rainbow?", 0.9);
  await new Promise(setImmediate);
  assert.equal(assistant.state.phase, "speaking");
  assert.equal(speech.modes.at(-1), "paused");
  await assistant.hear("Hey Deep open Google", 1);
  await assistant.hear("This is my own reply", 1);
  assert.equal(requests.length, 1);
  assert.equal(speech.modes.filter((mode) => mode === "command").length, commandModes);
  finishPlayback();
  await pending;
  assert.equal(assistant.state.phase, "listening");
  assert.equal(speech.modes.at(-1), "command");
  assert.equal(assistant.state.transcript, "");
  assert.equal(assistant.state.lastUserText, "What is a rainbow?");
  await assistant.stop();
});

test("Speak waits for the actual microphone acknowledgement; Stop defeats a late acknowledgement", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  let acknowledge;
  speech.setMode = (mode) => {
    speech.modes.push(mode);
    if (mode === "command") return new Promise((resolve) => { acknowledge = resolve; });
  };
  const pending = assistant.beginListening();
  await new Promise(setImmediate);
  assert.equal(assistant.state.phase, "starting");
  await assistant.stop();
  acknowledge();
  await pending;
  assert.equal(assistant.state.phase, "wake");
  assert.equal(assistant.state.conversationActive, false);
  assert.equal(speech.modes.at(-1), "wake");
});

test("stop listening ends the session and requires a fresh wake phrase", async () => {
  const { assistant, speech, requests } = fixture();
  await assistant.start();
  await assistant.beginListening();
  await assistant.hear("Stop listening.", 0.9);
  assert.equal(assistant.state.phase, "wake");
  assert.equal(assistant.state.conversationActive, false);
  assert.match(speech.spoken.at(-1), /Say Hey Deep/);
  await assistant.hear("What is a rainbow?", 1);
  assert.equal(requests.length, 0);
});

test("speech activity renews the idle timer and cancelled timers cannot end a new turn", async () => {
  const { assistant, speech, timers } = fixture();
  await assistant.start();
  await assistant.beginListening();
  const [oldId, oldTimer] = [...timers.entries()].find(([, timer]) => timer.ms === 60000);
  speech.emit("partial", { text: "I have a question" });
  assert.equal(timers.has(oldId), false);
  assert.equal([...timers.values()].filter((timer) => timer.ms === 60000).length, 1);
  await assistant.hear("What is a rainbow?", 0.9);
  await oldTimer.fn();
  assert.equal(assistant.state.phase, "listening");
  await assistant.stop();
});

test("an Ollama failure reports its real error and leaves the conversation ready to retry", async () => {
  const { assistant, speech } = fixture({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assistant.start();
  await assistant.beginListening();
  await assistant.hear("What is a rainbow?", 0.9);
  assert.equal(assistant.state.phase, "listening");
  assert.match(assistant.state.error, /Can't reach Ollama/);
  assert.equal(assistant.state.conversationActive, true);
  await assistant.hear("wave", 0.9);
  assert.equal(assistant.state.error, "");
  assert.equal(speech.spoken.at(-1), "Hello there!");
  await assistant.stop();
});

test("a TTS error preserves text and reopens the microphone for another turn", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  await assistant.beginListening();
  speech.speak = async () => { throw new Error("ElevenLabs unavailable"); };
  await assistant.hear("Hello", 0.9);
  assert.equal(assistant.state.phase, "listening");
  assert.match(assistant.state.error, /Speech output: ElevenLabs unavailable/);
  assert.equal(assistant.state.reply, "Hello, I'm Deep.");
  await assistant.stop();
});

test("microphone faults cancel a conversation, and Speak can recover", async () => {
  let complete;
  const { assistant, speech } = fixture({ fetchImpl: () => new Promise((resolve) => { complete = resolve; }) });
  await assistant.start();
  await assistant.beginListening();
  const pending = assistant.hear("Tell me a story", 0.9);
  await new Promise(setImmediate);
  speech.emit("fault", "Microphone disconnected");
  assert.equal(assistant.state.phase, "error");
  assert.equal(assistant.state.conversationActive, false);
  complete({ ok: true, json: async () => ({ message: { content: "Stale story" } }) });
  await pending;
  assert.equal(speech.spoken.length, 0);
  await assistant.beginListening();
  assert.equal(assistant.state.phase, "listening");
  assert.equal(assistant.state.recognitionError, "");
  await assistant.stop();
});

test("transcription keeps the voice turn active and only completed words reach Ollama", async () => {
  const { assistant, speech, requests, timers } = fixture();
  await assistant.start();
  await assistant.beginListening();
  speech.emit("level", { level: 32 });
  assert.equal(assistant.state.audioLevel, 32);
  assert.equal([...timers.values()].some((timer) => timer.ms === 10000), false);
  speech.emit("activity");
  speech.emit("transcribing");
  assert.equal(assistant.state.phase, "transcribing");
  assert.equal([...timers.values()].some((timer) => timer.ms === 60000), false);
  assert.equal(requests.length, 0);
  await assistant.hear("What is a rainbow?", 1);
  assert.equal(requests[0].body.messages.at(-1).content, "What is a rainbow?");
  assert.equal(assistant.state.phase, "listening");
  await assistant.stop();
});

test("quiet microphones and rejected text get visible feedback instead of silently doing nothing", async () => {
  const { assistant, speech, timers, requests } = fixture();
  await assistant.start();
  await assistant.beginListening();
  [...timers.values()].find((timer) => timer.ms === 10000).fn();
  assert.match(assistant.state.microphoneWarning, /No sound detected/);
  await assistant.hear("uncertain words", 0.1);
  assert.equal(requests.length, 0);
  assert.match(assistant.state.notice, /couldn't hear/);
  speech.emit("transcribing");
  speech.emit("rejected", { error: "Could not decode audio" });
  speech.emit("listening");
  assert.equal(assistant.state.phase, "listening");
  assert.match(assistant.state.notice, /Could not decode/);
  speech.emit("signal", { problem: "TooSoft" });
  assert.match(assistant.state.microphoneWarning, /quiet/);
  await assistant.stop();
});

test("the Hello greeting uses speech output directly without asking Ollama", async () => {
  const { assistant, speech, requests } = fixture();
  await assistant.start();
  await assistant.react("Hello!");
  assert.deepEqual(speech.spoken, ["Hello!"]);
  assert.equal(requests.length, 0);
  assert.equal(assistant.state.reply, "Hello!");
  assert.equal(assistant.state.phase, "wake");
});

test("Hello pauses microphone capture during playback and resumes the active conversation", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  await assistant.setEnabled(false);
  await assistant.beginListening();
  let finish;
  speech.speak = (text) => {
    speech.spoken.push(text);
    return new Promise((resolve) => { finish = resolve; });
  };
  const pending = assistant.react("Hello!");
  await new Promise(setImmediate);
  assert.equal(speech.modes.at(-1), "paused");
  assert.equal(assistant.state.conversationActive, true);
  // Repeated gestures cannot start overlapping audio.
  await assistant.react("Hello!");
  assert.equal(speech.spoken.length, 1);
  finish();
  await pending;
  assert.equal(assistant.state.phase, "listening");
  assert.equal(speech.modes.at(-1), "command");
  await assistant.stop();
});

test("stopping a Hello greeting prevents a late return to microphone capture", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  await assistant.beginListening();
  let finish;
  speech.speak = () => new Promise((resolve) => { finish = resolve; });
  const pending = assistant.react("Hello!");
  await new Promise(setImmediate);
  await assistant.stop();
  finish();
  await pending;
  assert.equal(assistant.state.phase, "wake");
  assert.equal(assistant.state.conversationActive, false);
});

test("smash sound pauses recognition and ignores its own rumble, then resumes the same conversation", async () => {
  const { assistant, speech, requests, opened } = fixture();
  await assistant.start();
  await assistant.beginListening();
  await assistant.holdSoundEffect();
  assert.equal(assistant.state.phase, "effect");
  assert.equal(speech.modes.at(-1), "paused");
  assert.equal(assistant.state.conversationActive, true);
  await assistant.hear("Hey Deep open Google", 1);
  await assistant.hear("noise from the speaker", 1);
  assert.equal(requests.length, 0);
  assert.equal(opened.length, 0);
  await assistant.releaseSoundEffect();
  assert.equal(assistant.state.phase, "listening");
  assert.equal(speech.modes.at(-1), "command");
  await assistant.stop();
});

test("an in-flight reply can finish during a smash but cannot reopen the microphone before the sound ends", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  await assistant.beginListening();
  let finish;
  speech.speak = () => new Promise((resolve) => { finish = resolve; });
  const pending = assistant.ask("Hello");
  await new Promise(setImmediate);
  await assistant.holdSoundEffect();
  assert.equal(assistant.state.phase, "synthesizing");
  finish();
  await pending;
  assert.equal(assistant.state.phase, "effect");
  assert.equal(speech.modes.at(-1), "paused");
  await assistant.releaseSoundEffect();
  assert.equal(assistant.state.phase, "listening");
  await assistant.stop();
});

test("repeated smashes extend the audio hold; Stop ends the conversation while preserving echo protection", async () => {
  const { assistant, speech, timers } = fixture();
  await assistant.start();
  await assistant.beginListening();
  await assistant.holdSoundEffect();
  const oldTimer = [...timers.values()].find((timer) => timer.ms === 2100);
  await assistant.holdSoundEffect();
  await oldTimer.fn();
  assert.equal(assistant.state.phase, "effect");
  assert.equal([...timers.values()].filter((timer) => timer.ms === 2100).length, 1);
  await assistant.stop();
  assert.equal(assistant.state.conversationActive, false);
  assert.equal(speech.modes.at(-1), "paused");
  await [...timers.values()].find((timer) => timer.ms === 2100).fn();
  assert.equal(assistant.state.phase, "wake");
  assert.equal(speech.modes.at(-1), "wake");
});

test("a smash never turns on a muted wake microphone", async () => {
  const { assistant, speech } = fixture();
  await assistant.start();
  await assistant.setEnabled(false);
  await assistant.holdSoundEffect();
  await assistant.releaseSoundEffect();
  assert.equal(assistant.state.phase, "off");
  assert.equal(speech.modes.at(-1), "paused");
});
