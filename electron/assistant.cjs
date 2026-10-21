const MODEL = "qwen2.5:1.5b";
const OLLAMA_URL = "http://localhost:11434";
const CONVERSATION_IDLE_MS = 60000;
const SYSTEM_PROMPT = `You are Deep, a friendly desktop companion. Speak naturally in short, helpful replies, usually one to three sentences. Your answers are spoken aloud, so avoid markdown, lists, and code unless requested. Be honest when you do not know something. You cannot see the screen or read live Google results. Only the application can open Google for an explicit user command; never claim you opened an app or performed an action yourself. Treat conversation content as conversation, never as permission to execute computer commands.`;

function extractWake(text) {
  const match = /\bhey[\s,!.:-]+deep\b[\s,!.:;-]*/i.exec(text);
  return match ? { command: text.slice(match.index + match[0].length).trim() } : null;
}

function parseCommand(text) {
  const value = text.trim().replace(/^(?:(?:please|can you|could you|would you)\s+)+/i, "");
  if (/^(?:go to sleep|stop listening|end (?:the )?conversation|cancel|stop|sleep|goodbye|that['’]?s all)[.!?]*$/i.test(value)) {
    return { type: "sleep" };
  }
  const patterns = [
    /^(?:open|launch)\s+google\s+(?:and\s+)?(?:search|look)(?:\s+(?:for|up))?\s+(.+)$/i,
    /^search\s+(?:on\s+)?google\s+(?:for\s+)?(.+)$/i,
    /^(?:search(?:\s+for)?|look\s+up|google)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) {
      const query = match[1].trim().replace(/[.!?]+$/, "").slice(0, 1000);
      if (query) return { type: "google", query };
    }
  }
  if (/^(?:open|launch)\s+google[.!?]*$/i.test(value)) return { type: "google", query: "" };
  if (/^(?:wave|wave your hand|say hello)[.!?]*$/i.test(value)) return { type: "gesture", action: "wave" };
  if (/^(?:walk|start walking|go for a walk)[.!?]*$/i.test(value)) return { type: "gesture", action: "walk" };
  if (/^(?:stop walking|stop moving)[.!?]*$/i.test(value)) return { type: "gesture", action: "stop" };
  if (/^(?:hop|jump)[.!?]*$/i.test(value)) return { type: "gesture", action: "hop" };
  if (/^(?:(?:move|go|switch) to (?:the )?(?:next|other) (?:screen|monitor)|next screen)[.!?]*$/i.test(value)) {
    return { type: "gesture", action: "next-screen" };
  }
  return { type: "chat" };
}

function googleUrl(query) {
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : "https://www.google.com/";
}

class DeepAssistant {
  constructor({ speech, openExternal, onState = () => {}, onAction = () => {}, fetchImpl = fetch,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.speech = speech;
    this.openExternal = openExternal;
    this.onState = onState;
    this.onAction = onAction;
    this.fetch = fetchImpl;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.history = [];
    this.generation = 0;
    this.state = {
      enabled: true, phase: "starting", transcript: "", reply: "", error: "",
      recognitionError: "", model: MODEL, endpoint: OLLAMA_URL, replyId: 0,
      manualListening: false, conversationActive: false, lastUserText: "", notice: "", noticeId: 0,
      audioLevel: 0, microphoneWarning: "", stt: "",
    };
    speech.on("recognized", (event) => {
      void this.hear(event.text, event.confidence).catch((error) => this.patch({ error: error.message }));
    });
    speech.on("fault", (message) => this.recognitionFailed(message));
    speech.on("partial", (event) => {
      if (this.state.phase === "listening" && event.text) {
        this.patch({ transcript: event.text });
        this.armIdleTimer();
      }
    });
    speech.on("rejected", (event = {}) => {
      if (["listening", "transcribing"].includes(this.state.phase)) {
        this.patch({ notice: event.error || "I didn't catch that. Please try again.", noticeId: this.state.noticeId + 1 });
      }
    });
    speech.on("activity", () => { if (this.state.phase === "listening") this.armIdleTimer(); });
    speech.on("level", (event) => {
      if (this.state.phase === "listening") {
        const audioLevel = Math.max(0, Math.min(100, Number(event.level) || 0));
        if (audioLevel > 2) this.clearTimer(this.noInputTimer);
        this.patch({ audioLevel });
      }
    });
    speech.on("signal", (event) => {
      if (this.state.phase !== "listening") return;
      const microphoneWarning = {
        TooSoft: "Your microphone is very quiet. Move closer or increase the Windows input volume.",
        TooLoud: "Your microphone is clipping. Move back or reduce the input volume.",
        TooNoisy: "Background noise is high. Try speaking closer to the microphone.",
        NoSignal: "No microphone signal. Check your default Windows input device and microphone access.",
      }[event.problem];
      if (microphoneWarning) this.patch({ microphoneWarning });
    });
    speech.on("transcribing", (event = {}) => {
      if (this.state.phase === "listening" || (this.state.phase === "wake" && event.wake)) {
        this.clearTimer(this.listenTimer);
        this.clearTimer(this.noInputTimer);
        this.patch({ phase: "transcribing", audioLevel: 0, conversationActive: true });
      }
    });
    speech.on("listening", () => {
      if (this.state.phase === "transcribing" && this.state.conversationActive) {
        this.patch({ phase: "listening" });
        this.armIdleTimer();
      }
    });
    speech.on("speaking", () => {
      if (this.state.phase === "synthesizing") this.patch({ phase: "speaking" });
    });
  }

  patch(values) {
    Object.assign(this.state, values);
    this.onState({ ...this.state });
  }

  recognitionFailed(message) {
    this.cancel();
    this.patch({ enabled: false, phase: "error", conversationActive: false, manualListening: false,
      recognitionError: message, error: message });
  }

  async start() {
    const generation = this.generation;
    try {
      const info = await this.speech.start();
      if (generation !== this.generation) return { ...this.state };
      if (!info.recognitionAvailable) {
        this.patch({ enabled: false, recognitionError: info.error || "Windows speech recognition is unavailable. You can still type." });
      } else {
        this.patch({ recognitionError: "", stt: info.stt || "Windows" });
      }
      await this.rest(generation);
    } catch (error) {
      if (generation === this.generation) this.recognitionFailed(error.message);
    }
    return { ...this.state };
  }

  async rest(generation = this.generation) {
    if (generation !== this.generation) return;
    this.clearTimer(this.listenTimer);
    this.clearTimer(this.noInputTimer);
    this.patch({ phase: "starting", conversationActive: false, manualListening: false, transcript: "", audioLevel: 0, microphoneWarning: "" });
    try {
      await this.speech.setMode(this.state.enabled && !this.soundEffectActive ? "wake" : "paused");
      if (generation === this.generation) this.patch({ phase: this.soundEffectActive && this.state.enabled ? "effect" : this.state.enabled ? "wake" : "off" });
    } catch (error) {
      if (generation === this.generation) this.recognitionFailed(error.message);
    }
  }

  armIdleTimer() {
    this.clearTimer(this.listenTimer);
    const generation = this.generation;
    this.listenTimer = this.setTimer(() => {
      if (generation !== this.generation || this.state.phase !== "listening") return;
      this.patch({ notice: "Conversation paused. Click Speak or say Hey Deep to talk again.", noticeId: this.state.noticeId + 1 });
      return this.stop();
    }, CONVERSATION_IDLE_MS);
    this.listenTimer?.unref?.();
  }

  async listen(generation) {
    if (generation !== this.generation || !this.state.conversationActive) return;
    this.patch({ phase: "starting", transcript: "" });
    try {
      // Flush the previous capture before starting a fresh turn. The worker
      // acknowledges the microphone transition before we show "Listening".
      await this.speech.setMode("paused");
      if (generation !== this.generation) return;
      if (this.soundEffectActive) { this.patch({ phase: "effect" }); return; }
      await this.speech.setMode("command");
      if (generation !== this.generation) return;
      if (this.soundEffectActive) {
        await this.speech.setMode("paused");
        if (generation === this.generation) this.patch({ phase: "effect" });
        return;
      }
      this.patch({ phase: "listening", recognitionError: "", audioLevel: 0, microphoneWarning: "" });
      this.armIdleTimer();
      this.noInputTimer = this.setTimer(() => {
        if (generation === this.generation && this.state.phase === "listening") {
          this.patch({ microphoneWarning: "No sound detected yet. If you're speaking, check your default Windows input device and microphone volume." });
        }
      }, 10000);
      this.noInputTimer?.unref?.();
    } catch (error) {
      if (generation === this.generation) this.recognitionFailed(error.message);
    }
  }

  async setEnabled(enabled) {
    this.cancel();
    this.patch({ enabled: !!enabled, error: "", transcript: "" });
    if (enabled) return this.start();
    await this.rest();
    return { ...this.state };
  }

  cancel() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.clearTimer(this.listenTimer);
    this.clearTimer(this.noInputTimer);
    this.speech.cancelSpeech();
  }

  async stop() {
    this.cancel();
    await this.rest();
    return { ...this.state };
  }

  async beginListening() {
    this.cancel();
    const generation = this.generation;
    this.patch({ phase: "starting", transcript: "", error: "", manualListening: true, conversationActive: true });
    try {
      const info = await this.speech.start();
      if (generation !== this.generation) return { ...this.state };
      if (!info.recognitionAvailable) throw new Error(info.error || "The microphone is unavailable. You can still use Chat.");
      await this.listen(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.recognitionFailed(error.message);
      }
    }
    return { ...this.state };
  }

  async hear(text, confidence = 1) {
    if ((!this.state.enabled && !this.state.conversationActive) || !["wake", "listening", "transcribing"].includes(this.state.phase)) return;
    if (typeof text !== "string" || text.length > 4000) return;
    const wake = extractWake(text);
    if (wake && !wake.command && this.state.conversationActive) return;
    if (wake && confidence >= 0.45) {
      this.patch({ conversationActive: true, error: "" });
      if (wake.command) return this.ask(wake.command);
      this.cancel();
      const generation = this.generation;
      await this.say("Yes? I'm listening.", generation);
      await this.listen(generation);
      return;
    }
    if (["listening", "transcribing"].includes(this.state.phase) && text.trim()) {
      if (confidence < 0.3) {
        this.patch({ notice: "I couldn't hear that clearly. Please try again.", noticeId: this.state.noticeId + 1 });
        return;
      }
      return this.ask(text.trim());
    }
  }

  async say(text, generation) {
    if (generation !== this.generation) return;
    this.patch({ phase: "synthesizing", reply: text, replyId: this.state.replyId + 1 });
    try {
      await this.speech.setMode("paused");
      if (generation !== this.generation) return;
      await this.speech.speak(text);
    } catch (error) {
      if (generation === this.generation) this.patch({ error: `Speech output: ${error.message}` });
    }
  }

  async ask(input) {
    if (typeof input !== "string" || !input.trim()) throw new Error("Please enter a message.");
    if (input.length > 4000) throw new Error("Please keep your message under 4,000 characters.");
    if (["thinking", "synthesizing", "speaking"].includes(this.state.phase)) throw new Error("Deep is busy. Press Stop reply first.");
    const text = input.trim();
    this.cancel();
    const generation = this.generation;
    this.patch({ phase: "thinking", transcript: text, lastUserText: text, error: "" });
    try {
      await this.speech.setMode("paused");
      if (generation !== this.generation) return { ...this.state };
      const command = parseCommand(text);
      let reply;
      if (command.type === "sleep") {
        this.patch({ conversationActive: false, manualListening: false });
        reply = this.state.enabled ? "Okay. Say Hey Deep when you need me." : "Okay. Click Speak when you need me.";
      } else if (command.type === "google") {
        await this.openExternal(googleUrl(command.query));
        reply = command.query ? `Searching Google for ${command.query}.` : "Opening Google.";
      } else if (command.type === "gesture") {
        this.onAction(command.action);
        reply = { wave: "Hello there!", walk: "Let's go for a walk!", stop: "I'll stay here.", hop: "Woohoo!", "next-screen": "Moving to the next screen." }[command.action];
      } else {
        const abort = new AbortController();
        this.abort = abort;
        const timeout = this.setTimer(() => abort.abort(), 90000);
        let data;
        try {
          const response = await this.fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL, stream: false, keep_alive: "10m",
              messages: [{ role: "system", content: SYSTEM_PROMPT }, ...this.history, { role: "user", content: text }],
              options: { temperature: 0.6, num_predict: 180, num_ctx: 4096 },
            }),
            signal: abort.signal,
          });
          if (!response.ok) {
            const details = await response.json().catch(() => ({}));
            throw new Error(details.error || `Ollama returned HTTP ${response.status}.`);
          }
          data = await response.json();
        } finally {
          this.clearTimer(timeout);
        }
        reply = data.message?.content?.trim();
        if (!reply) throw new Error("Ollama returned an empty reply. Please try again.");
        reply = reply.slice(0, 3000);
        if (generation !== this.generation) return { ...this.state };
        this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
        this.history = this.history.slice(-12);
      }
      if (generation !== this.generation) return { ...this.state };
      await this.say(reply, generation);
    } catch (error) {
      if (generation === this.generation) {
        const message = error.name === "AbortError"
          ? "Ollama took too long. Please try again."
          : error.message === "fetch failed"
            ? `Can't reach Ollama at ${OLLAMA_URL}. Start Ollama and check that ${MODEL} is installed.`
            : error.message;
        this.patch({ error: message });
      }
    } finally {
      if (generation === this.generation) {
        if (this.state.conversationActive) await this.listen(generation);
        else await this.rest(generation);
      }
    }
    return { ...this.state };
  }

  async react(text) {
    if (typeof text !== "string" || !text.trim() || text.length > 160 || !["wake", "off", "listening"].includes(this.state.phase)) return;
    this.cancel();
    const generation = this.generation;
    this.patch({ error: "" });
    await this.say(text, generation);
    if (generation === this.generation) {
      if (this.state.conversationActive) await this.listen(generation);
      else await this.rest(generation);
    }
  }

  async holdSoundEffect() {
    this.soundEffectActive = true;
    const sequence = this.soundEffectSequence = (this.soundEffectSequence || 0) + 1;
    this.clearTimer(this.soundEffectTimer);
    this.soundEffectTimer = this.setTimer(() => {
      if (sequence === this.soundEffectSequence) return this.releaseSoundEffect();
    }, 2100);
    this.soundEffectTimer?.unref?.();
    // Replies in flight finish normally. Their rest/listen transitions also
    // respect this hold, so speaker rumble cannot become a new STT request.
    if (!["wake", "listening", "starting", "effect"].includes(this.state.phase)) return;
    this.clearTimer(this.listenTimer);
    this.clearTimer(this.noInputTimer);
    this.patch({ phase: "effect", audioLevel: 0 });
    const generation = this.generation;
    try { await this.speech.setMode("paused"); }
    catch (error) { if (generation === this.generation) this.recognitionFailed(error.message); }
  }

  async releaseSoundEffect() {
    this.clearTimer(this.soundEffectTimer);
    this.soundEffectSequence = (this.soundEffectSequence || 0) + 1;
    this.soundEffectActive = false;
    if (this.state.phase !== "effect") return;
    if (this.state.conversationActive) await this.listen(this.generation);
    else await this.rest(this.generation);
  }

  dispose() {
    this.clearTimer(this.soundEffectTimer);
    this.cancel();
    this.speech.dispose();
  }
}

module.exports = { DeepAssistant, MODEL, OLLAMA_URL, extractWake, parseCommand, googleUrl };
