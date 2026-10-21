const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util");
const path = require("node:path");

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";

function loadVoiceConfig({ env = process.env, localPath = path.join(__dirname, "../.env.local"), readFile = readFileSync } = {}) {
  let local = {};
  try { local = parseEnv(readFile(localPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return {
    apiKey: (env.ELEVENLABS_API_KEY || local.ELEVENLABS_API_KEY || "").trim(),
    voiceId: (env.ELEVENLABS_VOICE_ID || local.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID).trim(),
    modelId: (env.ELEVENLABS_MODEL_ID || local.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID).trim(),
  };
}

module.exports = { loadVoiceConfig, DEFAULT_VOICE_ID, DEFAULT_MODEL_ID };
