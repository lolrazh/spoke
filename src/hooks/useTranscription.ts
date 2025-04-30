import { useRef, useState, useEffect, useCallback } from 'react';

// Constants (can be moved or adjusted)
const TARGET_AUDIO_CONTEXT_RATE = 48000; // Use 48kHz for AudioContext
const WHISPER_SAMPLING_RATE = 16_000; // Keep for potential reference, but worker handles resampling
const MAX_AUDIO_LENGTH_SECONDS = 30;
// MAX_SAMPLES calculation might not be needed here anymore if worker handles clipping

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
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
      // Assuming worker is in the same dir or adjust path
      new URL('../moonshine-worker.ts', import.meta.url),
      { type: 'module' }
    );

    const onMessageReceived = (e: MessageEvent) => {
      console.log('[useTranscription] Worker message:', e.data); // Debug
      const { status, data, output, error: workerError, timings } = e.data;

      // TODO: Replicate the switch-case logic from example App.jsx 
      //       to update state variables (ready, processing, text, error, progress etc.)
      switch (status) {
          case 'loading':
              setReady(false);
              setProcessing(true); // Indicate loading activity
              // setLoadingMessage(data);
              break;
          case 'initiate':
              // Handle progress items if needed
              break;
          case 'progress':
              // Handle progress items if needed
              break;
          case 'done':
              // Handle progress items if needed
              break;
          case 'ready':
              setReady(true);
              setProcessing(false);
              setError(null);
              console.log('[useTranscription] Worker ready.');
              // Maybe trigger first recording automatically like example?
              // start(); // Or handle this via external call
              break;
          case 'start':
              setProcessing(true);
              setText('');
              break;
          case 'update':
              // Handle partial updates if needed (e.g., tokens per second)
              break;
          case 'complete':
              setProcessing(false);
              let transcript = '';
              if (output && Array.isArray(output)) {
                  transcript = output.join(' ').trim();
              } else if (typeof output === 'string') {
                  transcript = output.trim();
              }
              setText(transcript);
              console.timeEnd('e2e-transcription');
              
              // Log granular timings if available
              if (timings) { 
                  console.log(`[useTranscription] Worker Timings: 
    Total: ${timings.total?.toFixed(2)} ms
    Feature Extraction: ${timings.featureExtraction?.toFixed(2)} ms
    Model Generation: ${timings.modelGeneration?.toFixed(2)} ms
    Decoding: ${timings.decoding?.toFixed(2)} ms`);
              } else if (e.data.processingTime) { // Fallback just in case
                   console.log(`[useTranscription] Worker processing time: ${e.data.processingTime.toFixed(2)} ms`);
              }
              break;
          case 'error': // From custom error handling
          case 'init-error': // From worker
              setError(String(workerError || data || 'Worker error'));
              setProcessing(false);
              setReady(false); // Model is not ready if init failed
              console.timeEnd('e2e-transcription');
              break;
          default:
              console.warn('[useTranscription] Unknown worker status:', status);
              break;
      }
    };
    
    workerRef.current.addEventListener('message', onMessageReceived);

    // Send initial load message
    workerRef.current.postMessage({ type: 'load' });

    // Cleanup
    return () => {
      console.log('[useTranscription] Terminating worker.');
      workerRef.current?.removeEventListener('message', onMessageReceived);
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
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
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

  // --- 3️⃣ Worker Message Handler --- (Existing useEffect, but update message cases) 
  useEffect(() => {
    if (!workerRef.current) return;

    const onMessageReceived = (e: MessageEvent) => {
      console.log('[useTranscription] Worker message:', e.data); // Debug
      // Assuming status is always present
      const status = e.data?.status;
      const output = e.data?.output;
      const workerError = e.data?.error;
      const timings = e.data?.timings;

      switch (status) {
        case 'loading':
          setReady(false);
          setProcessing(true); // Indicate loading activity
          setError(null);
          break;
        // case 'initiate': // Not used currently
        // case 'progress': // Not used currently
        // case 'done': // Not used currently
        //   break;
        case 'ready': // Worker is initialized and warmed up
          setReady(true);
          setProcessing(false);
          setError(null);
          console.log('[useTranscription] Worker ready.');
          break;
        // --- NEW/UPDATED STATUSES ---
        case 'worker_initialized': // Optional: Confirmation worker got SAB
           console.log('[useTranscription] Worker confirmed RingBuffer init.');
           break;
        case 'streaming_started': // Worker confirms it started the pull loop
            console.log('[useTranscription] Worker confirmed streaming started.');
            // Might not need state change here, recording state is set in start()
            break;
        case 'processing_start': // Worker is starting the ASR pipeline
            console.log('[useTranscription] Worker started ASR processing.');
            setProcessing(true);
            setText(''); // Clear previous text
            console.time('e2e-transcription'); // Start timer here
            break;
        // --- END NEW/UPDATED ---
        // case 'update': // Not used currently
        //   break;
        case 'complete': // Transcription finished
          setProcessing(false);
          let transcript = '';
          if (typeof output === 'string') {
            transcript = output.trim();
          }
          setText(transcript);
          console.timeEnd('e2e-transcription'); // Stop timer here
          if (timings) {
            console.log(`[useTranscription] Worker Timings: Total: ${timings.total?.toFixed(2)} ms`);
          } else {
             console.warn("[useTranscription] No timing info received from worker.");
          }
          break;
        case 'error': // Generic worker error or ASR error
        case 'init-error': // Worker initialization failed
          setError(String(workerError || 'Worker error'));
          setProcessing(false);
          setReady(false); // Ensure ready is false on error
          console.timeEnd('e2e-transcription'); // Ensure timer stops on error
          break;
        default:
          console.warn('[useTranscription] Unknown worker status:', status);
          break;
      }
    };

    workerRef.current.addEventListener('message', onMessageReceived);

    // Send initial load message (removed, worker loads automatically)
    // workerRef.current.postMessage({ type: 'load' });

    // Cleanup
    return () => {
      console.log('[useTranscription] Removing worker message listener.');
      workerRef.current?.removeEventListener('message', onMessageReceived);
      // Worker termination is handled in the first useEffect
    };
  }, []); // Run only once

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

    setError(null); // Clear previous errors
    setText(''); // Clear previous text

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

      // 1. Create SharedArrayBuffer (only if check passes)
      // Dynamically import RingBuffer constants to get size
      const { Constants } = await import('../audio/ring-buffer.js');
      sabRef.current = new SharedArrayBuffer(Constants.RING_BUFFER_SIZE_BYTES);
      console.log(`[useTranscription] SharedArrayBuffer created (${sabRef.current.byteLength} bytes).`);

      // 2. Add AudioWorklet module (ensure path is correct relative to build output)
      // Try using a relative path assuming it's sibling to index.html in output
      const workletURL = './audioworklet-processor.js'; 
      try {
          console.log(`[useTranscription] Attempting to load worklet from: ${workletURL}`);
          await audioCtxRef.current.audioWorklet.addModule(workletURL);
          console.log('[useTranscription] AudioWorklet module added successfully.');
      } catch (err) {
          console.error(`[useTranscription] Failed to add AudioWorklet module from ${workletURL}:`, err);
          // Try the absolute path as a fallback just in case
          const fallbackWorkletURL = '/audioworklet-processor.js';
          console.log(`[useTranscription] Retrying with fallback path: ${fallbackWorkletURL}`);
          try {
              await audioCtxRef.current.audioWorklet.addModule(fallbackWorkletURL);
              console.log('[useTranscription] AudioWorklet module added successfully via fallback path.');
          } catch (fallbackErr) {
             console.error(`[useTranscription] Failed to add AudioWorklet module from fallback path ${fallbackWorkletURL}:`, fallbackErr);
             throw new Error(`Failed to load audio processor. ${fallbackErr.message}`); // Throw the final error
          }
      }

      // 3. Create AudioWorkletNode, passing the SAB
      workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'capture-processor', {
        processorOptions: { sab: sabRef.current }
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

      // 6. Initialize worker with SAB (transferring ownership)
      if (workerRef.current && sabRef.current) {
        console.log('[useTranscription] Sending SAB to worker...');
        workerRef.current.postMessage({ type: 'init', data: { sab: sabRef.current } }, [sabRef.current]);
      } else {
         throw new Error('Worker or SharedArrayBuffer not available for initialization.');
      }

      // 7. Tell worker to start pulling audio
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
    text,
    error,
    start,
    stop,
  };
} 