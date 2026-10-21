const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const { loadVoiceConfig } = require("../electron/voice-config.cjs");
const { synthesizeSpeech } = require("../electron/elevenlabs-speech.cjs");

(async () => {
  try {
    const config = loadVoiceConfig();
    const result = await synthesizeSpeech({ ...config, text: "Hi, I'm Deep.", signal: AbortSignal.timeout(45000) });
    const destination = path.resolve("artifacts/deep-elevenlabs-sample.mp3");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(result.audio));
    console.log(`ElevenLabs voice verified. Saved artifacts/deep-elevenlabs-sample.mp3 (${result.audio.byteLength} bytes).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
