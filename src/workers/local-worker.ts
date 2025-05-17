import {
    pipeline,
    env,
    // @ts-ignore Progress type might be nested or different now
    Progress
} from "@huggingface/transformers";
import { RingBuffer } from "../audio/ring-buffer.js"; // Changed .ts to .js

// Updated MODEL_ID for streaming
const MODEL_ID = "onnx-community/moonshine-base-ONNX";

// Define type for Dtype configuration
type DtypeConfig = Record<string, "auto" | "fp32" | "fp16" | "q8" | "q4f16" | "int8">; // q4f16 from local, q4 from moonshine. Sticking with local options.

// Define dtype configurations based on device with explicit typing (Updated from moonshine-worker)
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  wasm: {
    encoder_model: "fp16", // from moonshine-worker
    decoder_model_merged: "q8", // from moonshine-worker
  },
};

const device = 'wasm'; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

console.log("[LocalWorker] using WASM backend with streaming capability.");

let asr: any | null = null;
let modelInitializationInProgress = false; // Replaces part of 'busy' for clarity
let ringBuffer: RingBuffer | null = null;

const TARGET_SAMPLE_RATE = 16000; // Already 16k

// --- Streaming Config (from moonshine-worker.ts) ---
const CHUNK_S = 5;          // Process 5 seconds of audio at a time
const STRIDE_S = 2;         // Overlap chunks by 2 seconds
const CHUNK_SAMPLES = CHUNK_S * TARGET_SAMPLE_RATE;
const STRIDE_SAMPLES = STRIDE_S * TARGET_SAMPLE_RATE;
const PULL_LOOP_INTERVAL_MS = 50; // Check for new audio frequently

// --- Buffer Size Constants (from moonshine-worker.ts) ---
const INITIAL_BUFFER_SECONDS = 30; 
const INITIAL_BUFFER_SIZE = TARGET_SAMPLE_RATE * INITIAL_BUFFER_SECONDS;
const BUFFER_GROWTH_SECONDS = 30; 
const BUFFER_GROWTH_SIZE = TARGET_SAMPLE_RATE * BUFFER_GROWTH_SECONDS;

// --- Streaming State Variables (from moonshine-worker.ts) ---
let preallocated16kBuffer: Float32Array | null = null;
let current16kWriteOffset = 0;
let emittedSamples = 0;         // How many samples have been processed and led to emitted text
let recording = false;          // Controls the background pull loop
let processingPartial = false;  // Flag to prevent concurrent partial ASR calls
let runningPrompt = "";         // For contextual ASR

// Placeholder for a simple resampling function
// Input: Float32Array audio data, original sample rate
// Output: Float32Array audio data at TARGET_SAMPLE_RATE
function resampleTo16kHz(audioData: Float32Array, originalSampleRate: number): Float32Array {
    if (originalSampleRate === TARGET_SAMPLE_RATE) {
        return audioData;
    }
    if (originalSampleRate === 48000 && TARGET_SAMPLE_RATE === 16000) {
        // Simple downsampling: take every 3rd sample
        const newLength = Math.floor(audioData.length / 3);
        const newData = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            newData[i] = audioData[i * 3];
        }
        console.log(`[LocalWorker] Resampled audio from 48kHz to 16kHz (length: ${audioData.length} -> ${newData.length})`);
        return newData;
    }
    // Add more sophisticated resampling or other cases if needed
    console.warn(`[LocalWorker] Resampling from ${originalSampleRate}Hz to ${TARGET_SAMPLE_RATE}Hz not fully supported. Attempting naive resampling or returning original.`);
    // Naive resampling for other rates (e.g. 44100 to 16000)
    // This is a placeholder and might produce poor quality audio.
    // A proper library should be used for production quality.
    const ratio = originalSampleRate / TARGET_SAMPLE_RATE;
    if (ratio <= 0) return audioData; // Should not happen

    const newLength = Math.floor(audioData.length / ratio);
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        // Simple nearest neighbor, can be improved with linear interpolation etc.
        resampled[i] = audioData[Math.floor(i * ratio)];
    }
    console.log(`[LocalWorker] Naively resampled audio from ${originalSampleRate}kHz to ${TARGET_SAMPLE_RATE}kHz (length: ${audioData.length} -> ${resampled.length})`);
    if (resampled.length === 0 && audioData.length > 0) { // Safeguard
        self.postMessage({ status: "error", error: `Resampling from ${originalSampleRate}Hz resulted in empty audio.` });
        return audioData; // Return original to avoid breaking, but it will be wrong SR
    }
    return resampled;
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

// Processes available audio chunks for streaming transcription
async function processAvailableAudio() {
  if (processingPartial || !preallocated16kBuffer || !asr || !recording) return; 

  const processableAudioLength = current16kWriteOffset - emittedSamples;

  if (processableAudioLength >= CHUNK_SAMPLES) {
    processingPartial = true;

    const audioSliceStart = emittedSamples;
    const audioSliceEnd = emittedSamples + CHUNK_SAMPLES; 
    const slice = preallocated16kBuffer.subarray(audioSliceStart, audioSliceEnd);

    // console.log(`[LocalWorker] Preparing chunk. Slice from ${audioSliceStart} to ${audioSliceEnd} (Length: ${slice.length}). Emitted: ${emittedSamples}. Prompt: "${runningPrompt}"`);

    try {
      const tAsrStart = performance.now();
      // @ts-ignore - Transformers.js pipeline options are flexible
      const result = await asr(slice, { 
        prompt: runningPrompt // Pass current runningPrompt
      }); 
      const tAsrEnd = performance.now();

      // IMPORTANT: The `asr` pipeline with streaming params handles stride and overlap internally.
      // We advance `emittedSamples` by `CHUNK_SAMPLES` because that's the size of the primary audio processed.
      // The pipeline might return text that corresponds to more or less than this due to stride.
      // The `runningPrompt` aims to give context for these overlaps.
      emittedSamples += CHUNK_SAMPLES; 
      // console.log(`[LocalWorker] ASR call successful. Advanced emittedSamples by CHUNK_SAMPLES to ${emittedSamples}.`);

      const delta = (result.text || "").trim();

      if (delta) {
          // console.log(`[LocalWorker] ASR completed in ${(tAsrEnd - tAsrStart).toFixed(2)} ms. Partial Delta: "${delta}"`);
          self.postMessage({ status: 'partial', transcription: delta }); // Send 'transcription' key like 'completed'
          runningPrompt += delta + " "; // Append to runningPrompt
      } else {
          // console.log(`[LocalWorker] ASR completed in ${(tAsrEnd - tAsrStart).toFixed(2)} ms. No delta from this chunk.`);
      }

    } catch (err) {
      console.error('[LocalWorker] ASR pipeline error during streaming chunk:', err);
      // Potentially post an error message, but be careful not to flood.
      // For now, just log it. The flush operation will try to process remaining audio.
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
    await processAvailableAudio();

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
                    // Streaming parameters for the pipeline
                    chunk_length_s: CHUNK_S,
                    stride_length_s: [STRIDE_S, STRIDE_S], // Must be array [left, right]
                } as any // Explicitly cast options object to any to bypass linter error
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

        emittedSamples = 0;
        processingPartial = false;
        runningPrompt = ""; // Reset prompt for new stream
        
        ringBuffer.reset(); 
        self.postMessage({ status: "capture_started" }); // Signal that capture/streaming has begun
        
        recording = true;
        startPullLoop(); // Don't await, let it run in the background
        return;
    }

    if (type === "stop-capture-and-transcribe") { // Now acts as "flush"
        if (!recording && !processingPartial && preallocated16kBuffer === null) {
             console.warn('[LocalWorker] Flush requested but not recording, not processing, and no buffer. Likely already flushed or never started.');
             self.postMessage({ status: "completed", transcription: runningPrompt || "" }); // Send current prompt if any
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
            self.postMessage({ status: "completed", transcription: runningPrompt || "" });
            return;
        }

        // Perform one final pull from the RingBuffer if it was recording
        if (wasRecording && ringBuffer) {
            console.log("[LocalWorker] Pulling final audio chunk from RingBuffer for flush...");
            pullAndProcessAudio(); 
            console.log(`[LocalWorker] Final pull complete. Current 16k offset: ${current16kWriteOffset}`);
        }
        
        let finalUserText = "";
        let finalPipelineTime = 0;

        // Process the remaining audio segment that hasn't been covered by `emittedSamples`
        const remainingAudioLength = current16kWriteOffset - emittedSamples;

        if (remainingAudioLength > 0) {
            const finalSlice = preallocated16kBuffer.subarray(emittedSamples, current16kWriteOffset);
            console.log(`[LocalWorker] Processing final audio segment. Slice from ${emittedSamples} to ${current16kWriteOffset} (Length: ${finalSlice.length}). Prompt: "${runningPrompt}"`);
            
            processingPartial = true; // Mark as busy for this final transcription
            const tFinalStart = performance.now();
            try {
                // @ts-ignore - Transformers.js pipeline options are flexible
                const result = await asr(finalSlice, {
                  prompt: runningPrompt, // Use the accumulated prompt
                  // For the final chunk, we don't need to provide chunk_length_s/stride_length_s
                  // as we want the model to process this segment as a whole conclusion.
                  // The pipeline should already be configured with streaming params.
                });

                finalPipelineTime = performance.now() - tFinalStart;
                console.log(`[LocalWorker] Final ASR pipeline completed in ${finalPipelineTime.toFixed(2)} ms.`);
                
                const newText = (result.text || "").trim();
                if (newText) {
                    finalUserText = newText; // The result of the final chunk is appended
                    console.log(`[LocalWorker] Final Text from ASR: "${finalUserText}"`);
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
        
        // The runningPrompt already contains text from 'partial' messages.
        // If finalUserText has content, it's the transcription of the very last bit of audio.
        // We should append this to the runningPrompt to form the complete transcription.
        const completeTranscription = (runningPrompt + (finalUserText ? (runningPrompt.endsWith(" ") ? "" : " ") + finalUserText : "")).trim();

        console.log(`[LocalWorker] Sending final 'completed' message. Transcription: "${completeTranscription}"`);
        self.postMessage({ 
            status: 'completed', 
            transcription: completeTranscription,
            timings: { total_asr_time_final_segment: finalPipelineTime } 
        });
        
        // Reset state for next recording
        emittedSamples = 0;
        current16kWriteOffset = 0; 
        if (preallocated16kBuffer) { // Make sure it exists before trying to nullify
             preallocated16kBuffer.fill(0); // Optional: clear buffer
             preallocated16kBuffer = null; 
        }
        runningPrompt = "";
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