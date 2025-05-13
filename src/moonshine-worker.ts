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

const device = 'wasm'; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

console.log("[Moonshine] using WASM backend");

// ---------------------------------------------------------------------------

let asr: any | null = null;
let busy = false;
let ringBuffer: RingBuffer | null = null;

const SAMPLE_RATE_16K = 16000;

// --- ADD: Streaming Config ---
const CHUNK_S = 5;          // Process 5 seconds of audio at a time
const STRIDE_S = 1;         // Overlap chunks by 1 second
const CHUNK_SAMPLES = CHUNK_S * SAMPLE_RATE_16K;
const STRIDE_SAMPLES = STRIDE_S * SAMPLE_RATE_16K; // Not directly used in pipeline call, but useful for logic if needed
const PULL_LOOP_INTERVAL_MS = 50; // Check for new audio frequently
// --- END: Streaming Config ---

// --- RESTORE Buffer Size Constants ---
const INITIAL_BUFFER_SECONDS = 30; 
const INITIAL_BUFFER_SIZE = SAMPLE_RATE_16K * INITIAL_BUFFER_SECONDS;
const BUFFER_GROWTH_SECONDS = 30; 
const BUFFER_GROWTH_SIZE = SAMPLE_RATE_16K * BUFFER_GROWTH_SECONDS;
// --- END RESTORE ---

// State for pre-allocated buffer
let preallocated16kBuffer: Float32Array | null = null;
let current16kWriteOffset = 0;

// --- ADD: New Streaming State ---
let emittedSamples = 0; // How many samples have been processed and led to emitted text
let kvCache: any | null = null; // Stores past_key_values for the ASR model
let recording = false; // Controls the background pull loop
let processingPartial = false; // Flag to prevent concurrent partial ASR calls (still useful)
// --- END: New Streaming State ---

// --- ADD state for text-based diffing during streaming (as a fallback) ---
let previousSliceText = ""; 
// --- END ADD state ---

// Helper function for the pull loop (MODIFIED)
async function startPullLoop() {
  console.log('[Worker] Starting streaming pull loop...');
  while (recording) {
    if (!ringBuffer) {
      console.error('[Worker] RingBuffer lost during pull loop. Stopping.');
      recording = false;
      break;
    }

    // Pull available audio into the main buffer (resizes if needed)
    pullAndProcessAudio(); 

    // Check if we have enough audio to process a new chunk
    await processAvailableAudio(); // Renamed from maybeEmitPartial

    // Wait briefly before next check
    await new Promise(resolve => setTimeout(resolve, PULL_LOOP_INTERVAL_MS)); 
  }
  console.log('[Worker] Streaming pull loop stopped.');
}

// Helper function to process available audio chunks
async function processAvailableAudio() {
  if (processingPartial || !preallocated16kBuffer || !asr || !recording) return; 

  const availableSamples = current16kWriteOffset - emittedSamples;

  if (availableSamples >= CHUNK_SAMPLES) {
    processingPartial = true;

    const start = Math.max(0, emittedSamples - STRIDE_SAMPLES);
    const end = Math.min(start + CHUNK_SAMPLES + 2 * STRIDE_SAMPLES, current16kWriteOffset);
    const slice = preallocated16kBuffer.subarray(start, end);

    console.log(`[Worker] Processing chunk. Slice range: ${start} -> ${end} (Length: ${slice.length}) Emitted: ${emittedSamples}`);

    try {
      const tAsrStart = performance.now();
      // Call ASR, with per-call streaming options (using 'as any' to bypass linter for these specific keys)
      const result = await asr(slice, { 
         past_key_values: kvCache,
         chunk_length_s: CHUNK_S, 
         stride_length_s: STRIDE_S,
         return_timestamps: "word",
      } as any); // Linter bypass for streaming options not in PretrainedModelOptions
      const tAsrEnd = performance.now();

      // console.log('[Worker] ASR Result (processAvailableAudio):', result); 

      kvCache = result.past_key_values; 

      let delta = "";
      let advancedByChunks = false;

      const chunks = result.chunks ?? [];
      if (chunks.length > 0) {
        const emittedSeconds = emittedSamples / SAMPLE_RATE_16K;
        const freshChunks = chunks.filter((c: any) => c.timestamp && c.timestamp[0] >= emittedSeconds);
        if (freshChunks.length > 0) {
          delta = freshChunks.map((chunk: any) => chunk.text).join('');
          console.log(`[Worker] Delta from CHUNKS: "${delta}"`);
          const lastFreshChunkTimestampEnd = freshChunks[freshChunks.length - 1].timestamp[1];
          emittedSamples = Math.max(emittedSamples, Math.round(lastFreshChunkTimestampEnd * SAMPLE_RATE_16K));
          advancedByChunks = true;
        }
      }
      
      // Fallback to text-based diff if no usable chunks OR if chunks didn't yield delta
      // (but ensure currentText is actually present)
      const currentText = (result.text || "").trim();
      if (!delta && currentText) { 
        if (previousSliceText) {
          if (currentText.startsWith(previousSliceText)) {
            delta = currentText.substring(previousSliceText.length).trim();
          } else {
            let bestOverlap = 0;
            for (let i = 1; i <= Math.min(previousSliceText.length, currentText.length); i++) {
              if (currentText.substring(0, i) === previousSliceText.substring(previousSliceText.length - i)) {
                bestOverlap = i;
              }
            }
            if (bestOverlap > 0 && currentText.length > bestOverlap) {
               delta = currentText.substring(bestOverlap).trim();
            } else if (bestOverlap === 0 || currentText.length <= bestOverlap){
               if(currentText !== previousSliceText) delta = currentText;
            }
            if(delta && delta !== currentText) console.log(`[Worker] Text diverged. Prev: "${previousSliceText}", Curr: "${currentText}", Overlap: ${bestOverlap}, Delta: "${delta}"`);
            else if(delta === currentText) console.log(`[Worker] Text fallback, using full current text as delta: "${delta}"`);
          }
        } else {
          delta = currentText;
        }
      }
      
      if (delta) {
          console.log(`[Worker] ASR completed in ${(tAsrEnd - tAsrStart).toFixed(2)} ms. Final Delta to send: "${delta}"`);
          self.postMessage({ status: 'partial', delta });
          // Advance emittedSamples by CHUNK_SAMPLES if delta came from text diff and not already advanced by chunks
          if (!advancedByChunks) {
            emittedSamples += CHUNK_SAMPLES; 
            console.log(`[Worker] Advanced emittedSamples by CHUNK_SAMPLES (text diff) to ${emittedSamples}`);
          } else {
            console.log(`[Worker] emittedSamples already advanced by chunks to ${emittedSamples}`);
          }
      } else {
          console.log(`[Worker] ASR completed in ${(tAsrEnd - tAsrStart).toFixed(2)} ms. No delta found or emitted.`);
          // Do not advance emittedSamples if no delta was generated, to allow re-processing with more context.
      }
      previousSliceText = currentText; // Always update for next potential text diff

    } catch (err) {
      console.error('[Worker] ASR pipeline error during streaming:', err);
      kvCache = null; 
      previousSliceText = ""; 
    } finally {
      processingPartial = false;
    }
  }
}

self.postMessage({ status: "loading" });

// Initialize the pipeline (NO Stream params at init - Linter bypass for per-call options)
try {
    console.log(`[Moonshine] Initializing pipeline...`);
    asr = await pipeline(
      "automatic-speech-recognition",
      MODEL_ID,
      {
        progress_callback: (p: Progress | null) => p && self.postMessage(p),
        device: device,
        dtype: dtypeConfig,
      }
    ) as any;
    console.log("[Moonshine] Pipeline initialized.");
} catch (pipelineError) {
    console.error("[Moonshine] Pipeline initialization failed:", pipelineError);
    self.postMessage({ status: "error", error: "Worker failed to initialize ASR pipeline." });
    throw pipelineError; 
}

// --- Add ComputeType Check --- 
try {
  console.log("[Moonshine] Using WASM backend, computeType check not applicable.");
} catch (checkError) {
  console.warn("[Moonshine] Error during backend sanity checks (expected for WASM, as no computeType to check):", checkError);
}
// --- End ComputeType Check ---

// Assume ready after pipeline init for now
self.postMessage({ status: "ready" });


// --- Message Handler ---
self.addEventListener("message", async (e) => {
  const { type, data } = e.data ?? {};
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
    // Allocate the buffer and reset state
    try {
      // Allocate buffer using restored constants
      preallocated16kBuffer = new Float32Array(INITIAL_BUFFER_SIZE); 
      current16kWriteOffset = 0;
      console.log(`[Worker] Initial 16kHz buffer created (size: ${INITIAL_BUFFER_SIZE} samples).`);

      // --- Reset Streaming State ---
      emittedSamples = 0;
      kvCache = null; 
      processingPartial = false;
      previousSliceText = ""; // Reset for new stream
      // --- End Reset ---

    } catch (allocError) {
      console.error("[Worker] Failed to allocate initial 16kHz buffer:", allocError);
      self.postMessage({ status: "error", error: "Failed to allocate audio buffer." });
      preallocated16kBuffer = null;
      return;
    }
    
    ringBuffer?.reset(); // Ensure ring buffer is also reset
    self.postMessage({ status: "streaming_started" }); 
    
    // Start the background pull loop
    recording = true;
    startPullLoop(); // Don't await, let it run in the background
    return;
  }

  // --- Stop Streaming & Process (Flush) --- (MODIFIED as per GPT feedback)
  if (type === "flush") {
    if (!recording && !busy) { // Use 'busy' flag from original code? Let's reuse 'processingPartial' for now.
        console.warn('[Worker] Flush requested but not recording or already flushed.');
        return;
    }
    
    console.log('[Worker] Flush requested. Stopping pull loop...');
    const wasRecording = recording; // Store original state
    recording = false; // Signal the pull loop to stop
    
    // Wait briefly for any ongoing partial processing to finish
    while (processingPartial) {
        console.log('[Worker] Waiting for ongoing partial processing to finish before final flush...');
        await new Promise(resolve => setTimeout(resolve, 50)); // Check frequently
    }
    
    console.log('[Worker] Proceeding with final flush...');

    if (!ringBuffer || !preallocated16kBuffer) {
       console.error("[Worker] Cannot flush: RingBuffer or preallocated buffer not ready.");
       self.postMessage({ status: "error", error: "Cannot flush: Worker not properly initialized." });
       return;
    }

    // Prevent further processing during flush
    processingPartial = true; 
    self.postMessage({ status: "processing_start" }); 

    // --- Pull final audio ---
    if (wasRecording) { // Only pull if we were actually recording
        console.log("[Worker] Pulling final audio chunk from RingBuffer...");
        pullAndProcessAudio(); 
        console.log(`[Worker] Final pull complete. Current 16k offset: ${current16kWriteOffset}`);
    }
    // --- End Final Pull ---

    // --- Process remaining audio using mini-slice and cache ---
    // Calculate the slice for the remaining audio
    const finalAvailable = current16kWriteOffset - emittedSamples;
    let finalDelta = "";
    let finalPipelineTime = 0;

    if (finalAvailable > 0) {
        const start = Math.max(0, emittedSamples - STRIDE_SAMPLES); 
        const end = current16kWriteOffset; 
        const finalSlice = preallocated16kBuffer.subarray(start, end);

        console.log(`[Worker] Processing final audio segment. Slice range: ${start} -> ${end} (Length: ${finalSlice.length}) Emitted: ${emittedSamples}`);
        const tFinalStart = performance.now();
        try {
            if (!asr) throw new Error("ASR pipeline not ready.");

            console.log("[Worker] Calling ASR pipeline for final segment (with cache and PER-CALL stream params)...");
            const result = await asr(finalSlice, {
                 past_key_values: kvCache,
                 chunk_length_s: CHUNK_S, 
                 stride_length_s: STRIDE_S, // Consider stride_length_s: 0 for final flush for less aggressive overlap removal?
                 return_timestamps: "word",
            } as any); // Linter bypass 
            finalPipelineTime = performance.now() - tFinalStart;
            console.log(`[Worker] Final ASR pipeline completed in ${finalPipelineTime.toFixed(2)} ms.`);
            // console.log("[Worker] Final Result Object:", result);

            let advancedByChunksFlush = false;
            const finalChunks = result.chunks ?? [];
            if (finalChunks.length > 0) {
                const finalEmittedSeconds = emittedSamples / SAMPLE_RATE_16K;
                const finalFreshChunks = finalChunks.filter((c: any) => c.timestamp && c.timestamp[0] >= finalEmittedSeconds);
                if (finalFreshChunks.length > 0) {
                    finalDelta = finalFreshChunks.map((chunk: any) => chunk.text).join('');
                    console.log(`[Worker] Final Delta from CHUNKS: "${finalDelta}"`);
                    // No need to advance emittedSamples here as it's the final flush
                    advancedByChunksFlush = true; 
                }
            }
            
            const finalCurrentText = (result.text || "").trim();
            if (!finalDelta && finalCurrentText) { // Fallback to text-based diff if no usable chunks
                if (previousSliceText && finalCurrentText.startsWith(previousSliceText)) {
                    finalDelta = finalCurrentText.substring(previousSliceText.length).trim();
                } else if (previousSliceText) {
                    let bestOverlap = 0;
                    for (let i = 1; i <= Math.min(previousSliceText.length, finalCurrentText.length); i++) {
                        if (finalCurrentText.substring(0, i) === previousSliceText.substring(previousSliceText.length - i)) {
                            bestOverlap = i;
                        }
                    }
                    if (bestOverlap > 0 && finalCurrentText.length > bestOverlap) {
                        finalDelta = finalCurrentText.substring(bestOverlap).trim();
                    } else if (bestOverlap === 0 || finalCurrentText.length <= bestOverlap){
                         if(finalCurrentText !== previousSliceText) finalDelta = finalCurrentText; 
                    }
                    if(finalDelta && finalDelta !== finalCurrentText) console.log(`[Worker] Final text diverged. Prev: "${previousSliceText}", Curr: "${finalCurrentText}", Delta: "${finalDelta}"`);
                    else if (finalDelta === finalCurrentText)  console.log(`[Worker] Final text fallback, using full current text as delta: "${finalDelta}"`);
                } else {
                    finalDelta = finalCurrentText;
                }
            }

            if (finalDelta) {
                console.log(`[Worker] Final Delta Text to be sent: "${finalDelta}"`);
            } else {
                 console.log(`[Worker] No final delta text found to send.`);
            }

        } catch (err) {
            console.error(`[Worker] Final ASR Error after ${finalPipelineTime.toFixed(2)}ms:`, String(err));
            self.postMessage({ status: "error", error: String(err) });
            emittedSamples = 0; kvCache = null; processingPartial = false; previousSliceText = ""; // Reset state
            return; 
        }
    } else {
       console.log("[Worker] No remaining audio data to process in final flush.");
    }
    
    console.log(`[Worker] Sending final complete message with delta: "${finalDelta}"`);
    self.postMessage({ 
        status: 'complete', 
        text: finalDelta, 
        timings: { total: finalPipelineTime } 
    });
    
    emittedSamples = 0;
    current16kWriteOffset = 0; 
    kvCache = null; 
    preallocated16kBuffer = null; 
    processingPartial = false; 

    return; 
  }

});

// --- Helper Function for Pull Loop --- (MODIFIED for dynamic resizing)
function pullAndProcessAudio() { 
    if (!ringBuffer || !preallocated16kBuffer) return; 

    const available16k = ringBuffer.availableRead();
    if (available16k === 0) return; // Nothing to read
  
    const samplesToRead = available16k; 
    
    const requiredSize = current16kWriteOffset + samplesToRead;
    if (requiredSize > preallocated16kBuffer.length) {
      const newSize = Math.max(requiredSize, preallocated16kBuffer.length + BUFFER_GROWTH_SIZE); 
      console.warn(`[Worker Pull] Resizing 16kHz buffer from ${preallocated16kBuffer.length} to ${newSize} samples.`);
      try {
        const newBuffer = new Float32Array(newSize);
        newBuffer.set(preallocated16kBuffer.subarray(0, current16kWriteOffset), 0); 
        preallocated16kBuffer = newBuffer; 
      } catch (resizeError) {
        console.error("[Worker Pull] Failed to resize 16kHz buffer:", resizeError);
        self.postMessage({ status: "error", error: "Failed to resize audio buffer during recording." });
        ringBuffer.read(new Float32Array(available16k)); 
        return; 
      }
    }
  
    const targetView = preallocated16kBuffer.subarray(
      current16kWriteOffset, 
      current16kWriteOffset + samplesToRead
    );
  
    ringBuffer.read(targetView); 
  
    current16kWriteOffset += samplesToRead;
}