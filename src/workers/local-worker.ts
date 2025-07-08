console.log("[LocalWorker] Worker file starting to load...");

import { pipeline, env } from "@huggingface/transformers";
import { RingBuffer } from "../audio/ring-buffer";
import {
  TARGET_SAMPLE_RATE,
  INITIAL_BUFFER_SIZE,
  BUFFER_GROWTH_SIZE,
} from "../config/audio";
import type {
  ModelLoadingMessage,
  ModelReadyMessage,
  PartialTranscriptionMessage,
  VadWorkerMessage,
  VadWorkerResponse,
} from "../types/worker-messages";

// VAD configuration
const MIN_SILENCE_S = 0.6;

// ─── slice-age gate ────────────────────────────────────────
const MIN_SLICE_S = 4; // don't even *look* for silence
const MIN_SLICE_SAMPLES = MIN_SLICE_S * TARGET_SAMPLE_RATE;

// VAD worker and state management
let vadWorker: Worker | null = null;
let vadInitialized = false;
let wasSpeech = false;
let silenceSince = 0; // #samples accumulated since last speech frame
let nextFrameId = 0;
const pendingVadResults = new Map<
  number,
  { resolve: (isSpeech: boolean) => void; reject: (error: Error) => void }
>();

console.log("[LocalWorker] Imports completed successfully");

// Configure transformers.js environment
env.allowLocalModels = false;
env.useBrowserCache = true;
console.log("[LocalWorker] Transformers environment configured");

// Define WASM backend configuration type
interface WasmBackendConfig {
  simd?: boolean;
  fastMath?: boolean;
  numThreads?: number;
  initTimeout?: number;
  proxy?: boolean;
  [key: string]: unknown;
}

// Enable WASM SIMD and Threading with performance optimizations
const wasmConfig = (env.backends as Record<string, unknown>)["wasm"] as
  | WasmBackendConfig
  | undefined;
if (wasmConfig) {
  console.log(
    "[LocalWorker] Configuring WASM backend for maximum performance...",
  );
  wasmConfig.simd = true; // enables 128-bit lanes
  wasmConfig.fastMath = true; // lets ORT fuse operations like GELU≈tanh, ~1.1x speedup
  wasmConfig.numThreads = Math.min(12, navigator.hardwareConcurrency || 4); // Conv kernels scale ≈√N; 12 threads is sweet spot for modern CPUs
  wasmConfig.initTimeout = 0; // disables 30s watchdog that forces single-thread on slow init
  wasmConfig.proxy = false; // Required for multi-threading in a worker
  console.log(
    `[LocalWorker] WASM backend configured for steroids: SIMD=${wasmConfig.simd}, FastMath=${wasmConfig.fastMath}, Threads=${wasmConfig.numThreads}, InitTimeout=${wasmConfig.initTimeout}, Proxy=${wasmConfig.proxy}`,
  );
} else {
  console.warn(
    "[LocalWorker] WASM backend not available in env.backends. Skipping performance optimizations.",
  );
}

// Updated MODEL_ID for streaming
const MODEL_ID = "onnx-community/moonshine-base-ONNX";

// Define type for Dtype configuration
type DtypeConfig = Record<
  string,
  "auto" | "fp32" | "fp16" | "q8" | "q4f16" | "int8"
>; // q4f16 from local, q4 from moonshine. Sticking with local options.

// Define dtype configurations based on device with explicit typing (Updated from moonshine-worker)
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  wasm: {
    encoder_model: "q8", // from moonshine-worker
    decoder_model_merged: "q8", // from moonshine-worker
  },
};

const device = "wasm"; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

console.log("[LocalWorker] using WASM backend with streaming capability.");

// Use unknown type instead of any, we'll cast when needed
let asr: unknown = null;
let modelInitializationInProgress = false; // Replaces part of 'busy' for clarity
let ringBuffer: RingBuffer | null = null;

const PULL_LOOP_INTERVAL_MS = 100; // Check for new audio frequently (Changed from 50 to 100)

let preallocated16kBuffer: Float32Array | null = null;
let current16kWriteOffset = 0;
let recording = false; // Controls the background pull loop
let processingPartial = false; // Flag to prevent concurrent partial ASR calls

let nextDecodeStart16k = 0; // Start index for the next ASR slice in preallocated16kBuffer
let lastPartialText = ""; // Store the cumulative text sent so far (for diffing)
let sliceStart16k = 0; // beginning of the *current* slice

// --- TIMING ---
const timings = {
  total_asr_inference_ms: 0,
  total_vad_processing_ms: 0,
  total_audio_pull_ms: 0,
  model_load_ms: 0,
  vad_init_ms: 0,
  final_flush_ms: 0,
};
const mark = (name: keyof typeof timings, duration: number) => {
  timings[name] += duration;
};
// --- TIMING END ---

function diffAndSend(textNow: string, tag: "partial") {
  textNow = textNow.trim(); // Ensure consistent trimming
  let i = 0;
  // Find longest common prefix length
  while (
    i < textNow.length &&
    i < lastPartialText.length &&
    textNow[i] === lastPartialText[i]
  ) {
    i++;
  }

  let prefixBoundary = i;
  if (i > 0 && i < textNow.length) {
    // Removed unused variable prevCharText
    const nextCharText = textNow[i];
    const prevCharLast = i > 0 ? lastPartialText[i - 1] : null;

    if (nextCharText === " " && prevCharLast && prevCharLast !== " ") {
      prefixBoundary = i + 1;
    }
  }

  const delta = textNow.slice(prefixBoundary).trimStart();

  if (delta) {
    const message: PartialTranscriptionMessage = { status: tag, delta };
    self.postMessage(message);
    lastPartialText = textNow; // Update history for next partial
  }
}

// Pulls audio from RingBuffer into preallocated16kBuffer and resizes if necessary
function pullAndProcessAudio() {
  const t0 = performance.now();
  if (!ringBuffer || !preallocated16kBuffer) {
    console.warn(
      "[LocalWorker Pull] RingBuffer or preallocated16kBuffer not ready.",
    );
    return;
  }

  const availableInRing = ringBuffer.availableRead();
  if (availableInRing === 0) return;

  const samplesToRead = availableInRing;

  const requiredSize = current16kWriteOffset + samplesToRead;
  if (requiredSize > preallocated16kBuffer.length) {
    const newSize = Math.max(
      requiredSize,
      preallocated16kBuffer.length + BUFFER_GROWTH_SIZE,
    );
    console.warn(
      `[LocalWorker Pull] Resizing 16kHz buffer from ${preallocated16kBuffer.length} to ${newSize} samples.`,
    );
    try {
      const newBuffer = new Float32Array(newSize);
      newBuffer.set(
        preallocated16kBuffer.subarray(0, current16kWriteOffset),
        0,
      );
      preallocated16kBuffer = newBuffer;
    } catch (resizeError) {
      console.error(
        "[LocalWorker Pull] Failed to resize 16kHz buffer:",
        resizeError,
      );
      self.postMessage({
        status: "error",
        error: "Failed to resize audio buffer during recording.",
      });
      // Try to clear the ring buffer to prevent it from blocking
      const tempDrain = new Float32Array(samplesToRead);
      ringBuffer.read(tempDrain);
      return;
    }
  }

  // Read directly into the preallocated buffer.
  // Assumes RingBuffer contains 16kHz audio as AudioContext is set to 16kHz.
  const targetView = preallocated16kBuffer.subarray(
    current16kWriteOffset,
    current16kWriteOffset + samplesToRead,
  );

  // ringBuffer.read expects a buffer to fill and returns null if successful.
  ringBuffer.read(targetView);
  current16kWriteOffset += samplesToRead;
  mark("total_audio_pull_ms", performance.now() - t0);
}

// Initialize VAD worker
async function initializeVadWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      vadWorker = new Worker(new URL("./vad-worker.ts", import.meta.url), {
        type: "module",
        name: "vad-worker",
      });

      vadWorker.onmessage = (event) => {
        const message: VadWorkerResponse = event.data;

        switch (message.type) {
          case "vad_initialized": {
            if (message.success) {
              vadInitialized = true;
              console.log("[LocalWorker] VAD worker initialized successfully");
              resolve();
            } else {
              console.error(
                "[LocalWorker] VAD worker initialization failed:",
                message.error,
              );
              reject(
                new Error(message.error || "VAD worker initialization failed"),
              );
            }
            break;
          }

          case "vad_result": {
            const pending = pendingVadResults.get(message.frameId);
            if (pending) {
              pendingVadResults.delete(message.frameId);
              pending.resolve(message.isSpeech);
            }
            break;
          }

          case "vad_error": {
            console.error("[LocalWorker] VAD worker error:", message.error);
            if (message.frameId !== undefined) {
              const pending = pendingVadResults.get(message.frameId);
              if (pending) {
                pendingVadResults.delete(message.frameId);
                pending.reject(new Error(message.error));
              }
            }
            break;
          }
        }
      };

      vadWorker.onerror = (error) => {
        console.error("[LocalWorker] VAD worker error:", error);
        reject(error);
      };

      // Send initialization message
      const initMessage: VadWorkerMessage = { type: "vad_init" };
      vadWorker.postMessage(initMessage);
    } catch (error) {
      console.error("[LocalWorker] Failed to create VAD worker:", error);
      reject(error);
    }
  });
}

async function transcribeSlice(slice: Float32Array) {
  if (!asr || slice.length === 0) return;
  if (processingPartial) return;
  processingPartial = true;

  // Profiling start
  const tAsrStart = performance.now();

  try {
    const { text = "" } = await (asr as any)(slice);
    mark("total_asr_inference_ms", performance.now() - tAsrStart);

    // Log profiling info
    // console.log(`[LocalWorker] Slice transcription timings:`);
    // console.table({
    //   asr_inference: asrDuration,
    //   total_slice_duration: totalSliceDuration,
    //   slice_length_samples: slice.length,
    //   slice_length_seconds: (slice.length / TARGET_SAMPLE_RATE).toFixed(3),
    // });

    diffAndSend(
      lastPartialText + (lastPartialText && text ? " " : "") + text,
      "partial",
    );
  } catch (err) {
    console.error("[LocalWorker] VAD slice ASR error:", err);
  }
  processingPartial = false;
}

// VAD detection using dedicated worker
function vadDetect(frame: Float32Array): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!vadWorker || !vadInitialized) {
      console.warn("[LocalWorker] VAD not ready, assuming speech.");
      resolve(true); // Fail-open
      return;
    }
    const tVadStart = performance.now();
    const frameId = nextFrameId++;
    pendingVadResults.set(frameId, {
      resolve: (isSpeech) => {
        mark("total_vad_processing_ms", performance.now() - tVadStart);
        resolve(isSpeech);
      },
      reject: (err) => {
        mark("total_vad_processing_ms", performance.now() - tVadStart);
        reject(err);
      },
    });

    const message: VadWorkerMessage = { type: "vad_frame", frame, frameId };
    vadWorker.postMessage(message);
  });
}

// Main loop for pulling and processing audio during streaming
async function startPullLoop() {
  console.log("[LocalWorker] Starting streaming pull loop with VAD...");
  const FRAME_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * 0.03125); // 16 kHz * 0.03125 s = 500 samples (Silero VAD chunk size)
  const SILENCE_SAMPLES = Math.floor(MIN_SILENCE_S * TARGET_SAMPLE_RATE);

  while (recording) {
    pullAndProcessAudio(); // still fills preallocated16kBuffer

    // 🔼 NEW: iterate over new audio since last check
    while (nextDecodeStart16k + FRAME_SAMPLES <= current16kWriteOffset) {
      if (!preallocated16kBuffer || !recording) break; // Safeguard to exit inner loop if buffer is gone or recording stopped

      // Ensure we don't exceed buffer bounds
      const endIdx = Math.min(
        nextDecodeStart16k + FRAME_SAMPLES,
        current16kWriteOffset,
      );
      if (endIdx <= nextDecodeStart16k) break;

      const frame = preallocated16kBuffer.subarray(nextDecodeStart16k, endIdx);

      let isSpeech: boolean;
      try {
        isSpeech = await vadDetect(frame);
      } catch (err) {
        console.error(
          "[LocalWorker] VAD detection failed, assuming speech.",
          err,
        );
        isSpeech = true; // Fail-open: assume it's speech to avoid dropping audio
      }

      if (isSpeech) {
        wasSpeech = true;
        silenceSince = 0;
      } else {
        if (wasSpeech) silenceSince += FRAME_SAMPLES;

        const sliceSamples = nextDecodeStart16k - sliceStart16k;
        const oldEnough = sliceSamples >= MIN_SLICE_SAMPLES;
        const longSilence = silenceSince >= SILENCE_SAMPLES;

        // NEW rule: only cut when     (slice ≥ 6 s)  AND  (600 ms silence)
        if (oldEnough && longSilence) {
          if (!preallocated16kBuffer) break; // Safeguard
          const slice = preallocated16kBuffer.subarray(
            sliceStart16k,
            nextDecodeStart16k,
          );
          transcribeSlice(slice);
          sliceStart16k = nextDecodeStart16k;
          wasSpeech = false;
          silenceSince = 0;
        }
      }
      nextDecodeStart16k += FRAME_SAMPLES; // slide window
    }

    await new Promise((r) => setTimeout(r, PULL_LOOP_INTERVAL_MS));
  }
  console.log("[LocalWorker] Streaming pull loop stopped.");
}

// Main message handler for the worker
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  if (type === "init") {
    if (data?.sab) {
      try {
        ringBuffer = new RingBuffer(data.sab);
        console.log(
          "[LocalWorker] RingBuffer initialized with SharedArrayBuffer.",
        );
        self.postMessage({ status: "sab_initialized" });
      } catch (error) {
        console.error("[LocalWorker] Failed to initialize RingBuffer:", error);
        self.postMessage({
          status: "error",
          error: "Worker failed to initialize RingBuffer.",
        });
      }
    } else {
      console.error(
        "[LocalWorker] 'init' message received without SharedArrayBuffer (sab).",
      );
      self.postMessage({
        status: "error",
        error: "Worker initialization failed: No SAB provided for RingBuffer.",
      });
    }
    return;
  }

  if (type === "initialize-local-asr") {
    if (modelInitializationInProgress || asr) {
      console.log(
        "[LocalWorker] ASR initialization already in progress or completed.",
      );
      return;
    }
    console.log("[LocalWorker] Starting ASR model initialization...");
    modelInitializationInProgress = true;
    self.postMessage({ status: "asr_model_loading" });

    const t0 = performance.now();
    try {
      [asr] = await Promise.all([
        pipeline("automatic-speech-recognition", MODEL_ID, {
          dtype: dtypeConfig,
          device,
          progress_callback: (progress: any) => {
            self.postMessage({
              status: "model_progress",
              progress: progress,
            });
          },
        }),
        (async () => {
          const tVadInitStart = performance.now();
          await initializeVadWorker();
          mark("vad_init_ms", performance.now() - tVadInitStart);
        })(),
      ]);
      mark("model_load_ms", performance.now() - t0 - timings.vad_init_ms);

      self.postMessage({ status: "asr_model_ready" });
      console.log("[LocalWorker] ASR model ready.");
    } catch (err) {
      console.error("[LocalWorker] ASR initialization error:", err);
      self.postMessage({
        status: "error",
        error: `ASR initialization failed: ${(err as Error).message}`,
      });
    } finally {
      modelInitializationInProgress = false;
    }
    return;
  }

  if (type === "start-capture") {
    // Now initiates streaming
    if (!asr) {
      self.postMessage({
        status: "error",
        error: "ASR model not ready. Please initialize first.",
      });
      return;
    }
    if (!ringBuffer) {
      self.postMessage({
        status: "error",
        error: "RingBuffer not initialized. Send 'init' with SAB first.",
      });
      return;
    }
    if (recording) {
      console.warn("[LocalWorker] Stream already started.");
      return;
    }
    console.log("[LocalWorker] Starting audio capture for streaming...");

    try {
      preallocated16kBuffer = new Float32Array(INITIAL_BUFFER_SIZE);
      current16kWriteOffset = 0;
      console.log(
        `[LocalWorker] Initial 16kHz buffer created (size: ${INITIAL_BUFFER_SIZE} samples).`,
      );
    } catch (allocError) {
      console.error(
        "[LocalWorker] Failed to allocate initial 16kHz buffer:",
        allocError,
      );
      self.postMessage({
        status: "error",
        error: "Failed to allocate audio buffer.",
      });
      preallocated16kBuffer = null;
      return;
    }

    processingPartial = false;
    nextDecodeStart16k = 0; // Reset for sequential buffer
    lastPartialText = ""; // Reset for sequential buffer
    sliceStart16k = 0;
    wasSpeech = false;
    silenceSince = 0;

    ringBuffer.reset();
    self.postMessage({ status: "capture_started" }); // Signal that capture/streaming has begun

    recording = true;
    startPullLoop(); // Don't await, let it run in the background
    return;
  }

  if (type === "stop-capture-and-transcribe") {
    const tDictationEnd = performance.now();
    // Note: 'timestamp' from UI is wall-clock time, not monotonic performance.now()
    // For simplicity, we start our own timer here.
    const tFlushStart = performance.now();

    // To be safe, capture if recording was active when stop was called
    const wasRecording = recording;
    console.log(
      "[LocalWorker] Flush requested. Stopping pull loop and processing remaining audio.",
    );
    recording = false; // Signal the pull loop to stop

    // Wait briefly for any ongoing partial processing from the loop to finish
    // This loop ensures that `processAvailableAudio` completes its current execution if it was mid-way.
    let waitCount = 0;
    const maxWaitIterations = 100; // Max 5 seconds (100 * 50ms)
    while (processingPartial && waitCount < maxWaitIterations) {
      console.log(
        "[LocalWorker] Waiting for ongoing partial processing before final flush...",
      );
      await new Promise((resolve) =>
        setTimeout(resolve, PULL_LOOP_INTERVAL_MS),
      );
      waitCount++;
    }
    if (processingPartial) {
      console.warn(
        "[LocalWorker] Timeout waiting for partial processing. Proceeding with flush anyway.",
      );
      processingPartial = false; // Force it if stuck
    }

    self.postMessage({ status: "processing_full_audio" }); // Indicate final processing

    if (!asr) {
      self.postMessage({
        status: "error",
        error: "ASR model not ready for flush.",
      });
      if (preallocated16kBuffer) preallocated16kBuffer = null; // Clean up buffer
      return;
    }
    if (!preallocated16kBuffer) {
      console.warn(
        "[LocalWorker] No preallocated buffer to flush (might have been an error or empty recording).",
      );
      self.postMessage({
        status: "completed",
        transcription: lastPartialText || "",
      });
      return;
    }

    // Perform one final pull from the RingBuffer if it was recording
    if (wasRecording && ringBuffer) {
      console.log(
        "[LocalWorker] Pulling final audio chunk from RingBuffer for flush...",
      );
      pullAndProcessAudio();
      console.log(
        `[LocalWorker] Final pull complete. Current 16k offset: ${current16kWriteOffset}`,
      );
    }

    if (current16kWriteOffset > sliceStart16k) {
      if (!preallocated16kBuffer) {
        console.error(
          "[LocalWorker] Buffer became null unexpectedly before flushing tail.",
        );
      } else {
        const tail = preallocated16kBuffer.subarray(
          sliceStart16k,
          current16kWriteOffset,
        );
        await transcribeSlice(tail);
      }
    }

    // `processingPartial` should be false here
    // `busy` is replaced by more specific flags
    mark("final_flush_ms", performance.now() - tFlushStart);

    console.log(
      `[LocalWorker] Sending final 'completed' message. Transcription: "${lastPartialText}"`,
    );

    self.postMessage({
      status: "completed",
      transcription: lastPartialText,
      timings: timings,
    });

    // Reset state for next recording
    cleanup();
    return;
  }

  // Fallback for unknown messages (though all relevant types should be handled above)
  if (
    type !== "init" &&
    type !== "initialize-local-asr" &&
    type !== "start-capture" &&
    type !== "stop-capture-and-transcribe"
  ) {
    console.warn(`[LocalWorker] Received unknown message type: ${type}`);
  }
});

// Cleanup function
function cleanup() {
  // Stop recording first to prevent new VAD requests
  recording = false;

  // Clear any pending VAD requests with rejection to prevent memory leaks
  for (const [frameId, { reject }] of pendingVadResults.entries()) {
    reject(new Error("Worker cleanup in progress"));
  }
  pendingVadResults.clear();
  nextFrameId = 0;

  // Terminate VAD worker
  if (vadWorker) {
    vadWorker.terminate();
    vadWorker = null;
    vadInitialized = false;
  }
}

self.onerror = (event) => {
  console.error("[LocalWorker] Unhandled error in worker:", event);
  cleanup();
  self.postMessage({
    status: "error",
    error: "An unexpected error occurred in the worker.",
  });
};

self.onunhandledrejection = (event) => {
  console.error("[LocalWorker] Unhandled promise rejection in worker:", event);
  cleanup();
  self.postMessage({
    status: "error",
    error: "An unexpected promise rejection occurred in the worker.",
  });
};

console.log(
  "[LocalWorker] Streaming-capable event listener added. Worker script loaded.",
);
