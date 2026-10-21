const { EventEmitter } = require("node:events");
const { Worker } = require("node:worker_threads");
const path = require("node:path");

const STT_MODEL = "onnx-community/whisper-base.en";

class LocalTranscriber extends EventEmitter {
  constructor({ cacheDir = path.join(__dirname, "../.cache/whisper"),
    workerFactory = (file, options) => new Worker(file, options) } = {}) {
    super();
    this.cacheDir = cacheDir;
    this.workerFactory = workerFactory;
    this.pending = new Map();
    this.sequence = 0;
  }

  start() {
    if (this.starting) return this.starting;
    const starting = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.starting = starting;
    try {
      const worker = this.workerFactory(path.join(__dirname, "whisper-worker.cjs"), {
        workerData: { cacheDir: this.cacheDir, model: STT_MODEL },
      });
      this.worker = worker;
      this.startTimer = setTimeout(() => this.failed("Local speech recognition took too long to load. Run npm run setup:stt, then restart Deep."), 180000);
      worker.on("message", (event) => {
        if (this.worker !== worker) return;
        if (event.type === "ready") {
          clearTimeout(this.startTimer);
          this.resolveStart?.({ engine: "Whisper", model: STT_MODEL });
          this.resolveStart = this.rejectStart = null;
        } else if (event.type === "progress") {
          this.emit("progress", event);
        } else if (event.type === "result") {
          const pending = this.pending.get(event.id);
          if (!pending) return;
          this.pending.delete(event.id);
          clearTimeout(pending.timer);
          if (event.error) pending.reject(new Error(event.error));
          else pending.resolve(event.text);
        } else if (event.type === "error") {
          this.failed(event.error);
        }
      });
      worker.on("error", (error) => { if (this.worker === worker) this.failed(error.message); });
      worker.on("exit", () => { if (this.worker === worker) this.failed("Local speech recognition stopped. Click Speak to retry."); });
    } catch (error) { this.failed(error.message); }
    return starting;
  }

  async transcribe(wav) {
    if (typeof wav !== "string" || wav.length < 60 || wav.length > 6000000) throw new Error("The microphone returned invalid or oversized audio.");
    await this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failed("Speech transcription took too long. Click Speak to retry."), 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type: "transcribe", id, wav });
    });
  }

  cancel() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      const error = new Error("Transcription cancelled.");
      error.name = "AbortError";
      pending.reject(error);
    }
    this.pending.clear();
  }

  close(message) {
    clearTimeout(this.startTimer);
    this.rejectStart?.(new Error(message));
    this.resolveStart = this.rejectStart = null;
    this.cancel();
    const worker = this.worker;
    this.worker = null;
    this.starting = null;
    void worker?.terminate();
  }

  failed(message) {
    this.close(message);
    this.emit("fault", message);
  }

  dispose() { this.close("Local speech recognition closed."); }
}

module.exports = { LocalTranscriber, STT_MODEL };
