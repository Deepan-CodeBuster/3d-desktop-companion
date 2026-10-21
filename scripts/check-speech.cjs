const assert = require("node:assert/strict");
const { LocalRecognizer } = require("../electron/local-recognizer.cjs");

// Briefly opens the default microphone to check real cancel/restart cycles.
// No recordings or recognized user text are saved or printed.
async function main() {
  const speech = new LocalRecognizer();
  const faults = [];
  speech.on("fault", (message) => faults.push(message));
  try {
    const info = await speech.start();
    assert.equal(info.recognitionAvailable, true, info.error);
    for (const mode of ["wake", "paused", "command", "paused", "command", "paused", "wake", "paused"]) {
      await speech.setMode(mode);
      assert.equal(speech.mode, mode);
      assert.equal(mode === "paused", speech.capture.activeToken === null);
    }
    assert.deepEqual(faults, []);
    console.log(`${info.stt}, Windows ${info.culture}: wake, two conversation turns, pause and restart acknowledged successfully.`);
  } finally {
    speech.dispose();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
