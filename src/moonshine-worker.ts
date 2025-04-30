// src/moonshine-worker.ts
import { 
    pipeline, 
    env, 
    // @ts-ignore Progress type might be nested or different now
    Progress 
} from "@huggingface/transformers";

// Import RingBuffer and Resampler
import { RingBuffer } from "./audio/ring-buffer.js";
import { downsample48kTo16k } from "./audio/resampler.js";

const MODEL_ID = "onnx-community/moonshine-base-ONNX";   // English-only                          // a bit roomier

// Define type for Dtype configuration
type DtypeConfig = Record<string, "auto" | "fp32" | "fp16" | "q8" | "q4" | "int8">; // Adjust allowed types if needed

// Define dtype configurations based on device with explicit typing
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  webgpu: {
    encoder_model: "fp32", // Example values, adjust if needed based on testing/performance
    decoder_model_merged: "q4",
  },
  wasm: {
    encoder_model: "fp32",
    decoder_model_merged: "q8", // WASM might benefit from q8
  },
};

// --- back-end selection exactly like before ---------------------------------
async function webgpuAvailable() {
  // @ts-ignore
  return !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null;
}

const useGpu = await webgpuAvailable();
const device = useGpu ? 'webgpu' : 'wasm';
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

if (useGpu) {
    console.log("[Moonshine] using WebGPU backend");
    // Additional WebGPU specific settings if needed (e.g., powerPreference)
    // @ts-ignore
    // env.backends.webgpu.powerPreference = "high-performance"; // Can potentially be set here if needed
} else {
    console.log("[Moonshine] using WASM backend");
    // @ts-ignore
    // env.backends.wasm.numThreads = navigator.hardwareConcurrency ?? 4; // This might need to be passed differently or handled by the library
}

// ---------------------------------------------------------------------------

let asr: any | null = null;
let busy = false;
let ringBuffer: RingBuffer | null = null;
let audioBuffer16k: Float32Array[] = []; // Temporary storage for downsampled chunks
let pullIntervalId: number | null = null; // Use number type for browser setInterval/clearInterval
const PULL_INTERVAL_MS = 250; // How often to pull from RingBuffer

self.postMessage({ status: "loading" });

asr = await pipeline(
  "automatic-speech-recognition",
  MODEL_ID,
  {
    progress_callback: (p: Progress | null) => p && self.postMessage(p),
    // Pass device and dtype config directly
    device: device,
    dtype: dtypeConfig,
  }
) as any;

// --- Warm-up Call --- 
try {
    if (asr) {
      console.log("[Moonshine] Performing warm-up call...");
      const warmupStartTime = performance.now();
      // Perform a dummy transcription on 1 second of silence
      await asr(new Float32Array(16_000)); 
      const warmupEndTime = performance.now();
      console.log(`[Moonshine] Warm-up call completed in ${(warmupEndTime - warmupStartTime).toFixed(2)} ms`);
      // Send ready message ONLY if warm-up succeeds
      self.postMessage({ status: "ready" });
    } else {
      throw new Error("ASR pipeline object is null after initialization.");
    }
} catch (warmupError) {
    console.error("[Moonshine] Warm-up call failed:", warmupError);
    // Send an error status back to the main thread
    self.postMessage({ status: "error", error: "Worker warm-up failed." });
    // Do not proceed further if warm-up fails
}

// --- Message Handler ---
self.addEventListener("message", async (e) => {
  const { type, data } = e.data ?? {}; // Use provided data directly if available
  console.log(`[Worker] Received message: type=${type}`, data); // Log received messages

  // --- Initialization --- (NEW)
  if (type === "init") {
    if (data?.sab) {
      try {
        ringBuffer = new RingBuffer(data.sab);
        console.log("[Worker] RingBuffer initialized with received SharedArrayBuffer.");
        // Send confirmation back or just log
        // self.postMessage({ status: "worker_initialized" });
      } catch (error) {
        console.error("[Worker] Failed to initialize RingBuffer:", error);
        self.postMessage({ status: "error", error: "Worker failed to initialize RingBuffer." });
      }
    } else {
      console.error("[Worker] 'init' message received without SharedArrayBuffer (sab).");
      self.postMessage({ status: "error", error: "Worker initialization failed: No SAB provided." });
    }
    return; // Handled init message
  }

  // --- Start Streaming --- (NEW)
  if (type === "startStream") {
    if (!ringBuffer) {
       console.error("[Worker] Cannot start stream: RingBuffer not initialized.");
       self.postMessage({ status: "error", error: "Cannot start: RingBuffer not ready." });
       return;
    }
    if (pullIntervalId) {
        console.warn("[Worker] Stream already started.");
        return;
    }
    console.log(`[Worker] Starting pull loop (interval: ${PULL_INTERVAL_MS}ms)...`);
    audioBuffer16k = []; // Clear any previous audio
    ringBuffer.reset(); // Reset read/write pointers
    // Use self.setInterval for Worker scope
    pullIntervalId = self.setInterval(pullAndProcessAudio, PULL_INTERVAL_MS);
    self.postMessage({ status: "streaming_started" }); // Inform main thread
    return;
  }

  // --- Stop Streaming & Process (Flush) --- (REPLACES old 'generate')
  if (type === "flush") {
    if (busy) {
      console.warn("[Worker] Flush requested while busy, ignoring.");
      return;
    }
    if (pullIntervalId !== null) {
      // Use self.clearInterval for Worker scope
      self.clearInterval(pullIntervalId);
      pullIntervalId = null;
      console.log("[Worker] Pull loop stopped.");
    }
    if (!ringBuffer) {
       console.error("[Worker] Cannot flush: RingBuffer not initialized.");
       self.postMessage({ status: "error", error: "Cannot flush: RingBuffer not ready." });
       return;
    }

    busy = true;
    self.postMessage({ status: "processing_start" }); // Indicate processing has begun

    // Process any remaining audio in the buffer *immediately* before ASR call
    console.log("[Worker] Processing final audio chunk before ASR...");
    pullAndProcessAudio(); // Run one last time

    // --- Concatenate and Transcribe ---
    if (audioBuffer16k.length === 0) {
      console.log("[Worker] No audio data collected, skipping transcription.");
      self.postMessage({ status: "complete", output: "", timings: { total: 0 } });
      busy = false;
      return;
    }

    // Calculate total length
    const totalLength = audioBuffer16k.reduce((sum, buf) => sum + buf.length, 0);
    const finalAudio16k = new Float32Array(totalLength);

    // Concatenate buffers
    let offset = 0;
    for (const buffer of audioBuffer16k) {
      finalAudio16k.set(buffer, offset);
      offset += buffer.length;
    }
    console.log(`[Worker] Final 16kHz audio buffer created. Length: ${finalAudio16k.length} samples.`);
    audioBuffer16k = []; // Clear the temporary buffer

    // --- ASR Pipeline Call ---
    const t0 = performance.now();
    try {
      if (!asr) throw new Error("ASR pipeline not ready.");

      console.log("[Worker] Calling ASR pipeline...");
      const result = await asr(finalAudio16k);
      const pipelineTime = performance.now() - t0;
      console.log(`[Worker] ASR pipeline completed in ${pipelineTime.toFixed(2)} ms.`);

      const text = (result as any).text;
      self.postMessage({
        status: "complete",
        output: text?.trim() ?? '',
        timings: { total: pipelineTime },
      });
    } catch (err) {
      const pipelineTimeOnError = performance.now() - t0;
      console.error(`[Worker] ASR Error after ${pipelineTimeOnError.toFixed(2)}ms:`, err);
      self.postMessage({ status: "error", error: String(err) });
    } finally {
      busy = false;
    }
    return; // Handled flush message
  }

  // Log unhandled messages
  console.warn(`[Worker] Unhandled message type: ${type}`);
});

// --- Helper Function for Pull Loop --- (NEW)
function pullAndProcessAudio() {
  if (!ringBuffer) return;

  const available48k = ringBuffer.availableRead();
  if (available48k === 0) {
    // console.log("[Worker Pull] No new 48k samples.");
    return;
  }

  // Ensure we read a multiple of 3 for the simple resampler
  const samplesToRead = Math.floor(available48k / 3) * 3;
  if (samplesToRead === 0) {
     // console.log(`[Worker Pull] Not enough samples for downsampling (${available48k})`);
     return;
  }

  const buffer48k = new Float32Array(samplesToRead);
  ringBuffer.read(buffer48k); // Read into the new buffer

  if (buffer48k.length > 0) {
    // console.log(`[Worker Pull] Read ${buffer48k.length} samples @48k.`);
    try {
      const buffer16k = downsample48kTo16k(buffer48k);
      if (buffer16k.length > 0) {
        // console.log(`[Worker Pull] Downsampled to ${buffer16k.length} samples @16k.`);
        audioBuffer16k.push(buffer16k);
      }
    } catch (error) {
        console.error("[Worker Pull] Error during downsampling:", error);
        // Decide how to handle error - skip chunk? stop stream?
    }
  }
}