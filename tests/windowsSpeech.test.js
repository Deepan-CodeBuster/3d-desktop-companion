import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { WindowsSpeech } = require("../electron/windows-speech.cjs");

function fixture() {
  const children = [];
  const speech = new WindowsSpeech({ spawnImpl: () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.commands = [];
    child.stdin.on("data", (bytes) => child.commands.push(JSON.parse(bytes.toString())));
    child.kill = () => { child.killed = true; };
    child.event = (value) => child.stdout.write(JSON.stringify(value) + "\n");
    children.push(child);
    return child;
  } });
  const faults = [];
  speech.on("fault", (message) => faults.push(message));
  return { speech, children, faults };
}

async function ready(speech, children) {
  const pending = speech.start();
  const child = children.at(-1);
  child.event({ type: "ready", recognitionAvailable: true });
  await pending;
  return child;
}

test("microphone mode changes require acknowledgement and reject results from older turns", async () => {
  const { speech, children } = fixture();
  const child = await ready(speech, children);
  const recognized = [];
  speech.on("recognized", (event) => recognized.push(event.text));
  let listening = false;
  const pending = speech.setMode("command").then(() => { listening = true; });
  const first = child.commands.at(-1);
  child.event({ type: "recognized", token: first.id, text: "Before microphone ready" });
  assert.equal(listening, false);
  child.event({ type: "mode-set", id: first.id, mode: "command" });
  await pending;
  child.event({ type: "recognized", token: first.id, text: "First question" });
  const paused = speech.setMode("paused");
  const second = child.commands.at(-1);
  child.event({ type: "recognized", token: first.id, text: "Buffered echo" });
  child.event({ type: "mode-set", id: second.id, mode: "paused" });
  await paused;
  const nextTurn = speech.setMode("command");
  const third = child.commands.at(-1);
  child.event({ type: "mode-set", id: third.id, mode: "command" });
  await nextTurn;
  child.event({ type: "recognized", token: first.id, text: "Late first question" });
  child.event({ type: "recognized", token: third.id, text: "Follow-up question" });
  assert.deepEqual(recognized, ["First question", "Follow-up question"]);
  speech.dispose();
});

test("overlapping mode acknowledgements never reactivate a cancelled capture", async () => {
  const { speech, children } = fixture();
  const child = await ready(speech, children);
  const command = speech.setMode("command");
  const first = child.commands.at(-1);
  const paused = speech.setMode("paused");
  const second = child.commands.at(-1);
  child.event({ type: "mode-set", id: first.id, mode: "command" });
  await command;
  assert.equal(speech.activeToken, null);
  child.event({ type: "mode-set", id: second.id, mode: "paused" });
  await paused;
  assert.equal(speech.mode, "paused");
  speech.dispose();
});

test("a worker exit rejects pending transitions and permits a fresh microphone process", async () => {
  const { speech, children, faults } = fixture();
  const child = await ready(speech, children);
  const pending = speech.setMode("command");
  const rejected = assert.rejects(pending, /speech process stopped/);
  child.emit("exit", 1);
  await rejected;
  assert.equal(faults.length, 1);
  assert.equal(child.killed, true);
  const next = await ready(speech, children);
  assert.notEqual(next, child);
  speech.dispose();
});

test("disposing during startup settles the pending start instead of hanging", async () => {
  const { speech } = fixture();
  const pending = speech.start();
  const rejected = assert.rejects(pending, /recognition stopped/);
  speech.dispose();
  await rejected;
});

test("Speak retries initialization after a previously unavailable microphone", async () => {
  const { speech, children } = fixture();
  const pending = speech.start();
  children[0].event({ type: "ready", recognitionAvailable: false, error: "No input device" });
  assert.equal((await pending).recognitionAvailable, false);
  await ready(speech, children);
  assert.equal(children.length, 2);
  assert.equal(children[0].killed, true);
  speech.dispose();
});
