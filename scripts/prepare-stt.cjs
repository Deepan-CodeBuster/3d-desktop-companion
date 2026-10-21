const { LocalTranscriber } = require("../electron/local-transcriber.cjs");

async function main() {
  const transcriber = new LocalTranscriber();
  transcriber.on("fault", () => {});
  const reported = new Map();
  transcriber.on("progress", (event) => {
    const percentage = Math.floor((event.progress || 0) / 25) * 25;
    if (event.file && reported.get(event.file) !== percentage && event.status === "progress") {
      reported.set(event.file, percentage);
      console.log(`Downloading ${event.file}: ${percentage}%`);
    }
  });
  try {
    const info = await transcriber.start();
    console.log(`${info.model} is ready. Speech transcription runs locally; microphone audio is not uploaded.`);
  } finally { transcriber.dispose(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
