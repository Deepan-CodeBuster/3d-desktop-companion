const { parentPort, workerData } = require("node:worker_threads");
const { WaveFile } = require("wavefile");
const os = require("node:os");

async function main() {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = workerData.cacheDir;
  // Leave CPU capacity for Ollama, animation and the rest of the desktop.
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, os.availableParallelism()));
  const transcriber = await pipeline("automatic-speech-recognition", workerData.model, {
    device: "cpu", dtype: "q8",
    session_options: { intraOpNumThreads: Math.max(1, Math.min(4, os.availableParallelism())), interOpNumThreads: 1 },
    progress_callback: (event) => {
      if (["initiate", "progress", "done"].includes(event.status)) {
        parentPort.postMessage({ type: "progress", file: event.file, progress: event.progress, status: event.status });
      }
    },
  });
  // ONNX sessions are used sequentially, including after a cancelled request.
  let queue = Promise.resolve();
  parentPort.on("message", (event) => {
    if (event.type !== "transcribe") return;
    queue = queue.then(async () => {
      try {
        const wav = new WaveFile(Buffer.from(event.wav, "base64"));
        wav.toBitDepth("32f");
        wav.toSampleRate(16000);
        let samples = wav.getSamples();
        if (Array.isArray(samples)) {
          const mono = new Float32Array(samples[0].length);
          for (const channel of samples) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / samples.length;
          samples = mono;
        }
        if (samples.length < 1600 || samples.length > 16000 * 60) throw new Error("Please speak for between a moment and one minute at a time.");
        const result = await transcriber(samples, { chunk_length_s: 25, stride_length_s: 3, max_new_tokens: 160 });
        parentPort.postMessage({ type: "result", id: event.id, text: result.text?.trim().slice(0, 4000) || "" });
      } catch (error) {
        parentPort.postMessage({ type: "result", id: event.id, error: error.message });
      }
    });
  });
  parentPort.postMessage({ type: "ready" });
}

main().catch((error) => parentPort.postMessage({ type: "error", error: `Whisper: ${error.message}` }));
