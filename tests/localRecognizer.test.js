import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { LocalRecognizer } = require("../electron/local-recognizer.cjs");
const { LocalTranscriber } = require("../electron/local-transcriber.cjs");
const { DeepAssistant } = require("../electron/assistant.cjs");
const tick = () => new Promise(setImmediate);

function fixture() {
  const capture = new EventEmitter();
  capture.modes = [];
  capture.start = async () => ({ recognitionAvailable: true });
  capture.setMode = async (mode) => { capture.modes.push(mode); };
  capture.dispose = () => {};
  const transcriber = new EventEmitter();
  transcriber.start = async () => ({ engine: "Whisper" });
  transcriber.transcribe = async () => "What is a rainbow?";
  transcriber.cancel = () => {};
  transcriber.dispose = () => {};
  const recognizer = new LocalRecognizer({ capture, transcriber });
  return { capture, transcriber, recognizer };
}

test("spoken questions use actual audio and Whisper text, regardless of Windows' guessed words or confidence", async () => {
  const { capture, transcriber, recognizer } = fixture();
  assert.equal((await recognizer.start()).stt, "Whisper (local)");
  const events = [];
  let audio;
  recognizer.on("recognized", (event) => events.push(event));
  transcriber.transcribe = async (wav) => { audio = wav; return "What is a rainbow?"; };
  await recognizer.setMode("command");
  capture.emit("recognized", { text: "Windows got this wrong", confidence: 0.1 });
  capture.emit("audio", { wav: "actual microphone audio", confidence: 0.05 });
  await tick();
  assert.equal(audio, "actual microphone audio");
  assert.deepEqual(events, [{ text: "What is a rainbow?", confidence: 1, engine: "Whisper" }]);
  assert.equal(capture.modes.at(-1), "command");
  recognizer.dispose();
});

test("wake detection stays local and conversation hypotheses are not presented as final text", async () => {
  const { capture, recognizer } = fixture();
  const recognized = [];
  let activity = 0;
  recognizer.on("recognized", (event) => recognized.push(event.text));
  recognizer.on("activity", () => activity++);
  await recognizer.setMode("wake");
  capture.emit("recognized", { text: "hey deep", confidence: 0.9 });
  await recognizer.setMode("command");
  capture.emit("partial", { text: "wrong provisional words" });
  assert.deepEqual(recognized, ["hey deep"]);
  assert.equal(activity, 1);
  recognizer.dispose();
});

test("Stop discards pending transcription and repeated captures cannot submit duplicate questions", async () => {
  const { capture, transcriber, recognizer } = fixture();
  let complete;
  let calls = 0;
  transcriber.transcribe = () => { calls++; return new Promise((resolve) => { complete = resolve; }); };
  const recognized = [];
  recognizer.on("recognized", (event) => recognized.push(event));
  await recognizer.setMode("command");
  capture.emit("audio", { wav: "first" });
  capture.emit("audio", { wav: "duplicate" });
  await tick();
  assert.equal(calls, 1);
  await recognizer.setMode("paused");
  complete("late words");
  await tick();
  assert.deepEqual(recognized, []);
  assert.equal(capture.modes.at(-1), "paused");
  recognizer.dispose();
});

test("empty transcription and recoverable decoding errors reopen capture and show a retry notice", async () => {
  const { capture, transcriber, recognizer } = fixture();
  const rejected = [];
  let listening = 0;
  recognizer.on("rejected", (event) => rejected.push(event));
  recognizer.on("listening", () => listening++);
  await recognizer.setMode("command");
  transcriber.transcribe = async () => "";
  capture.emit("audio", { wav: "quiet audio" });
  await tick();
  assert.equal(listening, 1);
  assert.equal(capture.modes.at(-1), "command");
  transcriber.transcribe = async () => { throw new Error("Unreadable WAV"); };
  capture.emit("audio", { wav: "bad audio" });
  await tick();
  assert.equal(listening, 2);
  assert.match(rejected[1].error, /Unreadable WAV/);
  recognizer.dispose();
});

test("a transcription-engine fault pauses capture and prevents late text", async () => {
  const { capture, transcriber, recognizer } = fixture();
  const faults = [];
  recognizer.on("fault", (message) => faults.push(message));
  await recognizer.setMode("command");
  transcriber.emit("fault", "Whisper stopped");
  await tick();
  assert.equal(recognizer.mode, "paused");
  assert.equal(capture.modes.at(-1), "paused");
  assert.deepEqual(faults, ["Whisper stopped"]);
  recognizer.dispose();
});

test("actual recognition events drive successive assistant turns, and repeated Hey Deep cannot stall capture", async () => {
  const { capture, transcriber, recognizer } = fixture();
  recognizer.speak = async () => {};
  recognizer.cancelSpeech = () => {};
  const questions = [];
  const assistant = new DeepAssistant({
    speech: recognizer,
    openExternal: async () => {},
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      questions.push(body.messages.at(-1).content);
      return { ok: true, json: async () => ({ message: { content: "Here is your answer." } }) };
    },
  });
  try {
    await assistant.start();
    await assistant.beginListening();
    for (const text of ["What is a rainbow?", "Hey Deep", "Tell me more about that."]) {
      transcriber.transcribe = async () => text;
      capture.emit("audio", { wav: "spoken utterance" });
      await tick();
      assert.equal(assistant.state.phase, "listening");
      assert.equal(capture.modes.at(-1), "command");
    }
    assert.deepEqual(questions, ["What is a rainbow?", "Tell me more about that."]);
  } finally { assistant.dispose(); }
});

test("wake plus question uses Whisper audio, and background speech cannot enter transcription", async () => {
  const { capture, transcriber, recognizer } = fixture();
  recognizer.speak = async () => {};
  recognizer.cancelSpeech = () => {};
  const opened = [];
  let transcriptions = 0;
  transcriber.transcribe = async () => { transcriptions++; return "Hey Deep, open Google and search for cats."; };
  const assistant = new DeepAssistant({ speech: recognizer,
    openExternal: async (url) => { opened.push(url); } });
  try {
    await assistant.start();
    capture.emit("recognized", { text: "ordinary background words", confidence: 0.9, wav: "background" });
    await tick();
    assert.equal(transcriptions, 0);
    assert.equal(assistant.state.phase, "wake");
    capture.emit("recognized", { text: "hey deep open google and search for wrong words", confidence: 0.9, wav: "wake and question audio" });
    assert.equal(assistant.state.phase, "transcribing");
    await tick();
    assert.equal(transcriptions, 1);
    assert.deepEqual(opened, ["https://www.google.com/search?q=cats"]);
    assert.equal(assistant.state.phase, "listening");
  } finally { assistant.dispose(); }
});

function workerFixture() {
  const workers = [];
  const transcriber = new LocalTranscriber({ workerFactory: () => {
    const worker = new EventEmitter();
    worker.commands = [];
    worker.postMessage = (event) => worker.commands.push(event);
    worker.terminate = () => {};
    workers.push(worker);
    return worker;
  } });
  transcriber.on("fault", () => {});
  return { transcriber, workers };
}

test("Whisper worker cancellation discards late output and permits another transcription", async () => {
  const { transcriber, workers } = workerFixture();
  const start = transcriber.start();
  const worker = workers[0];
  worker.emit("message", { type: "ready" });
  await start;
  const pending = transcriber.transcribe("x".repeat(100));
  await tick();
  const first = worker.commands[0];
  const rejected = assert.rejects(pending, { name: "AbortError" });
  transcriber.cancel();
  await rejected;
  worker.emit("message", { type: "result", id: first.id, text: "Stale transcript" });
  const next = transcriber.transcribe("x".repeat(100));
  await tick();
  worker.emit("message", { type: "result", id: worker.commands[1].id, text: "Fresh transcript" });
  assert.equal(await next, "Fresh transcript");
  transcriber.dispose();
});

test("Whisper initialization failure can be retried, and invalid audio is rejected", async () => {
  const { transcriber, workers } = workerFixture();
  const pending = transcriber.start();
  const rejected = assert.rejects(pending, /model unavailable/);
  workers[0].emit("message", { type: "error", error: "model unavailable" });
  await rejected;
  const next = transcriber.start();
  workers[1].emit("message", { type: "ready" });
  await next;
  await assert.rejects(transcriber.transcribe(""), /invalid or oversized/);
  transcriber.dispose();
});
