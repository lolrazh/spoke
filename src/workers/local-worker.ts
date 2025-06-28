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
} from "../types/worker-messages";
import { AutoModel, Tensor } from "@huggingface/transformers";

// 🔼 ADD — Silero VAD config
const VAD_MODEL_ID = "onnx-community/silero-vad";
const VAD_FRAME_S = 0.128; // WAS 0.2 -> 0.032 seconds (512 / 16 000)
const MIN_SILENCE_S = 0.6; // ≥ 600 ms = pause
const SPEECH_TH = 0.6; // prob > 0.6 ⇒ speech
const EXIT_TH = 0.25; // when inside speech

// ─── slice-age gate ────────────────────────────────────────
const MIN_SLICE_S = 4; // don't even *look* for silence
const MIN_SLICE_SAMPLES = MIN_SLICE_S * TARGET_SAMPLE_RATE;

// 🔼 ADD — globals used by VAD
let vad: (x: {
  input: Tensor;
  sr: Tensor;
  state: Tensor;
}) => Promise<{ stateN: Tensor; output: Tensor }> | null = null;

const srTensor = new Tensor("int64", [TARGET_SAMPLE_RATE], []);
let vadState = new Tensor("float32", new Float32Array(2 * 1 * 128), [
  2,
  1,
  128,
]);
let wasSpeech = false;
let silenceSince = 0; // #samples accumulated since last speech frame

console.log("[LocalWorker] Imports completed successfully");

// Configure transformers.js environment
env.allowLocalModels = false;
env.useBrowserCache = true;
console.log("[LocalWorker] Transformers environment configured");

// Define WASM backend configuration type
interface WasmBackendConfig {
  simd?: boolean;
  numThreads?: number;
  proxy?: boolean;
  [key: string]: unknown;
}

// Enable WASM SIMD and Threading
const wasmConfig = (env.backends as Record<string, unknown>)["wasm"] as
  | WasmBackendConfig
  | undefined;
if (wasmConfig) {
  console.log(
    "[LocalWorker] Configuring WASM backend for SIMD and Threading...",
  );
  wasmConfig.simd = true;
  wasmConfig.numThreads = navigator.hardwareConcurrency || 4;
  wasmConfig.proxy = true; // Required for multi-threading in a worker
  console.log(
    `[LocalWorker] WASM backend configured: SIMD=${wasmConfig.simd}, Threads=${wasmConfig.numThreads}, Proxy=${wasmConfig.proxy}`,
  );
} else {
  console.warn(
    "[LocalWorker] WASM backend not available in env.backends. Skipping SIMD/Threading configuration.",
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
    encoder_model: "fp32", // from moonshine-worker
    decoder_model_merged: "fp32", // from moonshine-worker
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
}

async function transcribeSlice(slice: Float32Array) {
  if (!asr || slice.length === 0) return;
  if (processingPartial) return;
  processingPartial = true;
  try {
    const { text = "" } = await (asr as any)(slice);
    diffAndSend(
      lastPartialText + (lastPartialText && text ? " " : "") + text,
      "partial",
    );
  } catch (err) {
    console.error("[LocalWorker] VAD slice ASR error:", err);
  }
  processingPartial = false;
}

function vadDetect(frame: Float32Array): Promise<boolean> {
  if (!vad) return Promise.resolve(true); // fail-open: treat as speech
  const input = new Tensor("float32", frame, [1, frame.length]);

  return limitVad(() =>
    vad!({ input, sr: srTensor, state: vadState }).then(({ stateN, output }) => {
      vadState = stateN;
      const probability = output.data[0] as number;
      return probability;
    }),
  );
}

const limitVad = (() => {
  // simple serialized queue
  let chain: Promise<any> = Promise.resolve(false);
  return (fn: () => Promise<number>) =>
    (chain = chain.then(() => fn())).then((p) => {
      const isSpeech = p > SPEECH_TH || (wasSpeech && p >= EXIT_TH);
      return isSpeech;
    });
})();

// Main loop for pulling and processing audio during streaming
async function startPullLoop() {
  console.log("[LocalWorker] Starting streaming pull loop with VAD...");
  const FRAME_SAMPLES = 512; // 16 kHz * 0.032 s
  const SILENCE_SAMPLES = MIN_SILENCE_S * TARGET_SAMPLE_RATE;

  while (recording) {
    pullAndProcessAudio(); // still fills preallocated16kBuffer

    // 🔼 NEW: iterate over new audio since last check
    while (nextDecodeStart16k + FRAME_SAMPLES <= current16kWriteOffset) {
      if (!preallocated16kBuffer) break; // Safeguard to exit inner loop if buffer is gone
      const frame = preallocated16kBuffer.subarray(
        nextDecodeStart16k,
        nextDecodeStart16k + FRAME_SAMPLES,
      );

      let isSpeech: boolean;
      try {
        isSpeech = await vadDetect(frame);
      } catch (err) {
        console.error("[LocalWorker] VAD detection failed, assuming speech.", err);
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

self.addEventListener("message", async (e) => {
  const { type, data } = e.data ?? {};

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
    if (asr) {
      console.log("[LocalWorker] ASR pipeline already initialized.");
      const readyMessage: ModelReadyMessage = { status: "asr_model_ready" };
      self.postMessage(readyMessage);
      return;
    }
    if (modelInitializationInProgress) {
      console.warn("[LocalWorker] Already busy initializing ASR pipeline.");
      return;
    }
    modelInitializationInProgress = true;
    const loadingMessage: ModelLoadingMessage = { status: "asr_model_loading" };
    self.postMessage(loadingMessage);
    console.log(
      `[LocalWorker] Received 'initialize-local-asr'. Initializing pipeline with model: ${MODEL_ID}`,
    );
    try {
      // Using type assertion for pipeline options as transformers.js has flexible types
      asr = await pipeline("automatic-speech-recognition", MODEL_ID, {
        progress_callback: (p: unknown) =>
          p &&
          self.postMessage({
            ...(p as Record<string, unknown>),
            status: "model_progress",
          }),
        device: device,
        dtype: dtypeConfig,
      });

      vad = (await AutoModel.from_pretrained(VAD_MODEL_ID, {
        config: { model_type: "custom" } as any,
        dtype: "fp32", // tiny model; fp32 is fine
      })) as typeof vad;
      console.log("[LocalWorker] Silero VAD loaded.");

      console.log(
        "[LocalWorker] ASR Streaming Pipeline initialized successfully.",
      );
      self.postMessage({ status: "asr_model_ready" });
    } catch (pipelineError) {
      console.error(
        "[LocalWorker] ASR Pipeline initialization failed:",
        pipelineError,
      );
      self.postMessage({
        status: "error",
        error: "Worker failed to initialize ASR pipeline.",
      });
      asr = null;
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
    vadState = new Tensor("float32", new Float32Array(2 * 1 * 128), [
      2,
      1,
      128,
    ]);

    ringBuffer.reset();
    self.postMessage({ status: "capture_started" }); // Signal that capture/streaming has begun

    recording = true;
    startPullLoop(); // Don't await, let it run in the background
    return;
  }

  if (type === "stop-capture-and-transcribe") {
    const tDictationEnd = performance.now();
    // Now acts as "flush"
    if (!recording && !processingPartial && preallocated16kBuffer === null) {
      console.warn(
        "[LocalWorker] Flush requested but not recording, not processing, and no buffer. Likely already flushed or never started.",
      );
      self.postMessage({
        status: "completed",
        transcription: lastPartialText || "",
      }); // Send last known text
      return;
    }

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
        console.error("[LocalWorker] Buffer became null unexpectedly before flushing tail.");
      } else {
        const tail = preallocated16kBuffer.subarray(
          sliceStart16k,
          current16kWriteOffset,
        );
        await transcribeSlice(tail);
      }
    }

    const tPaste = performance.now();
    const dictationToPasteMs = tPaste - tDictationEnd;
    console.log(
      `[LocalWorker] Sending final 'completed' message. Transcription: "${lastPartialText}"`,
    );

    self.postMessage({
      status: "completed",
      transcription: lastPartialText,
      timings: { dictation_to_paste_ms: dictationToPasteMs },
    });

    // Reset state for next recording
    current16kWriteOffset = 0;
    nextDecodeStart16k = 0;
    lastPartialText = "";
    sliceStart16k = 0;
    wasSpeech = false;
    silenceSince = 0;
    vadState = new Tensor("float32", new Float32Array(2 * 1 * 128), [
      2,
      1,
      128,
    ]);
    if (preallocated16kBuffer) {
      preallocated16kBuffer.fill(0);
      preallocated16kBuffer = null;
    }
    // `recording` is already false
    // `processingPartial` should be false here
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

self.onerror = (event) => {
  console.error("[LocalWorker] Unhandled error in worker:", event);
  self.postMessage({
    status: "error",
    error: "An unexpected error occurred in the worker.",
  });
};

self.onunhandledrejection = (event) => {
  console.error("[LocalWorker] Unhandled promise rejection in worker:", event);
  self.postMessage({
    status: "error",
    error: "An unexpected promise rejection occurred in the worker.",
  });
};

console.log(
  "[LocalWorker] Streaming-capable event listener added. Worker script loaded.",
);
