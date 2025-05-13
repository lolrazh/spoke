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
  const textRef = useRef(text); // Add a ref for the current text

  // Update refs whenever state changes
  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { processingRef.current = processing; }, [processing]);
  useEffect(() => { textRef.current = text; }, [text]); // Update textRef

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
                console.log(`[useTranscription] Received partial text delta: \"${partialDelta}\"`);
                // Append delta to internal state
                setText(prev => (prev + ' ' + partialDelta).trim());
            }
            break;
        case 'complete':
            const finalText = e.data?.text as string; 
            if (typeof finalText === 'string') {
                console.log(`[useTranscription] Received final text: \"${finalText}\"`);
                
                setText(prev => {
                    const accumulatedText = (prev + ' ' + finalText).trim();
                    // Log the text that will actually be used for insertion
                    console.log(`[useTranscription] Accumulated text for final insertion: \"${accumulatedText}\"`);

                    if (accumulatedText && window.electron) {
                        window.electron.insertTextAtCursor(accumulatedText) 
                            .catch(err => console.error(`[useTranscription] Error inserting final text:`, err));
                    } else if (!accumulatedText) {
                       console.log('[useTranscription] Final accumulated text is empty, skipping paste.');
                    }
                    return accumulatedText;
                });
            }
            // The log using textRef.current has been removed as the one inside setText is more immediate for this action,
            // and App.tsx will show the final state post-render.
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
    textRef.current = ''; // Also clear textRef on start

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