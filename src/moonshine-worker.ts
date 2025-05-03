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

// NEW State for continuous processing
const PARTIAL_INTERVAL_S = 10; // Emit partial result every 10 seconds
const PULL_LOOP_INTERVAL_MS = 250; // How often to pull from ring buffer
let nextDecodeStart16k = 0; // Start index for the next ASR slice in preallocated16kBuffer
let recording = false; // Controls the background pull loop
let processingPartial = false; // Flag to prevent concurrent partial ASR calls

// Helper function for the pull loop (must be defined before use)
async function startPullLoop() {
  console.log('[Worker] Starting pull loop...');
  while (recording) {
    if (!ringBuffer) {
      console.error('[Worker] RingBuffer lost during pull loop. Stopping.');
      recording = false;
      break;
    }

    // Pull and process available 48kHz audio into the 16kHz buffer
    pullAndProcessAudio(); 

    // Check if we should run a partial transcription
    await maybeEmitPartial();

    // Wait a bit before the next pull to avoid busy-waiting
    // Use a simple timeout for broader compatibility vs Atomics.waitAsync initially
    await new Promise(resolve => setTimeout(resolve, PULL_LOOP_INTERVAL_MS)); 
  }
  console.log('[Worker] Pull loop stopped.');
}

// Helper function to check and emit partial results
async function maybeEmitPartial() {
  if (processingPartial || !preallocated16kBuffer || !asr) return; // Don't overlap calls or run if not ready

  const buffered16kSamples = current16kWriteOffset - nextDecodeStart16k;
  const bufferedSeconds = buffered16kSamples / SAMPLE_RATE_16K;

  if (bufferedSeconds >= PARTIAL_INTERVAL_S) {
    console.log(`[Worker] Buffer has >= ${PARTIAL_INTERVAL_S}s (${bufferedSeconds.toFixed(2)}s) of new audio. Processing partial...`);
    processingPartial = true;
    
    // Get the slice of *new* audio data since the last partial/start
    const sliceToProcess = preallocated16kBuffer.subarray(nextDecodeStart16k, current16kWriteOffset);
    const sliceStartIndex = nextDecodeStart16k; // Store start index before ASR call
    const sliceEndIndex = current16kWriteOffset; // Store end index before ASR call

    try {
      console.log(`[Worker] Calling ASR pipeline for partial result (samples: ${sliceToProcess.length})...`);
      const tPartialStart = performance.now();
      const result = await asr(sliceToProcess);
      const tPartialEnd = performance.now();
      const partialText = (result as any).text?.trim() ?? '';
      console.log(`[Worker] Partial ASR completed in ${(tPartialEnd - tPartialStart).toFixed(2)} ms. Text: "${partialText}"`);

      if (partialText) {
        self.postMessage({
          status: 'partial',
          delta: partialText
        });
      }
      // IMPORTANT: Move the start cursor for the next slice *after* successful processing
      nextDecodeStart16k = sliceEndIndex;

    } catch (err) {
      console.error('[Worker] Partial decode error:', err);
      // Decide how to handle error - retry? skip? For now, just log and allow next attempt.
    } finally {
      processingPartial = false;
    }
  }
}

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
  const { type, data } = e.data ?? {};
  console.log(`[Worker] Received message: type=${type}`, data);

  // --- Initialization ---
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
    return; 
  }

  // --- Start Streaming ---
  if (type === "startStream") {
    if (!ringBuffer) {
       console.error("[Worker] Cannot start stream: RingBuffer not initialized.");
       self.postMessage({ status: "error", error: "Cannot start: RingBuffer not ready." });
       return;
    }
    if (recording) {
        console.warn("[Worker] Stream already started.");
        return;
    }
    
    console.log("[Worker] Starting stream...");
    // Allocate the large buffer and reset state
    try {
      preallocated16kBuffer = new Float32Array(PREALLOCATED_BUFFER_SIZE);
      current16kWriteOffset = 0;
      nextDecodeStart16k = 0; // Reset decode cursor
      processingPartial = false; // Reset partial processing flag
      console.log(`[Worker] Pre-allocated 16kHz buffer created (size: ${PREALLOCATED_BUFFER_SIZE} samples).`);
    } catch (allocError) {
      console.error("[Worker] Failed to allocate 16kHz buffer:", allocError);
      self.postMessage({ status: "error", error: "Failed to allocate audio buffer." });
      preallocated16kBuffer = null;
      return;
    }
    
    ringBuffer.reset(); 
    self.postMessage({ status: "streaming_started" }); 
    
    // Start the background pull loop
    recording = true;
    startPullLoop(); // Don't await, let it run in the background
    return;
  }

  // --- Stop Streaming & Process (Flush) --- 
  if (type === "flush") {
    if (!recording && !busy) {
        console.warn('[Worker] Flush requested but not recording or already flushed.');
        return;
    }
    
    console.log('[Worker] Flush requested. Stopping pull loop...');
    recording = false; // Signal the pull loop to stop
    
    // Wait briefly for any ongoing partial processing to finish
    // A more robust solution might use a promise or lock
    while (processingPartial) {
        console.log('[Worker] Waiting for ongoing partial processing to finish before final flush...');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('[Worker] Proceeding with final flush...');
    if (busy) { // Check busy flag again after wait
      console.warn("[Worker] Flush requested while busy (after wait), ignoring.");
      return;
    }
    if (!ringBuffer || !preallocated16kBuffer) {
       console.error("[Worker] Cannot flush: RingBuffer or preallocated buffer not ready.");
       self.postMessage({ status: "error", error: "Cannot flush: Worker not properly initialized." });
       return;
    }

    busy = true;
    self.postMessage({ status: "processing_start" }); 

    // Perform one last pull to get any remaining audio
    console.log("[Worker] Processing final available audio before final ASR...");
    pullAndProcessAudio();

    // --- Use the final remaining portion of the pre-allocated buffer ---
    const finalSliceStartIndex = nextDecodeStart16k;
    const finalSliceEndIndex = current16kWriteOffset;
    const finalAudioSlice = preallocated16kBuffer.subarray(finalSliceStartIndex, finalSliceEndIndex);

    if (finalAudioSlice.length === 0) {
      console.log("[Worker] No new audio data since last partial, skipping final transcription.");
      self.postMessage({ status: "complete", output: "" }); // Send empty complete
      busy = false;
      nextDecodeStart16k = 0; // Reset for next recording
      current16kWriteOffset = 0;
      // preallocated16kBuffer = null; // Maybe clear buffer?
      return;
    }
    
    console.log(`[Worker] Using final 16kHz audio subarray. Length: ${finalAudioSlice.length} samples.`);

    // --- Final ASR Pipeline Call ---
    const t0 = performance.now();
    try {
      if (!asr) throw new Error("ASR pipeline not ready.");

      console.log("[Worker] Calling ASR pipeline for final segment...");
      const result = await asr(finalAudioSlice);
      const pipelineTime = performance.now() - t0;
      console.log(`[Worker] Final ASR pipeline completed in ${pipelineTime.toFixed(2)} ms.`);

      const finalTextDelta = (result as any).text?.trim() ?? '';
      // Send the final delta as 'complete' message
      self.postMessage({
        status: "complete",
        output: finalTextDelta, // Send only the last part
        timings: { total: pipelineTime },
      });
    } catch (err) {
      const pipelineTimeOnError = performance.now() - t0;
      console.error(`[Worker] Final ASR Error after ${pipelineTimeOnError.toFixed(2)}ms:`, err);
      self.postMessage({ status: "error", error: String(err) });
    } finally {
      busy = false;
      // Reset state for the next recording session
      nextDecodeStart16k = 0;
      current16kWriteOffset = 0;
      // preallocated16kBuffer = null; // Maybe clear buffer?
    }
    return; // Handled flush message
  }

  // Log unhandled messages
  console.warn(`[Worker] Unhandled message type: ${type}`);
});

// --- Helper Function for Pull Loop --- (MODIFIED)
// This function now just handles pulling 48k -> downsampling -> adding to 16k buffer
function pullAndProcessAudio() {
  if (!ringBuffer || !preallocated16kBuffer) return; 

  const available48k = ringBuffer.availableRead();
  // Read in chunks that are multiples of 3 for the resampler
  const processChunkSize = 480 * 3; // Process roughly 10ms chunks (480 samples @ 48k)
  let processedSamples = 0;

  while (processedSamples < available48k) {
      const remainingAvailable = available48k - processedSamples;
      const samplesToRead = Math.min(processChunkSize, Math.floor(remainingAvailable / 3) * 3);
      
      if (samplesToRead === 0) break; // Not enough left for a multiple of 3

      const buffer48k = new Float32Array(samplesToRead);
      // Read directly into the buffer. Assumes availableRead() is correct.
      ringBuffer.read(buffer48k); 
      
      processedSamples += samplesToRead; // Assume we read what we asked for

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
                      // Stop pulling more data if buffer is full to prevent continuous warnings
                      break; 
                  }
              }
          } catch (error) {
              console.error("[Worker Pull] Error during downsampling:", error);
          }
      }
  }
  // If we processed anything, log the new write offset
  // if (processedSamples > 0) {
  //   console.log(`[Worker Pull] Processed ${processedSamples} 48kHz samples. New 16kHz write offset: ${current16kWriteOffset}`);
  // }
}