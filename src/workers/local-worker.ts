console.log("[LocalWorker] Worker file starting to load...");

import {
    pipeline,
    env,
    // @ts-ignore Progress type might be nested or different now
    Progress
} from "@huggingface/transformers";
import { RingBuffer } from "../audio/ring-buffer.js"; // Changed .ts to .js

console.log("[LocalWorker] Imports completed successfully");

// Configure transformers.js environment
env.allowLocalModels = false;
env.useBrowserCache = true;
console.log("[LocalWorker] Transformers environment configured");

// Updated MODEL_ID for streaming
const MODEL_ID = "onnx-community/moonshine-base-ONNX";

// Define type for Dtype configuration
type DtypeConfig = Record<string, "auto" | "fp32" | "fp16" | "q8" | "q4f16" | "int8">; // q4f16 from local, q4 from moonshine. Sticking with local options.

// Define dtype configurations based on device with explicit typing (Updated from moonshine-worker)
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  wasm: {
    encoder_model: "fp32", // from moonshine-worker
    decoder_model_merged: "fp32", // from moonshine-worker
  },
};

const device = 'wasm'; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

console.log("[LocalWorker] using WASM backend with streaming capability.");

let asr: any | null = null;
let modelInitializationInProgress = false; // Replaces part of 'busy' for clarity
let ringBuffer: RingBuffer | null = null;

const TARGET_SAMPLE_RATE = 16000; // Already 16k

// --- REMOVED Streaming Config ---
// const CHUNK_S = 4;
// const STRIDE_S = 2;
// const CHUNK_SAMPLES = CHUNK_S * TARGET_SAMPLE_RATE;
// const STRIDE_SAMPLES = STRIDE_S * TARGET_SAMPLE_RATE;
const PULL_LOOP_INTERVAL_MS = 100; // Check for new audio frequently (Changed from 50 to 100)

// --- Buffer Size Constants (from moonshine-worker.ts) ---
const INITIAL_BUFFER_SECONDS = 30; 
const INITIAL_BUFFER_SIZE = TARGET_SAMPLE_RATE * INITIAL_BUFFER_SECONDS;
const BUFFER_GROWTH_SECONDS = 30; 
const BUFFER_GROWTH_SIZE = TARGET_SAMPLE_RATE * BUFFER_GROWTH_SECONDS;

// --- Streaming State Variables (from moonshine-worker.ts / sequential buffering) ---
let preallocated16kBuffer: Float32Array | null = null;
let current16kWriteOffset = 0;
// let emittedSamples = 0; // REMOVED - Replaced by nextDecodeStart16k
let recording = false;          // Controls the background pull loop
let processingPartial = false;  // Flag to prevent concurrent partial ASR calls

// --- REMOVED Local Agreement State ---
// let confirmedTranscriptSoFar: string = "";
// let previousChunkDelta: string = "";
// const OL_MIN_CHARS_FOR_LA = 3;

// --- Sequential Buffering State (from old-code.md / merge-plan) ---
const PARTIAL_INTERVAL_S = 10; // Emit partial result every 10 seconds
let nextDecodeStart16k = 0; // Start index for the next ASR slice in preallocated16kBuffer
let lastPartialText = ""; // Store the cumulative text sent so far (for diffing)


const MAX_PROMPT_TOKENS = 200; // Remains for potential future use, currently disabled in refinement stage

// --- REMOVED Text Diffing Helper Functions (overlapLen, mergeWithOverlap) ---

// --- REMOVED resampleTo16kHz (it's now in audio/resample.ts and used in AudioWorklet) ---

// --- REMOVED Local Agreement Helper (longestCommonPrefix) ---

// --- NEW diffAndSend function (from old-code.md) ---
function diffAndSend(textNow: string, tag: 'partial') {
  textNow = textNow.trim(); // Ensure consistent trimming
  let i = 0;
  // Find longest common prefix length
  while (i < textNow.length && i < lastPartialText.length && textNow[i] === lastPartialText[i]) {
    i++;
  }

  let prefixBoundary = i;
  if (i > 0 && i < textNow.length) {
    const prevCharText = textNow[i - 1];
    const nextCharText = textNow[i];
    const prevCharLast = i > 0 ? lastPartialText[i - 1] : null;

    if (nextCharText === ' ' && prevCharLast && prevCharLast !== ' ') {
       prefixBoundary = i + 1; 
    }
  }
  
  const delta = textNow.slice(prefixBoundary).trimStart(); 
  
  // console.log(`[Worker Diff] Prev: "${lastPartialText}" | Now: "${textNow}" | LCP: ${i} | Adj Boundary: ${prefixBoundary} | Delta: "${delta}"`);

  if (delta) {
    self.postMessage({ status: tag, delta }); // Send delta for 'partial'
    lastPartialText = textNow; // Update history for next partial
  }
}


// --- Streaming Helper Functions (adapted from moonshine-worker.ts) ---

// Pulls audio from RingBuffer into preallocated16kBuffer and resizes if necessary
function pullAndProcessAudio() { 
    if (!ringBuffer || !preallocated16kBuffer) {
        console.warn("[LocalWorker Pull] RingBuffer or preallocated16kBuffer not ready.");
        return;
    }

    const availableInRing = ringBuffer.availableRead();
    if (availableInRing === 0) return;
  
    const samplesToRead = availableInRing; 
    
    const requiredSize = current16kWriteOffset + samplesToRead;
    if (requiredSize > preallocated16kBuffer.length) {
      const newSize = Math.max(requiredSize, preallocated16kBuffer.length + BUFFER_GROWTH_SIZE); 
      console.warn(`[LocalWorker Pull] Resizing 16kHz buffer from ${preallocated16kBuffer.length} to ${newSize} samples.`);
      try {
        const newBuffer = new Float32Array(newSize);
        newBuffer.set(preallocated16kBuffer.subarray(0, current16kWriteOffset), 0); 
        preallocated16kBuffer = newBuffer; 
      } catch (resizeError) {
        console.error("[LocalWorker Pull] Failed to resize 16kHz buffer:", resizeError);
        self.postMessage({ status: "error", error: "Failed to resize audio buffer during recording." });
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
      current16kWriteOffset + samplesToRead
    );
    
    // ringBuffer.read expects a buffer to fill and returns null if successful.
    ringBuffer.read(targetView); 
    current16kWriteOffset += samplesToRead;
}

// --- DELETED processAvailableAudio() ---

// --- NEW maybeEmitPartial function (from old-code.md, adapted) ---
async function maybeEmitPartial() {
  if (processingPartial || !preallocated16kBuffer || !asr || !recording) return; 

  const buffered16kSamples = current16kWriteOffset - nextDecodeStart16k;
  const bufferedSeconds = buffered16kSamples / TARGET_SAMPLE_RATE; // Use TARGET_SAMPLE_RATE

  if (bufferedSeconds >= PARTIAL_INTERVAL_S) {
    // console.log(`[LocalWorker] Buffer has >= ${PARTIAL_INTERVAL_S}s (${bufferedSeconds.toFixed(2)}s) of new audio. Processing partial...`);
    processingPartial = true;
    
    const sliceToProcess = preallocated16kBuffer.subarray(nextDecodeStart16k, current16kWriteOffset);
    const sliceEndIndexInFullBuffer = current16kWriteOffset; // Store end index in the main buffer

    try {
      // console.log(`[LocalWorker] Calling ASR pipeline for partial result (samples: ${sliceToProcess.length})...`);
      // const tPartialStart = performance.now();
      // @ts-ignore
      const result = await asr(sliceToProcess); // No explicit prompt
      // const tPartialEnd = performance.now();
      const currentFullTextForThisSlice = (result as any).text?.trim() ?? '';
      // console.log(`[LocalWorker] Partial ASR completed. Full Text for this slice: "${currentFullTextForThisSlice}"`);

      // Use diffAndSend for partial delta. The text to compare against is `lastPartialText`.
      // The new "full" text is the concatenation of previous confirmed text and the new segment's text.
      diffAndSend(lastPartialText + (lastPartialText ? ' ' : '') + currentFullTextForThisSlice, 'partial');
      
      // IMPORTANT: Move the start cursor *after* successful processing
      nextDecodeStart16k = sliceEndIndexInFullBuffer; 

    } catch (err) {
      console.error('[LocalWorker] Partial decode error:', err);
      // Optionally send an error back to UI if partials fail consistently
    } finally {
      processingPartial = false;
    }
  }
}


// Main loop for pulling and processing audio during streaming
async function startPullLoop() {
  console.log('[LocalWorker] Starting streaming pull loop...');
  while (recording) {
    if (!ringBuffer) {
      console.error('[LocalWorker] RingBuffer lost during pull loop. Stopping.');
      self.postMessage({ status: "error", error: "RingBuffer not available during streaming." });
      recording = false;
      break;
    }

    pullAndProcessAudio(); 
    await maybeEmitPartial(); // MODIFIED: Call new function

    await new Promise(resolve => setTimeout(resolve, PULL_LOOP_INTERVAL_MS)); 
  }
  console.log('[LocalWorker] Streaming pull loop stopped.');
}

self.addEventListener("message", async (e) => {
    const { type, data } = e.data ?? {};

    if (type === "init") {
        if (data?.sab) {
            try {
                ringBuffer = new RingBuffer(data.sab);
                console.log("[LocalWorker] RingBuffer initialized with SharedArrayBuffer.");
                self.postMessage({ status: "sab_initialized" });
            } catch (error) {
                console.error("[LocalWorker] Failed to initialize RingBuffer:", error);
                self.postMessage({ status: "error", error: "Worker failed to initialize RingBuffer." });
            }
        } else {
            console.error("[LocalWorker] 'init' message received without SharedArrayBuffer (sab).");
            self.postMessage({ status: "error", error: "Worker initialization failed: No SAB provided for RingBuffer." });
        }
        return;
    }

    if (type === "initialize-local-asr") {
        if (asr) {
            console.log("[LocalWorker] ASR pipeline already initialized.");
            self.postMessage({ status: "asr_model_ready" });
            return;
        }
        if (modelInitializationInProgress) {
            console.warn("[LocalWorker] Already busy initializing ASR pipeline.");
            return;
        }
        modelInitializationInProgress = true;
        self.postMessage({ status: "asr_model_loading" });
        console.log(`[LocalWorker] Received 'initialize-local-asr'. Initializing pipeline with model: ${MODEL_ID}`);
        try {
            // @ts-ignore - Transformers.js pipeline options are flexible - This comment might be slightly misplaced for the fix
            asr = await pipeline(
                "automatic-speech-recognition",
                MODEL_ID,
                {
                    progress_callback: (p: Progress | null) => p && self.postMessage({ ...p, status: 'model_progress'}),
                    device: device,
                    dtype: dtypeConfig,
                    // REMOVED: chunk_length_s: CHUNK_S,
                    // REMOVED: stride_length_s: [STRIDE_S, STRIDE_S], 
                } as any 
            );
            console.log("[LocalWorker] ASR Streaming Pipeline initialized successfully.");
            self.postMessage({ status: "asr_model_ready" });
        } catch (pipelineError) {
            console.error("[LocalWorker] ASR Pipeline initialization failed:", pipelineError);
            self.postMessage({ status: "error", error: "Worker failed to initialize ASR pipeline." });
            asr = null;
        } finally {
            modelInitializationInProgress = false;
        }
        return;
    }

    if (type === "start-capture") { // Now initiates streaming
        if (!asr) {
            self.postMessage({ status: "error", error: "ASR model not ready. Please initialize first." });
            return;
        }
        if (!ringBuffer) {
            self.postMessage({ status: "error", error: "RingBuffer not initialized. Send 'init' with SAB first." });
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
            console.log(`[LocalWorker] Initial 16kHz buffer created (size: ${INITIAL_BUFFER_SIZE} samples).`);
        } catch (allocError) {
            console.error("[LocalWorker] Failed to allocate initial 16kHz buffer:", allocError);
            self.postMessage({ status: "error", error: "Failed to allocate audio buffer." });
            preallocated16kBuffer = null;
            return;
        }

        // emittedSamples = 0; // REMOVED
        processingPartial = false;
        // REMOVED: confirmedTranscriptSoFar = ""; 
        // REMOVED: previousChunkDelta = "";   
        nextDecodeStart16k = 0; // Reset for sequential buffer
        lastPartialText = ""; // Reset for sequential buffer
        
        ringBuffer.reset(); 
        self.postMessage({ status: "capture_started" }); // Signal that capture/streaming has begun
        
        recording = true;
        startPullLoop(); // Don't await, let it run in the background
        return;
    }

    if (type === "stop-capture-and-transcribe") { // Now acts as "flush"
        if (!recording && !processingPartial && preallocated16kBuffer === null) {
             console.warn('[LocalWorker] Flush requested but not recording, not processing, and no buffer. Likely already flushed or never started.');
             self.postMessage({ status: "completed", transcription: lastPartialText || "" }); // Send last known text
             return;
        }
        
        const wasRecording = recording;
        console.log('[LocalWorker] Flush requested. Stopping pull loop and processing remaining audio.');
        recording = false; // Signal the pull loop to stop

        // Wait briefly for any ongoing partial processing from the loop to finish
        // This loop ensures that `processAvailableAudio` completes its current execution if it was mid-way.
        let waitCount = 0;
        const maxWaitIterations = 100; // Max 5 seconds (100 * 50ms)
        while (processingPartial && waitCount < maxWaitIterations) {
            console.log('[LocalWorker] Waiting for ongoing partial processing before final flush...');
            await new Promise(resolve => setTimeout(resolve, PULL_LOOP_INTERVAL_MS));
            waitCount++;
        }
        if (processingPartial) {
            console.warn('[LocalWorker] Timeout waiting for partial processing. Proceeding with flush anyway.');
            processingPartial = false; // Force it if stuck
        }
        
        self.postMessage({ status: "processing_full_audio" }); // Indicate final processing

        if (!asr) {
            self.postMessage({ status: "error", error: "ASR model not ready for flush." });
            if (preallocated16kBuffer) preallocated16kBuffer = null; // Clean up buffer
            return;
        }
        if (!preallocated16kBuffer) {
            console.warn("[LocalWorker] No preallocated buffer to flush (might have been an error or empty recording).");
            self.postMessage({ status: "completed", transcription: lastPartialText || "" });
            return;
        }

        // Perform one final pull from the RingBuffer if it was recording
        if (wasRecording && ringBuffer) {
            console.log("[LocalWorker] Pulling final audio chunk from RingBuffer for flush...");
            pullAndProcessAudio(); 
            console.log(`[LocalWorker] Final pull complete. Current 16k offset: ${current16kWriteOffset}`);
        }
        
        let finalUserTextSegment = ""; // Renamed from finalUserText to avoid confusion
        let finalPipelineTime = 0;

        // Process the remaining audio segment that hasn't been covered by `nextDecodeStart16k`
        const remainingAudioLength = current16kWriteOffset - nextDecodeStart16k; 

        if (remainingAudioLength > 0) {
            const finalSlice = preallocated16kBuffer.subarray(nextDecodeStart16k, current16kWriteOffset); 
            console.log(`[LocalWorker] Processing final audio segment. Slice from ${nextDecodeStart16k} to ${current16kWriteOffset} (Length: ${finalSlice.length}).`); 
            
            processingPartial = true; 
            const tFinalStart = performance.now();
            try {
                // @ts-ignore - Transformers.js pipeline options are flexible
                const result = await asr(finalSlice); // No explicit prompt

                finalPipelineTime = performance.now() - tFinalStart;
                console.log(`[LocalWorker] Final ASR pipeline completed in ${finalPipelineTime.toFixed(2)} ms.`);
                
                finalUserTextSegment = (result.text || "").trim(); // Store only the segment from the final ASR call
                if (finalUserTextSegment) {
                    console.log(`[LocalWorker] Text from final ASR segment: "${finalUserTextSegment}"`);
                } else {
                    console.log(`[LocalWorker] No additional text from final ASR segment.`);
                }

            } catch (err) {
                console.error(`[LocalWorker] Final ASR Error after ${finalPipelineTime.toFixed(2)}ms:`, String(err));
                self.postMessage({ status: "error", error: `Final ASR Error: ${String(err)}` });
            } finally {
                processingPartial = false;
            }
        } else {
           console.log("[LocalWorker] No remaining audio data to process in final flush beyond what was streamed.");
        }
        
        // Construct final text using lastPartialText and the segment from the final ASR output
        const absoluteFinalText = (lastPartialText + (lastPartialText && finalUserTextSegment ? ' ' : '') + finalUserTextSegment).trim();
        console.log(`[LocalWorker] Sending final 'completed' message. Transcription: "${absoluteFinalText}"`);

        self.postMessage({ 
            status: 'completed', 
            transcription: absoluteFinalText, 
            timings: { total_asr_time_final_segment: finalPipelineTime } 
        });
        
        // Reset state for next recording
        // emittedSamples = 0; // REMOVED
        current16kWriteOffset = 0; 
        nextDecodeStart16k = 0; 
        lastPartialText = ""; 
        if (preallocated16kBuffer) { 
             preallocated16kBuffer.fill(0); 
             preallocated16kBuffer = null; 
        }
        // `recording` is already false
        // `processingPartial` should be false here
        return;
    }

    // Fallback for unknown messages (though all relevant types should be handled above)
    if (type !== "init" && type !== "initialize-local-asr" && type !== "start-capture" && type !== "stop-capture-and-transcribe") {
        console.warn(`[LocalWorker] Received unknown message type: ${type}`);
    }
});

self.onerror = (event) => {
    console.error("[LocalWorker] Unhandled error in worker:", event);
    self.postMessage({ status: "error", error: "An unexpected error occurred in the worker." });
};

self.onunhandledrejection = (event) => {
    console.error("[LocalWorker] Unhandled promise rejection in worker:", event);
    self.postMessage({ status: "error", error: "An unexpected promise rejection occurred in the worker." });
};

console.log("[LocalWorker] Streaming-capable event listener added. Worker script loaded."); 