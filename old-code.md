<moonshine-worker.ts>
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
const SAMPLE_RATE_16K = 16000;
const INITIAL_BUFFER_SECONDS = 30; // Start with a 30-second buffer
const INITIAL_BUFFER_SIZE = SAMPLE_RATE_16K * INITIAL_BUFFER_SECONDS;
const BUFFER_GROWTH_SECONDS = 30; // Add 60 seconds worth of space when resizing
const BUFFER_GROWTH_SIZE = SAMPLE_RATE_16K * BUFFER_GROWTH_SECONDS;

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
      current16kWriteOffset = 0;
      nextDecodeStart16k = 0; // Reset decode cursor
      processingPartial = false; // Reset partial processing flag
      lastPartialText = ""; // Reset history on new stream
      preallocated16kBuffer = new Float32Array(INITIAL_BUFFER_SIZE); 
      console.log(`[Worker] Initial 16kHz buffer created (size: ${INITIAL_BUFFER_SIZE} samples).`);
    } catch (allocError) {
      console.error("[Worker] Failed to allocate initial 16kHz buffer:", allocError);
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

  // Determine the number of samples to read (all available from ring buffer for now)
  const samplesToRead = available16k; 
  
  // --- ADD: Dynamic resizing ---
  const requiredSize = current16kWriteOffset + samplesToRead;
  if (requiredSize > preallocated16kBuffer.length) {
    // Double the buffer size or increase to required size, whichever is larger
    // CHANGE: Increase by a fixed amount (BUFFER_GROWTH_SIZE) instead of doubling, 
    //         but ensure it's at least large enough for the required size.
    const newSize = Math.max(requiredSize, preallocated16kBuffer.length + BUFFER_GROWTH_SIZE); 
    console.warn(`[Worker Pull] Resizing 16kHz buffer from ${preallocated16kBuffer.length} to ${newSize} samples.`);
    try {
      const newBuffer = new Float32Array(newSize);
      // Copy existing data
      newBuffer.set(preallocated16kBuffer.subarray(0, current16kWriteOffset), 0); 
      preallocated16kBuffer = newBuffer; // Replace the old buffer
    } catch (resizeError) {
      console.error("[Worker Pull] Failed to resize 16kHz buffer:", resizeError);
      // Try to proceed with what fits? Or stop? For now, stop processing this chunk.
      self.postMessage({ status: "error", error: "Failed to resize audio buffer during recording." });
      // Optionally clear the ring buffer to prevent repeated attempts?
      // FIX: ringBuffer.read expects a target buffer, not null. Read into a temporary buffer to discard.
      ringBuffer.read(new Float32Array(available16k)); // Read and discard to prevent loop?
      return; 
    }
  }
  // --- END: Dynamic resizing ---

  // Read directly into the (potentially resized) preallocated buffer at the current offset
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
</moonshine-worker.ts>
<usetranscription.ts>
    import { useRef, useState, useEffect, useCallback } from 'react';

// Constants (can be moved or adjusted)
const TARGET_AUDIO_CONTEXT_RATE = 16000; // Use 16kHz for AudioContext
// MAX_SAMPLES calculation might not be needed here anymore if worker handles clipping

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string; // This will now hold the *cumulative* text
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useTranscription(): UseTranscriptionReturn {
  const workerRef = useRef<Worker | null>(null);
  // --- Removed MediaRecorder refs ---
  // const recorderRef = useRef<MediaRecorder | null>(null);
  // const audioChunksRef = useRef<Blob[]>([]);
  // --- Added AudioWorklet refs ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sabRef = useRef<SharedArrayBuffer | null>(null); // To hold the SharedArrayBuffer
  const streamRef = useRef<MediaStream | null>(null); // Keep track of the mic stream

  // --- State Variables ---
  // const [stream, setStream] = useState<MediaStream | null>(null); // Use ref instead
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refs to track the latest state for potential callbacks (less critical now)
  const readyRef = useRef(ready);
  const processingRef = useRef(processing);

  // Update refs whenever state changes
  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { processingRef.current = processing; }, [processing]);

  // --- 1️⃣ Boot worker once --- 
  useEffect(() => {
    if (workerRef.current) return;

    console.log('[useTranscription] Initializing worker...');
    workerRef.current = new Worker(
      new URL('../moonshine-worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Cleanup
    return () => {
      console.log('[useTranscription] Terminating worker.');
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- 2️⃣ Ask for mic & create AudioContext once --- 
  useEffect(() => {
    // This effect now ONLY requests mic permission and prepares AudioContext
    (async () => {
      // Only run if context doesn't exist yet
      if (audioCtxRef.current) return;

      console.log('[useTranscription] Requesting microphone access and preparing AudioContext...');
      try {
        // Get mic permission (stream is stored in ref)
        streamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000 } // Request 16kHz directly
        });
        console.log('[useTranscription] Microphone access granted.');

        // Create AudioContext at the correct sample rate
        audioCtxRef.current = new AudioContext({ sampleRate: TARGET_AUDIO_CONTEXT_RATE });
        console.log(`[useTranscription] AudioContext created (Rate: ${audioCtxRef.current.sampleRate}Hz).`);

      } catch (err) {
        console.error("[useTranscription] Microphone access or AudioContext creation error:", err);
        setError('Microphone permissions denied or AudioContext failed.');
        streamRef.current = null; // Ensure stream ref is null on error
        // Don't set audioCtxRef to null here, error state handles it
      }
    })();

    // Cleanup function for THIS useEffect
    return () => {
      console.log('[useTranscription] Cleaning up stream and AudioContext...');
      // Stop stream tracks if they exist
      streamRef.current?.getTracks().forEach(track => track.stop());
      // Close AudioContext if it exists
      audioCtxRef.current?.close().catch(console.error);

      // Clear refs on cleanup
      streamRef.current = null;
      audioCtxRef.current = null;
      // Also clear worklet/source refs if they exist (though they are managed by start/stop now)
      workletNodeRef.current = null;
      microphoneSourceRef.current = null;
      sabRef.current = null; // Clear SAB ref on unmount
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- 3️⃣ Worker Message Handler --- 
  useEffect(() => {
    if (!workerRef.current) return;

    const onMessageReceived = (e: MessageEvent) => {
      console.log('[useTranscription] Worker message:', e.data); 
      const status = e.data?.status;
      const output = e.data?.output;
      const workerError = e.data?.error;
      const timings = e.data?.timings;
      const delta = e.data?.delta; // For partial results

      switch (status) {
        case 'loading':
          setReady(false);
          setProcessing(true); 
          setError(null);
          setText(''); // Clear text on new loading
          break;
        case 'ready': 
          setReady(true);
          setProcessing(false);
          setError(null);
          console.log('[useTranscription] Worker ready.');
          break;
        case 'streaming_started': 
            console.log('[useTranscription] Worker confirmed streaming started.');
            setText(''); // Clear text when streaming starts
            break;
        case 'processing_start': 
            console.log('[useTranscription] Worker started ASR processing (for final flush).');
            setProcessing(true);
            // Don't clear text here, wait for final result
            console.time('e2e-transcription-final'); // Use a different timer for final flush
            break;
        case 'partial':
            const partialDelta = e.data?.delta as string;
            if (typeof partialDelta === 'string' && partialDelta) {
                console.log(`[useTranscription] Received partial text delta: "${partialDelta}"`);
                // Append delta to internal state 
                setText(prev => (prev + ' ' + partialDelta).trim()); 
            }
            break;
        case 'complete': 
            // Handle final result: Update state AND paste here
            const finalText = e.data?.text as string; // Expect full text now
            if (typeof finalText === 'string') { 
                console.log(`[useTranscription] Received final text: "${finalText}"`);
                // Set the final, authoritative text state
                setText(finalText); 
                // PASTE the final text directly from the hook
                if (finalText && window.electron) { // Ensure text is not empty before pasting
                  window.electron.insertTextAtCursor(finalText)
                      .catch(err => console.error(`[useTranscription] Error inserting final text:`, err));
                } else if (!finalText) {
                   console.log('[useTranscription] Final text is empty, skipping paste.');
                }
            }
            // Handle timings and state for complete message
            setProcessing(false);
            console.timeEnd('e2e-transcription-final'); 
            if (timings) {
               console.log(`[useTranscription] Worker Final Flush Timings: Total: ${timings.total?.toFixed(2)} ms`);
            } else {
               console.warn("[useTranscription] No timing info received from worker for final flush.");
            }
            break;
        case 'error': 
        case 'init-error': 
          setError(String(workerError || 'Worker error'));
          setProcessing(false);
          setReady(false); 
          console.timeEnd('e2e-transcription-final'); // Ensure timer stops on error
          break;
        default:
          console.warn('[useTranscription] Unknown worker status:', status);
          break;
      }
    };

    workerRef.current.addEventListener('message', onMessageReceived);

    return () => {
      console.log('[useTranscription] Removing worker message listener.');
      workerRef.current?.removeEventListener('message', onMessageReceived);
    };
  }, []); 

  // --- 4️⃣ Public API ---
  const start = useCallback(async () => {
    console.log('[useTranscription] start() called.');
    if (recording) {
      console.warn('[useTranscription] Already recording.');
      return;
    }
    if (!ready) {
      console.warn('[useTranscription] Worker not ready, cannot start.');
      setError('Transcription engine not ready.');
      return;
    }
    if (!audioCtxRef.current || !streamRef.current) {
        console.error('[useTranscription] AudioContext or MediaStream not available.');
        setError('Audio resources not initialized. Check microphone permissions.');
        return;
    }
    // Ensure AudioContext is running (might be suspended after inactivity)
    if (audioCtxRef.current.state === 'suspended') {
      console.log('[useTranscription] Resuming AudioContext...');
      await audioCtxRef.current.resume();
    }

    setError(null); 
    setText(''); // Clear text on start

    try {
      console.log('[useTranscription] Setting up AudioWorklet...');
      
      // --- Add SAB availability check ---
      if (typeof SharedArrayBuffer === 'undefined') {
        console.error('[useTranscription] SharedArrayBuffer is not available! Cannot use high-performance capture.');
        setError('High-performance capture disabled (SharedArrayBuffer missing). Please ensure the app environment is correctly configured.');
        // TODO: Optionally implement fallback to MediaRecorder here if desired
        // For now, just prevent proceeding with the AudioWorklet path.
        setRecording(false); // Ensure recording state is false
        return; // Stop the start process
      }
      // --- End SAB check ---

      // 1. Create SharedArrayBuffer using the *updated* constant size
      const { Constants } = await import('../audio/ring-buffer.js');
      // Ensure we use the size calculated for 10s @ 48kHz
      sabRef.current = new SharedArrayBuffer(Constants.RING_BUFFER_SIZE_BYTES); 
      console.log(`[useTranscription] SharedArrayBuffer created (${sabRef.current.byteLength} bytes).`);

      // *** Get the ACTUAL sample rate ***
      const actualSampleRate = audioCtxRef.current.sampleRate;
      console.log(`[useTranscription] Actual AudioContext Sample Rate: ${actualSampleRate} Hz.`);

      // 2. Add AudioWorklet module (ensure path is correct relative to build output)
      // Try using a relative path assuming it's sibling to index.html in output
      const workletURL = './audioworklet-processor.js'; 
      try {
          console.log(`[useTranscription] Attempting to load worklet from: ${workletURL}`);
          await audioCtxRef.current.audioWorklet.addModule(workletURL);
          console.log('[useTranscription] AudioWorklet module added successfully.');
      } catch (err) {
          console.error('[useTranscription] Failed to load AudioWorklet module:', err);
          setError('Failed to load audio processing module.');
          setRecording(false);
          sabRef.current = null; // Clean up SAB if worklet fails
          return;
      }

      // 3. Create AudioWorkletNode, passing SAB and sample rates
      workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'capture-processor', {
          processorOptions: { 
              sab: sabRef.current, // Pass the SharedArrayBuffer
              actualSampleRate: actualSampleRate,
              targetSampleRate: TARGET_AUDIO_CONTEXT_RATE // Pass our desired target rate
          } 
      });
      console.log('[useTranscription] AudioWorkletNode created.');

      // Handle potential errors from the processor itself
      workletNodeRef.current.onprocessorerror = (event) => {
        console.error('[useTranscription] AudioWorkletProcessor error:', event);
        setError('Audio processor error occurred.');
        // Attempt cleanup if recording was active
        if (recording) {
            stop();
        }
      };

      // 4. Create MediaStreamSource if it doesn't exist
      if (!microphoneSourceRef.current) {
          microphoneSourceRef.current = audioCtxRef.current.createMediaStreamSource(streamRef.current);
          console.log('[useTranscription] MediaStreamSource created.');
      }

      // 5. Connect the nodes: Mic -> Worklet
      microphoneSourceRef.current.connect(workletNodeRef.current);
      console.log('[useTranscription] Nodes connected: Mic -> Worklet.');
      // Do NOT connect worklet to destination unless you want to hear raw mic input

      // 6. Initialize worker with SAB (no transfer list—SharedArrayBuffer is cloneable)
      if (workerRef.current && sabRef.current) {
        console.log('[useTranscription] Sending SAB reference to worker...');
        workerRef.current.postMessage({ type: 'init', data: { sab: sabRef.current } });
      } else {
         throw new Error('Worker or SharedArrayBuffer not available for initialization.');
      }

      // 7. Tell worker to start streaming (which now starts the pull loop)
      if (workerRef.current) {
          console.log('[useTranscription] Sending startStream command to worker...');
          workerRef.current.postMessage({ type: 'startStream' });
      }

      // 8. Update state
      setRecording(true);
      console.log('[useTranscription] Recording started successfully.');

    } catch (err) {
        console.error('[useTranscription] Error during start():', err);
        setError(`Failed to start recording: ${err.message}`);
        // Cleanup partially created resources
        workletNodeRef.current?.disconnect();
        workletNodeRef.current = null;
        // microphoneSourceRef is likely okay, managed by useEffect cleanup
        sabRef.current = null; // Ensure SAB ref is cleared
        setRecording(false);
    }

  }, [ready, recording]); // Dependencies: ready state, recording state

  const stop = useCallback(() => {
    console.log('[useTranscription] stop() called.');
    if (!recording) {
      console.warn('[useTranscription] Not recording.');
      return;
    }
    if (!workletNodeRef.current || !microphoneSourceRef.current) {
      console.error('[useTranscription] Audio nodes not available for stopping.');
      // Attempt to reset state anyway
      setRecording(false);
      return;
    }

    try {
      // 1. Disconnect nodes
      microphoneSourceRef.current.disconnect(workletNodeRef.current);
      console.log('[useTranscription] Nodes disconnected.');
      // No need to disconnect workletNode if it wasn't connected to destination

      // 2. Tell worker to flush and process
      if (workerRef.current) {
          console.log('[useTranscription] Sending flush command to worker...');
          workerRef.current.postMessage({ type: 'flush' });
          // Worker 'processing_start' message will set processing state
      } else {
          console.error('[useTranscription] Worker not available to send flush command.');
          setError('Worker connection lost before stopping.');
      }

      // 3. Update state
      setRecording(false);
      console.log('[useTranscription] Recording stopped.');

      // 4. Clean up WorkletNode (optional but good practice)
      // Note: We don't stop the MediaStream track here, 
      // the useEffect cleanup handles that when the component unmounts.
      // Re-creating the source/worklet node on next start is intended.
      workletNodeRef.current = null;
      sabRef.current = null; // SAB was transferred or will be garbage collected

    } catch (err) {
        console.error('[useTranscription] Error during stop():', err);
        setError(`Failed to stop recording cleanly: ${err.message}`);
        setRecording(false);
        // Ensure nodes are nullified even on error
        workletNodeRef.current = null;
        sabRef.current = null;
    }
  }, [recording]); // Dependency: recording state

  // Return the public interface
  return {
    recording,
    processing,
    ready,
    text, // Return cumulative text
    error,
    start,
    stop,
  };
} 
</usetranscription.ts>
<ringbuffer.ts>
    // This file will contain the RingBuffer implementation
// using SharedArrayBuffer and Atomics.

console.log("RingBuffer file loaded (placeholder)"); 

const MAX_RING_SECONDS = 10; // NEW - Target buffer duration

// Calculate capacity for 16kHz * MAX_RING_SECONDS
const SAMPLE_RATE_16K = 16000; // Define 16k constant
const RING_BUFFER_SAMPLE_CAPACITY = SAMPLE_RATE_16K * MAX_RING_SECONDS; // Use 16k for capacity

// Helper function to calculate byte length needed for RingBuffer
// Includes space for the atomic write index (Int32 = 4 bytes)
function getByteLength(capacity: number): number {
  return (capacity * Float32Array.BYTES_PER_ELEMENT) + 4;
}

const RING_BUFFER_SIZE_BYTES = getByteLength(RING_BUFFER_SAMPLE_CAPACITY);

/**
 * A Lock-Free Ring Buffer implementation using SharedArrayBuffer for
 * single-producer, single-consumer scenarios.
 *
 * The first 4 bytes (index 0) of the SAB store the write index (head) as an Int32.
 * The remaining bytes store the Float32 audio samples.
 */
export class RingBuffer {
  private readonly sab: SharedArrayBuffer;
  private readonly writeIndex: Int32Array; // Atomic view for the write index
  private readonly buffer: Float32Array; // View for the audio data
  private readonly capacity: number;

  // Used by the consumer (reader) to track its position
  private readIndex = 0;

  /**
   * Creates or wraps a SharedArrayBuffer for the RingBuffer.
   * @param sab Optional SharedArrayBuffer to wrap. If not provided, a new one is created.
   */
  constructor(sab?: SharedArrayBuffer) {
    this.capacity = RING_BUFFER_SAMPLE_CAPACITY;

    if (sab) {
      if (sab.byteLength !== RING_BUFFER_SIZE_BYTES) {
        throw new Error(
          `Provided SharedArrayBuffer has incorrect size. Expected ${RING_BUFFER_SIZE_BYTES}, got ${sab.byteLength}`
        );
      }
      this.sab = sab;
    } else {
      this.sab = new SharedArrayBuffer(RING_BUFFER_SIZE_BYTES);
    }

    // Index 0 holds the write pointer (head)
    this.writeIndex = new Int32Array(this.sab, 0, 1);
    // The rest holds the audio data (offset by 4 bytes)
    this.buffer = new Float32Array(this.sab, 4, this.capacity);
  }

  /**
   * Get the underlying SharedArrayBuffer. Needed to share with other threads.
   */
  getSharedArrayBuffer(): SharedArrayBuffer {
    return this.sab;
  }

  /**
   * Write audio frames from the producer (AudioWorklet).
   * This is lock-free due to Atomics.add.
   * @param frames The Float32Array containing audio frames to write.
   * @returns The number of frames successfully written.
   */
  write(frames: Float32Array): number {
    const availableWrite = this.capacity - this.availableRead();
    if (frames.length > availableWrite) {
      console.warn(`RingBuffer overflow: Tried to write ${frames.length}, but only ${availableWrite} available.`);
      // Optional: Could drop frames or overwrite oldest, for now just log.
      return 0; // Indicate nothing was written to prevent partial writes easily
    }

    // Get the current write position atomically
    // `Atomics.add` returns the *original* value before adding.
    // We add 0 to atomically get the current value, then manually add later.
    // This might seem complex, but ensures we get a consistent starting point before the write.
    // EDIT: Simpler approach - use Atomics.load, then copy, then Atomics.store if guaranteed single producer.
    // Sticking to Atomics.add as it's robust for adding length atomically IF we ensure no wrap-around read interference.
    // Let's refine: Atomically get current head, write, then atomically update head.

    const currentWriteIndex = Atomics.load(this.writeIndex, 0);
    const framesToCopy = frames.length;

    // Check for wrap-around
    const spaceToEnd = this.capacity - currentWriteIndex;
    if (framesToCopy <= spaceToEnd) {
      // No wrap-around needed
      this.buffer.set(frames, currentWriteIndex);
    } else {
      // Needs to wrap around
      const firstChunk = frames.subarray(0, spaceToEnd);
      const secondChunk = frames.subarray(spaceToEnd);
      this.buffer.set(firstChunk, currentWriteIndex);
      this.buffer.set(secondChunk, 0);
    }

    // Atomically update the write index, wrapping around if necessary
    const nextWriteIndex = (currentWriteIndex + framesToCopy) % this.capacity;
    Atomics.store(this.writeIndex, 0, nextWriteIndex);
    // console.log(`Wrote ${framesToCopy} frames. New write index: ${nextWriteIndex}`);

    // Notify potentially waiting reader (optional, depends on reader implementation)
    // Atomics.notify(this.writeIndex, 0, 1); // Notify one waiter

    return framesToCopy;
  }

 /**
   * Read available audio frames for the consumer.
   * Updates the internal read pointer.
   * @param targetBuffer Optional buffer to write into. If not provided, a new Float32Array is returned.
   * @returns The Float32Array containing the read frames, or null if targetBuffer was provided.
   */
  read(targetBuffer?: Float32Array): Float32Array | null {
    const available = this.availableRead();
    if (available === 0) {
      return targetBuffer ? null : new Float32Array(0); // Return empty if nothing to read
    }

    const framesToRead = targetBuffer ? Math.min(available, targetBuffer.length) : available;
    let result: Float32Array;

    if (targetBuffer) {
      result = targetBuffer.length >= framesToRead ? targetBuffer.subarray(0, framesToRead) : targetBuffer; // Use subarray if target is larger
    } else {
      result = new Float32Array(framesToRead);
    }


    // Check for wrap-around during read
    const spaceToEnd = this.capacity - this.readIndex;
    if (framesToRead <= spaceToEnd) {
      // No wrap-around
      result.set(this.buffer.subarray(this.readIndex, this.readIndex + framesToRead));
    } else {
      // Wraps around
      const firstChunk = this.buffer.subarray(this.readIndex, this.capacity);
      const secondChunk = this.buffer.subarray(0, framesToRead - spaceToEnd);
      result.set(firstChunk, 0);
      result.set(secondChunk, firstChunk.length);
    }

    // Update the read index
    this.readIndex = (this.readIndex + framesToRead) % this.capacity;
     // console.log(`Read ${framesToRead} frames. New read index: ${this.readIndex}`);

    return targetBuffer ? null : result; // Return the new array only if no target was given
  }

  /**
   * Returns the number of frames available to read.
   * This is lock-free due to Atomics.load.
   */
  availableRead(): number {
    const currentWriteIndex = Atomics.load(this.writeIndex, 0);
    if (currentWriteIndex >= this.readIndex) {
      // Write head is ahead of read head (no wrap-around)
      return currentWriteIndex - this.readIndex;
    } else {
      // Write head has wrapped around
      return this.capacity - this.readIndex + currentWriteIndex;
    }
  }

  /**
   * Returns the total capacity of the buffer in frames.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Resets the read and write pointers.
   * NOTE: Only call this when you are sure the producer is stopped!
   */
  reset(): void {
    Atomics.store(this.writeIndex, 0, 0);
    this.readIndex = 0;
    console.log("RingBuffer reset.");
  }

  /**
   * Static helper to calculate byte length based on sample capacity.
   */
  static getByteLength(capacity: number): number {
    return (capacity * Float32Array.BYTES_PER_ELEMENT) + 4;
  }
}

// Define constants for export if needed elsewhere
export const Constants = {
  MAX_RING_SECONDS, // Export MAX_RING_SECONDS
  RING_BUFFER_SAMPLE_CAPACITY,
  RING_BUFFER_SIZE_BYTES
}; 
</ringbuffer.ts>