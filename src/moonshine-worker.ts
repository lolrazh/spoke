// src/moonshine-worker.ts
import { 
    pipeline, 
    env, 
    // @ts-ignore Progress type might be nested or different now
    Progress 
} from "@huggingface/transformers";

// Import RingBuffer
import { RingBuffer } from "./audio/ring-buffer.js";

const MODEL_ID = "onnx-community/moonshine-base-ONNX";   // English-only                          // a bit roomier

// Define type for Dtype configuration
type DtypeConfig = Record<string, "auto" | "fp32" | "fp16" | "q8" | "q4" | "int8">; // Adjust allowed types if needed

// Define dtype configurations based on device with explicit typing
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  wasm: {
    encoder_model: "q8",
    decoder_model_merged: "q8", // WASM might benefit from q8
  },
};

// --- back-end selection exactly like before ---------------------------------
// async function webgpuAvailable() {
//   // @ts-ignore
//   return !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null;
// }

// const useGpu = await webgpuAvailable();
// const device = useGpu ? 'webgpu' : 'wasm';
const device = 'wasm'; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

// if (useGpu) {
//     console.log("[Moonshine] using WebGPU backend");
//     // Additional WebGPU specific settings if needed (e.g., powerPreference)
//     // @ts-ignore
//     // env.backends.webgpu.powerPreference = "high-performance"; // Can potentially be set here if needed
// } else {
console.log("[Moonshine] using WASM backend");
// @ts-ignore
// env.backends.wasm.numThreads = navigator.hardwareConcurrency ?? 4; // This might need to be passed differently or handled by the library
// }

// ---------------------------------------------------------------------------

let asr: any | null = null;
let busy = false;
let ringBuffer: RingBuffer | null = null;
// Remove the old array of chunks
// let audioBuffer16k: Float32Array[] = []; 
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
let lastPartialText = ""; // NEW: Store the cumulative text sent so far

// NEW Helper function to diff text and post delta
function diffAndSend(textNow: string, tag: 'partial') {
  textNow = textNow.trim(); // Ensure consistent trimming
  let i = 0;
  // Find longest common prefix length
  while (i < textNow.length && i < lastPartialText.length && textNow[i] === lastPartialText[i]) {
    i++;
  }

  // Handle potential leading/trailing space inconsistencies during diff
  let prefixBoundary = i;
  // Adjust boundary if it lands mid-word or next to spaces inconsistently
  if (i > 0 && i < textNow.length) {
    const prevCharText = textNow[i - 1];
    const nextCharText = textNow[i];
    const prevCharLast = i > 0 ? lastPartialText[i - 1] : null;

    // If boundary is at a space in one but not the other, adjust slightly if possible
    if (nextCharText === ' ' && prevCharLast && prevCharLast !== ' ') {
       // Don't include the leading space in delta if the last text didn't end with one
       prefixBoundary = i + 1; 
    } else if (prevCharText === ' ' && prevCharLast && prevCharLast !== ' ') {
        // If new text has a space before boundary, maybe keep it? (Less common)
        // Let's prioritize trimming delta's start
    }
  }
  
  // Extract the delta (new part) and trim leading whitespace aggressively
  const delta = textNow.slice(prefixBoundary).trimStart(); 
  
  console.log(`[Worker Diff] Prev: "${lastPartialText}" | Now: "${textNow}" | LCP: ${i} | Adj Boundary: ${prefixBoundary} | Delta: "${delta}"`);

  if (delta) {
    self.postMessage({ status: tag, delta });
    lastPartialText = textNow; // Update history for next partial
  }
}

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

// Helper function to check and emit partial results (MODIFIED)
async function maybeEmitPartial() {
  if (processingPartial || !preallocated16kBuffer || !asr) return; 

  const buffered16kSamples = current16kWriteOffset - nextDecodeStart16k;
  const bufferedSeconds = buffered16kSamples / SAMPLE_RATE_16K;

  if (bufferedSeconds >= PARTIAL_INTERVAL_S) {
    console.log(`[Worker] Buffer has >= ${PARTIAL_INTERVAL_S}s (${bufferedSeconds.toFixed(2)}s) of new audio. Processing partial...`);
    processingPartial = true;
    
    const sliceToProcess = preallocated16kBuffer.subarray(nextDecodeStart16k, current16kWriteOffset);
    const sliceEndIndex = current16kWriteOffset; // Store end index

    try {
      console.log(`[Worker] Calling ASR pipeline for partial result (samples: ${sliceToProcess.length})...`);
      const tPartialStart = performance.now();
      const result = await asr(sliceToProcess);
      const tPartialEnd = performance.now();
      const currentFullText = (result as any).text?.trim() ?? ''; // Get the full text for this slice
      console.log(`[Worker] Partial ASR completed in ${(tPartialEnd - tPartialStart).toFixed(2)} ms. Full Text: "${currentFullText}"`);

      // Use diffAndSend for partial delta only
      diffAndSend(lastPartialText + ' ' + currentFullText, 'partial');
      
      // IMPORTANT: Move the start cursor *after* successful processing
      nextDecodeStart16k = sliceEndIndex; 

    } catch (err) {
      console.error('[Worker] Partial decode error:', err);
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
  // const currentComputeType = env.backends.webgpu?.computeType;

  // if (useGpu && currentComputeType) {
  //   console.log(`[Moonshine] Actual WebGPU computeType used: ${currentComputeType}`);
  //   // You could add more specific checks here if you were trying to force a certain type:
  //   // const requestedComputeType = 'int8'; // Example if you set this via env
  //   // if (currentComputeType !== requestedComputeType) {
  //   //    console.warn(`[Moonshine] Requested computeType ${requestedComputeType}, but using ${currentComputeType}`);
  //   // }
  // } else if (!useGpu) {
  console.log("[Moonshine] Using WASM backend, computeType check not applicable.");
  // } else if (useGpu && !currentComputeType) {
  //    console.warn("[Moonshine] Using WebGPU, but could not read actual computeType from env.backends.webgpu");
  // }
} catch (checkError) {
  console.warn("[Moonshine] Error during backend sanity checks (expected for WASM, as no computeType to check):", checkError);
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
      lastPartialText = ""; // Reset history on new stream
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
    while (processingPartial) {
        console.log('[Worker] Waiting for ongoing partial processing to finish before final flush...');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('[Worker] Proceeding with final flush...');
    if (busy) { 
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

    // --- ADDED: Single call to pull remaining audio ---
    console.log("[Worker] Pulling final audio chunk from RingBuffer...");
    pullAndProcessAudio(); 
    console.log(`[Worker] Final pull complete. Current 16k offset: ${current16kWriteOffset}`);
    // --- End Single Pull ---

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

    // --- Final ASR Pipeline Call (MODIFIED) ---
    const t0 = performance.now();
    try {
      if (!asr) throw new Error("ASR pipeline not ready.");

      console.log("[Worker] Calling ASR pipeline for final segment...");
      const result = await asr(finalAudioSlice);
      const pipelineTime = performance.now() - t0;
      console.log(`[Worker] Final ASR pipeline completed in ${pipelineTime.toFixed(2)} ms.`);

      const finalFullText = (result as any).text?.trim() ?? '';
      
      // Combine with previous history for the absolute final text
      const absoluteFinalText = (lastPartialText + ' ' + finalFullText).trim();
      
      // Send the *full* text in the complete message
      console.log(`[Worker] Sending final complete message with full text: "${absoluteFinalText}"`);
      self.postMessage({ 
          status: 'complete', 
          text: absoluteFinalText, // Use 'text' property for final full transcript
          timings: { total: pipelineTime }
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
      lastPartialText = ""; // Ensure reset here too
    }
    return; // Handled flush message
  }

  // Log unhandled messages
  console.warn(`[Worker] Unhandled message type: ${type}`);
});

// --- Helper Function for Pull Loop --- (MODIFIED)
// This function now handles pulling 16k data directly into the preallocated buffer
function pullAndProcessAudio() {
  if (!ringBuffer || !preallocated16kBuffer) return; 

  const available16k = ringBuffer.availableRead();
  if (available16k === 0) return; // Nothing to read

  // Determine how much space is left in the preallocated buffer
  const spaceAvailableInBuffer = preallocated16kBuffer.length - current16kWriteOffset;
  
  if (spaceAvailableInBuffer <= 0) {
      console.warn("[Worker Pull] Preallocated 16kHz buffer full! Cannot read more from ring buffer.");
      // We could potentially drop data from ringBuffer here if needed to prevent it filling up
      // ringBuffer.read(null, available16k); // Read and discard
      return;
  }

  // Read directly into the preallocated buffer at the current offset
  // Determine the number of samples to read (minimum of available or space left)
  const samplesToRead = Math.min(available16k, spaceAvailableInBuffer);
  
  // Create a subarray view of the target location in the preallocated buffer
  const targetView = preallocated16kBuffer.subarray(
    current16kWriteOffset, 
    current16kWriteOffset + samplesToRead
  );

  // Perform the read from the ring buffer directly into the target view
  ringBuffer.read(targetView); 

  // Update the write offset
  current16kWriteOffset += samplesToRead;

  // Optional: Log how much was read
  // console.log(`[Worker Pull] Read ${samplesToRead} 16kHz samples. New 16kHz write offset: ${current16kWriteOffset}`);
}