import { useRef, useState, useEffect, useCallback } from 'react';

// Constants (can be moved or adjusted)
const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH_SECONDS = 30; 
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH_SECONDS;

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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]); // Store chunks in a ref

  // --- State Variables (Mirrors example App.jsx state) ---
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false); // Corresponds to example's isProcessing
  const [ready, setReady] = useState(false); // Corresponds to example's status === 'ready'
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // TODO: Add state for loading messages/progress if needed for UI
  // const [loadingMessage, setLoadingMessage] = useState('');
  // const [progressItems, setProgressItems] = useState([]);

  // Refs to track the latest state for the stale closure in onstop
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
      new URL('../whisper-worker.ts', import.meta.url),
      { type: 'module' }
    );

    const onMessageReceived = (e: MessageEvent) => {
      console.log('[useTranscription] Worker message:', e.data); // Debug
      const { status, data, output, error: workerError, processingTime } = e.data;

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
              if (processingTime) {
                  console.log(`[useTranscription] Worker processing time: ${processingTime.toFixed(2)} ms`);
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

  // --- 2️⃣ Ask for mic & build MediaRecorder once --- 
  useEffect(() => {
    // Use an async IIFE to handle async operations in useEffect
    (async () => {
      if (stream || recorderRef.current) return; // Already initialized

      console.log('[useTranscription] Requesting microphone access...');
      try {
        const streamInstance = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(streamInstance); // Save stream for potential visualizer

        // Create AudioContext AFTER getting stream
        // Use desired sample rate for processing, not necessarily for recording device
        audioCtxRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });

        // Create MediaRecorder
        const recorder = new MediaRecorder(streamInstance);
        recorderRef.current = recorder;

        // Event Handlers (Similar to example App.jsx)
        recorder.onstart = () => {
            console.log('[useTranscription] Recording started.');
            audioChunksRef.current = []; // Clear previous chunks
            setRecording(true);
            setError(null);
        };

        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
                console.log(`[useTranscription] Chunk received: ${event.data.size} bytes`);
            } else {
                console.warn('[useTranscription] Empty chunk received.');
            }
            // Note: Unlike example, we process on STOP, not every chunk
        };

        recorder.onstop = async () => {
            console.log('[useTranscription] Recording stopped.');
            setRecording(false);
            
            if (audioChunksRef.current.length === 0) {
                console.warn('[useTranscription] No audio data recorded.');
                return;
            }
            if (!readyRef.current || processingRef.current) {
                console.warn(`[useTranscription] Worker not ready (ready=${readyRef.current}) or already processing (processing=${processingRef.current}), skipping transcription.`);
                return;
            }

            console.time('e2e-transcription');
            try {
                // setProcessing(true); // *** REMOVE THIS LINE ***
                
                // Combine chunks into a single Blob
                const audioBlob = new Blob(audioChunksRef.current, {
                    type: recorderRef.current?.mimeType || 'audio/webm', // Use recorded mime type
                });
                audioChunksRef.current = []; // Clear chunks immediately

                console.log(`[useTranscription] Processing Blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

                // --- Replicate audio processing from example App.jsx --- 
                const arrayBuffer = await audioBlob.arrayBuffer();

                if (!audioCtxRef.current) {
                     throw new Error("AudioContext not available");
                }

                const decoded = await audioCtxRef.current.decodeAudioData(arrayBuffer);
                let audio = decoded.getChannelData(0); // Get mono channel
                
                // Trim audio if longer than max duration (from example)
                if (audio.length > MAX_SAMPLES) { 
                    console.log(`[useTranscription] Trimming audio from ${audio.length} to ${MAX_SAMPLES} samples.`);
                    audio = audio.slice(-MAX_SAMPLES);
                }
                // --- End audio processing --- 

                console.log(`[useTranscription] Sending ${audio.length} samples to worker...`);
                // Send processed audio to worker
                workerRef.current?.postMessage({ 
                    type: 'generate', 
                    data: { audio: audio, language: 'en' } // Pass language (can be made dynamic)
                });
                // Note: setProcessing will now be handled by worker 'start' message

            } catch(err) {
                console.error("[useTranscription] Error processing audio on stop:", err);
                setError("Failed to process recorded audio.");
                setProcessing(false);
                console.timeEnd('e2e-transcription');
            }
        };
        
        recorder.onerror = (event) => {
            console.error("[useTranscription] MediaRecorder error:", event);
            setError("An error occurred during recording.");
            setRecording(false);
        };

      } catch (err) {
        console.error("[useTranscription] Microphone access error:", err);
        setError('Microphone permissions denied or unavailable.');
        setStream(null);
      }
    })(); // Immediately invoke the async function

    // Cleanup function for the useEffect
    return () => {
      console.log('[useTranscription] Cleaning up media stream and recorder.');
      recorderRef.current?.stop(); // Stop recorder if active
      stream?.getTracks().forEach(track => track.stop()); // Stop stream tracks
      audioCtxRef.current?.close().catch(console.error); // Close AudioContext
      recorderRef.current = null;
      audioCtxRef.current = null;
      setStream(null);
    };
  }, []); // <-- Make dependency array empty to run only once on mount


  // --- 4️⃣ Public API --- 
  const start = useCallback(() => {
    if (!recorderRef.current || !ready) {
      console.warn('[useTranscription] Cannot start: Recorder not ready or worker not ready.');
      setError(ready ? 'Recorder not initialized.' : 'Transcription engine not ready.');
      return;
    }
    if (recording) {
        console.warn('[useTranscription] Already recording.');
        return;
    }
    // Start recording
    recorderRef.current.start(); // onstart handler sets recording state
  }, [ready, recording]);

  const stop = useCallback(() => {
    if (!recorderRef.current || !recording) {
      console.warn('[useTranscription] Cannot stop: Not recording or recorder not ready.');
      return;
    }
     // Stop recording
    recorderRef.current.stop(); // onstop handler sets state and processes audio
  }, [recording]);

  // Return the state and control functions
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