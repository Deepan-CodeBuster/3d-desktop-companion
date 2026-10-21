const assert = require("node:assert/strict");
const { readFile, mkdir } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { LocalTranscriber } = require("../electron/local-transcriber.cjs");

async function main() {
  const directory = path.resolve(".cache/stt-fixtures");
  await mkdir(directory, { recursive: true });
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      path.join(__dirname, "make-stt-fixtures.ps1"), "-Destination", directory], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (bytes) => { error += bytes.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error || `Audio fixture creation failed: ${code}`)));
  });
  const transcriber = new LocalTranscriber();
  transcriber.on("fault", () => {});
  try {
    await transcriber.start();
    const phrases = [
      ["question.wav", /what is a rainbow/i],
      ["search.wav", /open google and search for cats/i],
      ["followup.wav", /tell me more about that/i],
      ["wake-question.wav", /hey[,.]? deep[,.]? open google and search for cats/i],
    ];
    for (const [file, expected] of phrases) {
      const audio = await readFile(path.join(directory, file));
      const started = performance.now();
      const text = await transcriber.transcribe(audio.toString("base64"));
      assert.match(text, expected);
      console.log(`${file}: ${text} (${((performance.now() - started) / 1000).toFixed(2)}s)`);
    }
  } finally { transcriber.dispose(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
