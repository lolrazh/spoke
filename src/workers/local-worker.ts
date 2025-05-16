import {
    pipeline,
    env,
    // @ts-ignore Progress type might be nested or different now
    Progress
} from "@huggingface/transformers";
import { RingBuffer } from "../audio/ring-buffer.js"; // Changed .ts to .js

const MODEL_ID = "onnx-community/moonshine-tiny-ONNX";

// Define type for Dtype configuration
type DtypeConfig = Record<string, "auto" | "fp32" | "fp16" | "q8" | "q4f16" | "int8">;

// Define dtype configurations based on device with explicit typing
const DEVICE_DTYPE_CONFIGS: Record<string, DtypeConfig> = {
  wasm: {
    encoder_model: "q8", // Using fp16 for encoder as per original
    decoder_model_merged: "q8", // WASM might benefit from q8
  },
};

const device = 'wasm'; // Force WASM backend
const dtypeConfig = DEVICE_DTYPE_CONFIGS[device];

console.log("[LocalWorker] using WASM backend");

let asr: any | null = null;
let busy = false; // To track if a transcription is in progress
let ringBuffer: RingBuffer | null = null;
let isCapturing = false;

const TARGET_SAMPLE_RATE = 16000;

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

// No immediate pipeline initialization here.
// Worker will wait for 'initialize-local-asr' message.

self.addEventListener("message", async (e) => {
    const { type, data } = e.data ?? {}; // Common structure for data

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
            self.postMessage({ status: "asr_model_ready" }); // Inform host it's ready
            return;
        }
        if (busy) { // Check if already busy with initialization
            console.warn("[LocalWorker] Already busy initializing ASR pipeline.");
            return;
        }
        busy = true;
        self.postMessage({ status: "asr_model_loading" });
        console.log(`[LocalWorker] Received 'initialize-local-asr'. Initializing pipeline with model: ${MODEL_ID}`);
        try {
            asr = await pipeline(
                "automatic-speech-recognition",
                MODEL_ID,
                {
                    progress_callback: (p: Progress | null) => p && self.postMessage({ ...p, status: 'model_progress'}), // Send progress with a distinct status
                    device: device,
                    dtype: dtypeConfig,
                } as any
            );
            console.log("[LocalWorker] ASR Pipeline initialized successfully.");
            self.postMessage({ status: "asr_model_ready" });
        } catch (pipelineError) {
            console.error("[LocalWorker] ASR Pipeline initialization failed:", pipelineError);
            self.postMessage({ status: "error", error: "Worker failed to initialize ASR pipeline." });
            asr = null; // Ensure asr is null if init fails
        } finally {
            busy = false;
        }
        return;
    }

    if (type === "start-capture") {
        if (!ringBuffer) {
            self.postMessage({ status: "error", error: "RingBuffer not initialized. Send 'init' with SAB first." });
            return;
        }
        ringBuffer.reset(); // Clear any old data
        isCapturing = true;
        console.log("[LocalWorker] Capture started. Ready to receive audio via SAB.");
        self.postMessage({ status: "capture_started" });
        return;
    }

    if (type === "stop-capture-and-transcribe") {
        if (!asr) {
            self.postMessage({ status: "error", error: "ASR model not ready." });
            return;
        }
        if (busy) {
            self.postMessage({ status: "error", error: "Worker is busy with another transcription." });
            return;
        }
        if (!ringBuffer) {
            self.postMessage({ status: "error", error: "RingBuffer not initialized." });
            return;
        }
        isCapturing = false;
        busy = true;
        self.postMessage({ status: "processing_full_audio" });
        console.log("[LocalWorker] Stopping capture. Reading full audio from RingBuffer for single-pass transcription.");

        // It's assumed the main thread controls the AudioWorklet and stops writing to SAB.
        // Here, we read everything that's been written.
        const available = ringBuffer.availableRead();
        let capturedAudio: Float32Array;

        if (available > 0) {
            const tempBuffer = new Float32Array(available);
            ringBuffer.read(tempBuffer); // read into tempBuffer and it returns null
            capturedAudio = tempBuffer;
        } else {
            capturedAudio = new Float32Array(0);
        }
        
        if (!capturedAudio || capturedAudio.length === 0) {
            console.warn("[LocalWorker] No audio data captured from RingBuffer.");
            self.postMessage({ status: "completed", transcription: "" }); // Send empty if no audio
            busy = false;
            return;
        }

        console.log(`[LocalWorker] Read ${capturedAudio.length} samples from RingBuffer.`);
        // The RingBuffer should be storing 16kHz audio directly if AudioContext is 16kHz.
        // The `originalSampleRate` parameter here is for the audio *from the RingBuffer*.
        // If the AudioContext feeding the SAB is 16kHz, this will be 16000.
        const originalSampleRate = data?.sampleRate || TARGET_SAMPLE_RATE; // Expect sampleRate from caller or default to 16k

        try {
            // Resample if necessary. If audio from RingBuffer is already 16kHz, this will be a no-op.
            const audioToTranscribe = resampleTo16kHz(capturedAudio, originalSampleRate);

            if (audioToTranscribe.length === 0 && capturedAudio.length > 0) {
                 console.error("[LocalWorker] Resampling resulted in empty audio. Cannot transcribe.");
                 self.postMessage({ status: "error", error: "Resampling failed, resulting in empty audio." });
                 busy = false;
                 return;
            }

            const tAsrStart = performance.now();
            const result = await asr(audioToTranscribe, {} as any); 
            const tAsrEnd = performance.now();

            const transcription = (result.text || "").trim();
            console.log(`[LocalWorker] Single-pass ASR completed in ${(tAsrEnd - tAsrStart).toFixed(2)} ms. Transcription: "${transcription}"`);
            self.postMessage({ status: "completed", transcription });

        } catch (err) {
            console.error('[LocalWorker] ASR pipeline error during transcription:', err);
            self.postMessage({ status: "error", error: "Transcription failed in worker." });
        } finally {
            busy = false;
        }
        return; // Ensure we don't fall through
    }

    // NEW: Handler to get raw audio buffer for cloud processing
    if (type === "stop-capture-and-get-buffer") {
        if (!ringBuffer) {
            self.postMessage({ status: "error", error: "RingBuffer not initialized." });
            return;
        }
        if (busy) { // Still check busy flag to avoid race conditions if it were used more broadly
            self.postMessage({ status: "error", error: "Worker is busy." });
            return;
        }

        isCapturing = false;
        busy = true; // Mark as busy while extracting audio
        
        console.log("[LocalWorker] Stopping capture. Reading full audio from RingBuffer to send raw.");

        const available = ringBuffer.availableRead();
        let capturedAudio: Float32Array;

        if (available > 0) {
            const tempBuffer = new Float32Array(available);
            ringBuffer.read(tempBuffer);
            capturedAudio = tempBuffer;
        } else {
            capturedAudio = new Float32Array(0);
        }
        
        if (!capturedAudio || capturedAudio.length === 0) {
            console.warn("[LocalWorker] No audio data captured from RingBuffer for raw export.");
            // Send an empty buffer if no audio, or an error?
            // For now, send it and let the receiver decide.
        }
        
        const sampleRateToReport = data?.sampleRate || TARGET_SAMPLE_RATE;
        console.log(`[LocalWorker] Read ${capturedAudio.length} raw samples from RingBuffer. Reporting sample rate: ${sampleRateToReport}Hz.`);
        
        self.postMessage({ 
            status: "raw_audio_buffer_ready", 
            audio: capturedAudio, // Send Float32Array directly
            sampleRate: sampleRateToReport 
        });
        
        busy = false;
        return;
    }
});

// Log any unhandled errors within the worker
self.onerror = (event) => {
    console.error("[LocalWorker] Unhandled error in worker:", event);
    self.postMessage({ status: "error", error: "An unexpected error occurred in the worker." });
};

self.onunhandledrejection = (event) => {
    console.error("[LocalWorker] Unhandled promise rejection in worker:", event);
    self.postMessage({ status: "error", error: "An unexpected promise rejection occurred in the worker." });
};

console.log("[LocalWorker] Event listener added. Worker script loaded and ready for messages."); 