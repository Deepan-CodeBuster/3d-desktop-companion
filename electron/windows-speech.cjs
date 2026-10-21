const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

class WindowsSpeech extends EventEmitter {
  constructor({ spawnImpl = spawn } = {}) {
    super();
    this.spawn = spawnImpl;
    this.mode = "paused";
    this.sequence = 0;
    this.pendingModes = new Map();
    this.activeToken = null;
  }

  start() {
    if (this.info?.recognitionAvailable) return Promise.resolve(this.info);
    if (this.info) this.close(new Error("Retrying the microphone."));
    if (this.starting) return this.starting;
    const starting = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.starting = starting;
    try {
      const source = readFileSync(path.join(__dirname, "speech-worker.cs"), "utf8");
      // Only bundled code is passed to PowerShell. User text travels over JSON.
      const program = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@ -ReferencedAssemblies System.Speech,System.Web.Extensions,System.Core; [DeepSpeechWorker]::Run()`;
      const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const child = this.spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", program], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      child.stdin.on("error", (error) => {
        if (this.child === child) this.failed(error.message);
      });
      let stderr = "";
      this.startTimer = setTimeout(() => {
        if (this.child === child) this.failed("Windows speech took too long to start. You can still type messages.");
      }, 25000);
      child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-2000); });
      this.lines = readline.createInterface({ input: child.stdout });
      this.lines.on("line", (line) => {
        if (this.child !== child) return;
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "ready") {
          clearTimeout(this.startTimer);
          this.info = event;
          this.resolveStart?.(event);
          this.resolveStart = this.rejectStart = null;
        } else if (event.type === "mode-set") {
          const pending = this.pendingModes.get(event.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pendingModes.delete(event.id);
          if (event.error) {
            pending.reject(new Error(event.error));
            this.failed(event.error);
          } else {
            if (event.id === this.sequence) {
              this.mode = pending.mode;
              this.activeToken = pending.mode === "paused" ? null : event.id;
            }
            pending.resolve();
          }
        } else if (["recognized", "partial", "rejected", "audio", "level", "signal"].includes(event.type)) {
          // A delayed result from a cancelled turn must never become a command.
          if (this.activeToken !== null && event.token === this.activeToken) this.emit(event.type, event);
        } else if (event.type === "error") {
          this.failed(event.error);
        }
      });
      child.on("error", (error) => {
        if (this.child === child) this.failed(error.message);
      });
      child.on("exit", () => {
        if (this.child === child) this.failed(stderr.trim() || "The Windows speech process stopped. Click Speak to retry.");
      });
    } catch (error) {
      this.failed(error.message);
    }
    return starting;
  }

  async setMode(mode) {
    if (!["paused", "wake", "command"].includes(mode)) throw new Error("Invalid microphone mode.");
    this.activeToken = null;
    if (!this.info && mode === "paused") return;
    const info = this.info || await this.start();
    if (!info.recognitionAvailable) {
      if (mode === "paused") return;
      throw new Error(info.error || "Windows speech recognition is unavailable.");
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failed("The microphone did not respond. Click Speak to retry."), 7000);
      this.pendingModes.set(id, { resolve, reject, timer, mode });
      if (!this.child?.stdin.writable) {
        this.failed("The microphone connection closed. Click Speak to retry.");
        return;
      }
      this.child.stdin.write(JSON.stringify({ type: "mode", mode, id }) + "\n");
    });
  }

  close(error) {
    clearTimeout(this.startTimer);
    this.rejectStart?.(error);
    this.resolveStart = this.rejectStart = null;
    for (const pending of this.pendingModes.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingModes.clear();
    this.activeToken = null;
    const child = this.child;
    this.child = null;
    this.info = null;
    this.starting = null;
    this.mode = "paused";
    child?.kill();
    this.lines?.close();
    this.lines = null;
  }

  failed(message) {
    this.close(new Error(message));
    this.emit("fault", message);
  }

  dispose() { this.close(new Error("Speech recognition stopped.")); }
}

module.exports = { WindowsSpeech };
