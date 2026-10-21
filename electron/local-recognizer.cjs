const { EventEmitter } = require("node:events");
const { WindowsSpeech } = require("./windows-speech.cjs");
const { LocalTranscriber } = require("./local-transcriber.cjs");
const { extractWake } = require("./assistant.cjs");

class LocalRecognizer extends EventEmitter {
  constructor({ capture = new WindowsSpeech(), transcriber = new LocalTranscriber() } = {}) {
    super();
    this.capture = capture;
    this.transcriber = transcriber;
    this.mode = "paused";
    this.generation = 0;
    this.processing = false;
    capture.on("recognized", (event) => {
      if (this.mode !== "wake" || this.processing) return;
      if (event.wav && extractWake(event.text)?.command && event.confidence >= 0.45) {
        // Windows gates the wake phrase; Whisper decodes the whole question.
        this.mode = "command";
        void this.recognize({ wav: event.wav, wake: true });
      } else this.emit("recognized", event);
    });
    // Dictation hypotheses are provisional Windows guesses, not Whisper text.
    capture.on("partial", () => { if (this.mode === "command" && !this.processing) this.emit("activity"); });
    capture.on("level", (event) => { if (!this.processing) this.emit("level", event); });
    capture.on("signal", (event) => { if (!this.processing) this.emit("signal", event); });
    capture.on("audio", (event) => { void this.recognize(event); });
    capture.on("rejected", (event) => { if (!this.processing) this.emit("rejected", event); });
    const fault = (message) => {
      this.generation++;
      this.processing = false;
      this.mode = "paused";
      transcriber.cancel();
      void capture.setMode("paused").catch(() => {});
      this.emit("fault", message);
    };
    capture.on("fault", fault);
    transcriber.on("fault", fault);
  }

  async start() {
    const [info] = await Promise.all([this.capture.start(), this.transcriber.start()]);
    return { ...info, stt: "Whisper (local)" };
  }

  async setMode(mode) {
    this.generation++;
    this.processing = false;
    this.mode = mode;
    this.transcriber.cancel();
    await this.capture.setMode(mode);
  }

  async recognize(event) {
    if (this.mode !== "command" || this.processing) return;
    const generation = this.generation;
    this.processing = true;
    this.emit("transcribing", { wake: !!event.wake });
    try {
      // Native speech detection supplies WAV for both accepted and rejected
      // dictation. Whisper, not the Windows confidence score, decides the text.
      await this.capture.setMode("paused");
      if (generation !== this.generation) return;
      let text = await this.transcriber.transcribe(event.wav);
      if (generation !== this.generation) return;
      if (event.wake) {
        const wake = extractWake(text);
        text = wake ? wake.command : text.replace(/^(?:hey|hay)[\s,!.:-]+(?:deep|dee|dip|deap)\b[\s,!.:;-]*/i, "");
      }
      if (text) {
        this.emit("recognized", { text, confidence: 1, engine: "Whisper" });
        // A repeated wake phrase or ignored result may not start a reply.
        // Do not leave capture paused when the consumer keeps the same turn.
        if (generation === this.generation) await this.resume(generation);
      } else {
        this.emit("rejected", { reason: "empty" });
        await this.resume(generation);
      }
    } catch (error) {
      if (generation !== this.generation || error.name === "AbortError") return;
      this.emit("rejected", { error: `Speech recognition: ${error.message}` });
      await this.resume(generation);
    }
  }

  async resume(generation) {
    try {
      if (generation !== this.generation) return;
      await this.capture.setMode("command");
      if (generation !== this.generation) return;
      this.processing = false;
      this.emit("listening");
    } catch (error) {
      if (generation === this.generation) this.emit("fault", error.message);
    }
  }

  dispose() {
    this.generation++;
    this.capture.dispose();
    this.transcriber.dispose();
  }
}

module.exports = { LocalRecognizer };
