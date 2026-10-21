const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const { loadVoiceConfig } = require("../electron/voice-config.cjs");
const { synthesizeSpeech } = require("../electron/elevenlabs-speech.cjs");

(async () => {
  try {
    const result = await synthesizeSpeech({ ...loadVoiceConfig(), text: "Hulk smash!",
      signal: AbortSignal.timeout(45000) });
    const destination = path.resolve("public/sounds/hulk-smash-voice.mp3");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(result.audio));
    console.log(`Saved Hulk's ElevenLabs voice (${result.audio.byteLength} bytes).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
