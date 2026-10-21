const { EventEmitter } = require("node:events");
const { LocalRecognizer } = require("./local-recognizer.cjs");
const { DEFAULT_VOICE_ID, DEFAULT_MODEL_ID } = require("./voice-config.cjs");

function sanitizeError(message, apiKey) {
  const text = String(message || "Speech generation failed.");
  return (apiKey ? text.split(apiKey).join("[redacted]") : text)
    .replace(/sk_[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 500);
}

async function synthesizeSpeech({ apiKey, voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL_ID,
  text, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in .env.local, then restart Deep.");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(voiceId)) throw new Error("The ElevenLabs voice ID is invalid.");
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    throw new Error("Speech text must contain between 1 and 4,000 characters.");
  }
  const spokenText = text.replace(/```[\s\S]*?```/g, " Code example omitted from speech. ")
    .replace(/[*#`]/g, "").trim();
  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST", signal,
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: spokenText, model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
      }),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : body.detail?.message;
    const fallback = {
      401: "ElevenLabs rejected the API key. Check your private voice configuration.",
      402: "Your ElevenLabs account cannot use this voice or has insufficient credits. Check voice access and account limits.",
      403: "ElevenLabs denied access. Check the key's text-to-speech permission and voice access.",
      404: "The selected ElevenLabs voice was not found or is unavailable to this account.",
      429: "ElevenLabs is rate limiting requests. Please try again shortly.",
    }[response.status] || `ElevenLabs returned HTTP ${response.status}.`;
    throw new Error(`ElevenLabs (${response.status}): ${sanitizeError(detail || fallback, apiKey)}`);
  }
  const contentType = response.headers.get("content-type") || "audio/mpeg";
  if (!contentType.startsWith("audio/") && !contentType.startsWith("application/octet-stream")) {
    throw new Error("ElevenLabs returned a response that does not contain audio.");
  }
  const audio = await response.arrayBuffer();
  if (!audio.byteLength) throw new Error("ElevenLabs returned empty audio. Please try again.");
  return { audio, mimeType: "audio/mpeg" };
}

class ElevenLabsSpeech extends EventEmitter {
  constructor({ apiKey, voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL_ID,
    onAudio, onCancel, recognizer = new LocalRecognizer(), fetchImpl = fetch }) {
    super();
    this.config = { apiKey, voiceId, modelId };
    this.onAudio = onAudio;
    this.onCancel = onCancel;
    this.recognizer = recognizer;
    this.fetch = fetchImpl;
    this.pending = new Map();
    this.sequence = 0;
    recognizer.on("recognized", (event) => this.emit("recognized", event));
    recognizer.on("partial", (event) => this.emit("partial", event));
    recognizer.on("rejected", (event) => this.emit("rejected", event));
    recognizer.on("fault", (error) => this.emit("fault", error));
    for (const type of ["activity", "level", "signal", "transcribing", "listening"]) {
      recognizer.on(type, (event) => this.emit(type, event));
    }
  }

  async start() {
    const info = await this.recognizer.start();
    return { ...info, speechAvailable: !!this.config.apiKey, tts: "ElevenLabs" };
  }

  setMode(mode) { return this.recognizer.setMode(mode); }

  speak(text) {
    const id = `elevenlabs-${++this.sequence}`;
    const abort = new AbortController();
    let pending;
    const result = new Promise((resolve, reject) => {
      pending = { resolve, reject, abort };
      pending.requestTimer = setTimeout(() => {
        this.finishPlayback(id, "ElevenLabs took too long to respond. Please try again.");
      }, 45000);
      pending.playbackTimer = setTimeout(() => {
        this.finishPlayback(id, "Speech playback timed out. Please try again.");
        this.onCancel();
      }, 120000);
      this.pending.set(id, pending);
    });
    void synthesizeSpeech({ ...this.config, text, signal: abort.signal, fetchImpl: this.fetch })
      .then((packet) => {
        if (!this.pending.has(id)) return;
        clearTimeout(pending.requestTimer);
        this.emit("speaking");
        this.onAudio({ id, ...packet });
      })
      .catch((error) => {
        const message = error.message === "fetch failed"
          ? "Can't reach ElevenLabs. Check your internet connection."
          : sanitizeError(error.message, this.config.apiKey);
        this.finishPlayback(id, message);
      });
    return result;
  }

  finishPlayback(id, error = "") {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.requestTimer);
    clearTimeout(pending.playbackTimer);
    pending.abort.abort();
    if (error) pending.reject(new Error(sanitizeError(error, this.config.apiKey)));
    else setTimeout(pending.resolve, 180);
  }

  cancelSpeech() {
    this.onCancel();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.requestTimer);
      clearTimeout(pending.playbackTimer);
      pending.abort.abort();
      pending.resolve();
    }
    this.pending.clear();
  }

  dispose() { this.cancelSpeech(); this.recognizer.dispose(); }
}

module.exports = { ElevenLabsSpeech, synthesizeSpeech };
