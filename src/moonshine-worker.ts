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
// Remove the old array of chunks
// let audioBuffer16k: Float32Array[] = []; 
const MIN_SAMPLES_FOR_PROCESSING = 384; // Minimum samples needed (128 × 3 for resampling)
const MAX_RECORDING_SECONDS = 30;
const SAMPLE_RATE_16K = 16000;
const PREALLOCATED_BUFFER_SIZE = SAMPLE_RATE_16K * MAX_RECORDING_SECONDS;

// State for pre-allocated buffer
let preallocated16kBuffer: Float32Array | null = null;
let current16kWriteOffset = 0;

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

// --- Add ComputeType Check ---
try {
  // Check the actual compute type being used AFTER pipeline initialization
  // Access through env seems correct based on documentation/usage
  // @ts-ignore - Accessing internal property, might change
  const currentComputeType = env.backends.webgpu?.computeType;

  if (useGpu && currentComputeType) {
    console.log(`[Moonshine] Actual WebGPU computeType used: ${currentComputeType}`);
    // You could add more specific checks here if you were trying to force a certain type:
    // const requestedComputeType = 'int8'; // Example if you set this via env
    // if (currentComputeType !== requestedComputeType) {
    //    console.warn(`[Moonshine] Requested computeType ${requestedComputeType}, but using ${currentComputeType}`);
    // }
  } else if (!useGpu) {
     console.log("[Moonshine] Using WASM backend, computeType check not applicable.");
  } else if (useGpu && !currentComputeType) {
     console.warn("[Moonshine] Using WebGPU, but could not read actual computeType from env.backends.webgpu");
  }
} catch (checkError) {
    console.warn("[Moonshine] Could not verify actual WebGPU computeType:", checkError);
}
// --- End ComputeType Check ---

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
    console.log("[Worker] Starting stream...");
    // Allocate the large buffer and reset offset
    try {
      preallocated16kBuffer = new Float32Array(PREALLOCATED_BUFFER_SIZE);
      current16kWriteOffset = 0;
      console.log(`[Worker] Pre-allocated 16kHz buffer created (size: ${PREALLOCATED_BUFFER_SIZE} samples).`);
    } catch (allocError) {
      console.error("[Worker] Failed to allocate 16kHz buffer:", allocError);
      self.postMessage({ status: "error", error: "Failed to allocate audio buffer." });
      preallocated16kBuffer = null; // Ensure it's null on failure
      return;
    }
    
    ringBuffer.reset(); // Reset read/write pointers
    self.postMessage({ status: "streaming_started" }); // Inform main thread
    return;
  }

  // --- Stop Streaming & Process (Flush) --- (REPLACES old 'generate')
  if (type === "flush") {
    if (busy) {
      console.warn("[Worker] Flush requested while busy, ignoring.");
      return;
    }
    if (!ringBuffer || !preallocated16kBuffer) {
       console.error("[Worker] Cannot flush: RingBuffer or preallocated buffer not ready.");
       self.postMessage({ status: "error", error: "Cannot flush: Worker not properly initialized." });
       return;
    }

    busy = true;
    self.postMessage({ status: "processing_start" }); // Indicate processing has begun

    // Process all available audio in a tight loop
    console.log("[Worker] Processing final available audio...");
    while (ringBuffer.availableRead() >= MIN_SAMPLES_FOR_PROCESSING) {
      pullAndProcessAudio();
    }

    // --- Use the pre-allocated buffer --- 
    if (current16kWriteOffset === 0) {
      console.log("[Worker] No audio data collected, skipping transcription.");
      self.postMessage({ status: "complete", output: "", timings: { total: 0 } });
      busy = false;
      return;
    }

    // Get the subarray containing the actual audio data
    const finalAudio = preallocated16kBuffer.subarray(0, current16kWriteOffset);
    console.log(`[Worker] Using 16kHz audio subarray. Length: ${finalAudio.length} samples.`);

    // --- ASR Pipeline Call ---
    const t0 = performance.now();
    try {
      if (!asr) throw new Error("ASR pipeline not ready.");

      console.log("[Worker] Calling ASR pipeline...");
      const result = await asr(finalAudio);
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
      // Optional: Clear the buffer for next use? Reset in startStream might be sufficient.
      // current16kWriteOffset = 0;
      // preallocated16kBuffer = null; 
    }
    return; // Handled flush message
  }

  // Log unhandled messages
  console.warn(`[Worker] Unhandled message type: ${type}`);
});

// --- Helper Function for Pull Loop --- (MODIFIED)
function pullAndProcessAudio() {
  if (!ringBuffer || !preallocated16kBuffer) return; // Check preallocated buffer too

  const available48k = ringBuffer.availableRead();
  if (available48k === 0) {
    return;
  }

  // Ensure we read a multiple of 3 for the simple resampler
  const samplesToRead = Math.floor(available48k / 3) * 3;
  if (samplesToRead === 0) {
     return;
  }

  const buffer48k = new Float32Array(samplesToRead);
  ringBuffer.read(buffer48k);

  if (buffer48k.length > 0) {
    try {
      const buffer16k = downsample48kTo16k(buffer48k);
      if (buffer16k.length > 0) {
        // Check if there's enough space in the preallocated buffer
        if (current16kWriteOffset + buffer16k.length <= preallocated16kBuffer.length) {
          preallocated16kBuffer.set(buffer16k, current16kWriteOffset);
          current16kWriteOffset += buffer16k.length;
        } else {
          console.warn("[Worker] Preallocated 16kHz buffer overflow! Discarding chunk.");
          // Optionally, stop processing or handle the overflow
        }
      }
    } catch (error) {
        console.error("[Worker Pull] Error during downsampling:", error);
    }
  }
}