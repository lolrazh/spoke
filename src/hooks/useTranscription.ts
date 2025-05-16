import { useRef, useState, useEffect, useCallback } from 'react';

// Constants (can be moved or adjusted)
const TARGET_AUDIO_CONTEXT_RATE = 16000; // Use 16kHz for AudioContext
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
  currentMode: 'local' | 'cloud';
  setMode: (mode: 'local' | 'cloud') => void;
}

// Helper function to encode Float32Array to WAV ArrayBuffer
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16; // 16-bit PCM
  const bytesPerSample = bitsPerSample / 8;

  const dataSize = samples.length * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize; // 44 bytes for header

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true); // fileSize - 8
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // blockAlign
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i])); // Clamp to [-1, 1]
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // Convert to 16-bit signed int
  }
  return buffer;
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
  const audioSampleRateRef = useRef<number>(TARGET_AUDIO_CONTEXT_RATE); // Store the sample rate

  // --- State Variables ---
  // const [stream, setStream] = useState<MediaStream | null>(null); // Use ref instead
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false); // True when audio capture system is ready
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // NEW: State for transcription mode
  const [currentMode, setCurrentMode] = useState<'local' | 'cloud'>('cloud'); // Default to cloud

  // Refs to track the latest state for potential callbacks (less critical now)
  const readyRef = useRef(ready);
  const processingRef = useRef(processing);
  const textRef = useRef(text); // Add a ref for the current text

  // Update refs whenever state changes
  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { processingRef.current = processing; }, [processing]);
  useEffect(() => { textRef.current = text; }, [text]); // Update textRef

  // --- 1️⃣ Boot local ASR worker (previously moonshine-worker) --- 
  useEffect(() => {
    if (workerRef.current) return;

    console.log('[useTranscription] Initializing local ASR worker (local-worker.ts)...');
    // IMPORTANT: Adjust the URL to the new worker path
    workerRef.current = new Worker(
      new URL('../workers/local-worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Initialize worker with SharedArrayBuffer once available (see step 2)
    // This will be handled after AudioContext and SAB are created.

    // Cleanup
    return () => {
      console.log('[useTranscription] Terminating local ASR worker.');
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- 2️⃣ Ask for mic & create AudioContext & SAB once --- 
  useEffect(() => {
    (async () => {
      if (audioCtxRef.current) return; // Already initialized

      console.log('[useTranscription] Requesting microphone access and preparing AudioContext/SAB...');
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: TARGET_AUDIO_CONTEXT_RATE } // Request target rate
        });
        console.log('[useTranscription] Microphone access granted.');

        audioCtxRef.current = new AudioContext({ sampleRate: TARGET_AUDIO_CONTEXT_RATE });
        audioSampleRateRef.current = audioCtxRef.current.sampleRate; // Store the actual sample rate
        console.log(`[useTranscription] AudioContext created (Rate: ${audioSampleRateRef.current}Hz).`);

        // Create SharedArrayBuffer for RingBuffer in the worker
        // Capacity based on RingBuffer's internal constants (e.g., 10 seconds at 16kHz)
        // This needs to match what RingBuffer expects or be configurable.
        // For now, let's assume RingBuffer.Constants.RING_BUFFER_SIZE_BYTES can be imported or known.
        // Let's use a placeholder size if not directly importable here.
        // RingBuffer constructor in worker can also create it if no SAB is passed, but we want to create it here.
        // The RingBuffer class itself defines RING_BUFFER_SAMPLE_CAPACITY.
        // static getByteLength(capacity: number): number { return (capacity * Float32Array.BYTES_PER_ELEMENT) + 4; }
        // const RING_BUFFER_SAMPLE_CAPACITY = 16000 * 10; // 10 seconds at 16kHz
        // const sabSizeBytes = (RING_BUFFER_SAMPLE_CAPACITY * Float32Array.BYTES_PER_ELEMENT) + 4;
        // This logic should ideally use the same constants as RingBuffer.ts to avoid mismatch.
        // For now, let worker handle SAB creation if none is passed, or ensure size matches.
        // The `local-worker.ts` expects a SAB. Let's use a known size from `RingBuffer.ts` (16000 * 10 samples)
        const sabCapacity = 16000 * 10; // samples for 10 seconds
        const sabSizeBytes = (sabCapacity * Float32Array.BYTES_PER_ELEMENT) + Int32Array.BYTES_PER_ELEMENT;

        sabRef.current = new SharedArrayBuffer(sabSizeBytes);
        console.log(`[useTranscription] SharedArrayBuffer created (${sabSizeBytes} bytes).`);

        // Now, init the worker with the SAB
        if (workerRef.current && sabRef.current) {
            workerRef.current.postMessage({ 
                type: 'init', 
                data: { sab: sabRef.current }
            });
        } else {
            console.error("[useTranscription] Worker or SAB not ready for init message.");
            setError("Failed to initialize worker with audio buffer.");
        }

      } catch (err) {
        console.error("[useTranscription] Microphone access or AudioContext/SAB creation error:", err);
        setError('Microphone permissions denied or AudioContext/SAB failed.');
        streamRef.current = null;
      }
    })();

    // Cleanup (already handles stream and AudioContext)
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
  }, []);

  // --- 3️⃣ Worker Message Handler (from local-worker.ts) --- 
  useEffect(() => {
    if (!workerRef.current) return;

    const onMessageReceived = async (e: MessageEvent) => {
      console.log(`[useTranscription] ${currentMode}-worker message:`, e.data);
      const status = e.data?.status;
      const workerError = e.data?.error;
      const transcription = e.data?.transcription; // From local worker
      const audioSamples = e.data?.samples as Float32Array; // From local worker for cloud path
      const audioSampleRate = e.data?.sampleRate as number; // From local worker for cloud path

      switch (status) {
        case 'loading': // Local ASR model loading
          if (currentMode === 'local') {
            setReady(false);
            setProcessing(true);
            setError(null);
            setText('');
          } else {
            console.log('[useTranscription] Local ASR model loading, but in cloud mode. Ignoring ready/processing state for this.');
          }
          break;
        case 'sab_initialized':
          console.log('[useTranscription] Worker confirmed SAB initialization. Capture system getting ready.');
          // This is a good point to consider the capture part of the worker 'ready'
          // If not relying on local ASR model, setReady(true) here or after mic access.
          // For now, local ASR model 'ready' below will set the main ready state.
          // If primary is cloud, we need a different readiness signal for capture.
          setReady(true); // Let's assume SAB init + mic = ready for capture
          break;
        case 'ready': // Local ASR Model in worker is ready
          if (currentMode === 'local') {
            setReady(true);
            setProcessing(false);
            setError(null);
            console.log('[useTranscription] Local ASR worker model ready.');
          } else {
             // If in cloud mode, local model readiness is secondary. Capture readiness is primary.
             console.log('[useTranscription] Local ASR model ready (for potential fallback).');
             // setReady(true); // Ensure ready is true if depending on this for capture readiness.
          }
          break;
        case 'capture_started':
            console.log('[useTranscription] Worker confirmed capture started.');
            break;
        case 'processing_full_audio': // Local worker processing audio
            if (currentMode === 'local') {
                console.log('[useTranscription] Local worker is processing full audio.');
                setProcessing(true);
            }
            break;
        case 'completed': // Local transcription completed
          if (currentMode === 'local') {
            if (typeof transcription === 'string') {
              console.log(`[useTranscription] Local transcription received: "${transcription.substring(0,100)}..."`);
              setText(transcription);
              if (transcription && window.electron?.insertTextAtCursor) {
                 window.electron.insertTextAtCursor(transcription)
                   .catch(err => console.error('[useTranscription] Error inserting local transcript:', err));
              }
            } else {
              console.warn('[useTranscription] Received local completed status without transcription text.');
              setText('');
            }
            setProcessing(false);
          } else {
            console.log("[useTranscription] Received local 'completed' message while in cloud mode. Ignoring.");
          }
          break;
        case 'final-audio-samples': // Received raw samples from worker (for cloud mode)
          if (currentMode === 'cloud') {
            if (audioSamples && audioSamples.length > 0 && audioSampleRate) {
              console.log(`[useTranscription] Received final audio samples (${audioSamples.length}) at ${audioSampleRate}Hz. Encoding to WAV for Groq.`);
              setProcessing(true);
              setError(null);
              setText('');

              try {
                const wavBuffer = encodeWAV(audioSamples, audioSampleRate);
                console.log(`[useTranscription] WAV buffer created (${wavBuffer.byteLength} bytes). Sending to Groq.`);
                
                if (window.electron && window.electron.transcribeGroq) {
                  const cloudTranscript = await window.electron.transcribeGroq(wavBuffer);
                  console.log(`[useTranscription] Groq transcript received: "${cloudTranscript.substring(0, 100)}..."`);
                  setText(cloudTranscript);
                  if (cloudTranscript && window.electron.insertTextAtCursor) {
                     window.electron.insertTextAtCursor(cloudTranscript)
                       .catch(err => console.error('[useTranscription] Error inserting Groq text:', err));
                  }
                } else {
                  throw new Error('Groq transcription service not available on window.electron.');
                }
              } catch (cloudError: any) {
                console.error('[useTranscription] Groq transcription or WAV encoding failed:', cloudError);
                setError(cloudError.message || 'Cloud transcription failed.');
                setText('');
              } finally {
                setProcessing(false);
              }
            } else {
              console.warn('[useTranscription] Received invalid audio samples or sample rate from worker for cloud mode.');
              setError('Failed to retrieve audio for cloud transcription.');
              setProcessing(false);
            }
          } else {
            console.warn("[useTranscription] Received 'final-audio-samples' while in local mode. This is unexpected.");
          }
          break;
        case 'error': 
          setError(String(workerError || 'Audio worker error'));
          setProcessing(false);
          // Consider if ready should be set to false. If worker fails, capture might not be possible.
          setReady(false); 
          break;
        default:
          console.warn('[useTranscription] Unknown worker status:', status, e.data);
          break;
      }
    };

    workerRef.current.addEventListener('message', onMessageReceived);

    return () => {
      console.log('[useTranscription] Removing local-worker message listener.');
      workerRef.current?.removeEventListener('message', onMessageReceived);
    };
  // }, []); // Original: No dependency on window.electron for listener itself
  // Re-evaluating dependencies: workerRef changes, but it's stable after first mount.
  // Adding window.electron to dependencies if its methods are called directly within this effect,
  // though they are called from within a message handler.
  // For now, keeping it simple. If `window.electron` itself could change, it should be a dependency.
  }, [/* workerRef is stable, window.electron assumed stable for now */]);

  // --- 4️⃣ Public API ---
  const start = useCallback(async () => {
    console.log('[useTranscription] start() called. Mode:', currentMode);
    if (recording) {
      console.warn('[useTranscription] Already recording.');
      return;
    }

    // Readiness check: AudioContext, Mic Stream, SAB should be ready.
    // For local mode, worker model (`ready` state from worker) must also be true.
    // For cloud mode, worker only needs to be ready for capture (SAB initialized).
    let captureSystemReady = audioCtxRef.current && streamRef.current && sabRef.current;
    let overallReady = captureSystemReady && (currentMode === 'cloud' ? ready : (ready && workerRef.current)); // `ready` state for local model

    if (!overallReady) {
      const notReadyReason = !audioCtxRef.current ? 'AudioContext' :
                             !streamRef.current ? 'Microphone stream' :
                             !sabRef.current ? 'SharedAudioBuffer' :
                             (currentMode === 'local' && !ready) ? 'Local ASR model' :
                             'Audio capture system';
      console.warn(`[useTranscription] Cannot start: ${notReadyReason} not ready.`);
      setError(`Cannot start recording: ${notReadyReason} not ready. Check permissions and logs.`);
      return;
    }

    if (audioCtxRef.current.state === 'suspended') {
      console.log('[useTranscription] Resuming AudioContext...');
      await audioCtxRef.current.resume();
    }

    setError(null);
    setText(''); // Clear previous transcription
    
    try {
      // Ensure AudioWorklet processor is added
      // Path should point to the file in the public directory
      const workletPath = '/audioworklet-processor.js'; // Relative to the public root
      
      // Check if already added to prevent errors
      if (!workletNodeRef.current) { 
          console.log('[useTranscription] Adding AudioWorklet module:', workletPath);
          // For files in public dir, addModule usually takes the direct path
          await audioCtxRef.current.audioWorklet.addModule(workletPath);
          console.log('[useTranscription] AudioWorklet module added.');
      } else {
          console.log('[useTranscription] AudioWorklet module already added or active.');
      }

      microphoneSourceRef.current = audioCtxRef.current.createMediaStreamSource(streamRef.current);
      // Ensure the name matches the one registered in audioworklet-processor.js
      workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'capture-processor', {
          processorOptions: { sab: sabRef.current }
      });
      microphoneSourceRef.current.connect(workletNodeRef.current);
      
      workerRef.current?.postMessage({ type: 'start-capture' });
      
      setRecording(true);
      console.log('[useTranscription] Recording started. AudioWorklet connected and worker notified.');

    } catch (err) {
      console.error('[useTranscription] Error starting recording or AudioWorklet setup:', err);
      setError(`Failed to start recording: ${err.message}`);
      setRecording(false);
      // Cleanup partial setup if error occurs mid-way
      if (microphoneSourceRef.current) microphoneSourceRef.current.disconnect();
      if (workletNodeRef.current) workletNodeRef.current.disconnect();
      microphoneSourceRef.current = null;
      workletNodeRef.current = null;
    }
  }, [recording, ready, currentMode, audioCtxRef, streamRef, sabRef, workerRef]);

  const stop = useCallback(async () => {
    console.log('[useTranscription] stop() called. Mode:', currentMode);
    if (!recording) {
      console.warn('[useTranscription] Not recording, cannot stop.');
      return;
    }

    setRecording(false);
    // Processing state will be managed by message handlers or subsequent async operations

    console.log('[useTranscription] Stopping recording. Disconnecting AudioWorklet and notifying worker.');

    if (microphoneSourceRef.current) {
      microphoneSourceRef.current.disconnect();
      microphoneSourceRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (workerRef.current) {
      if (currentMode === 'cloud') {
        console.log(`[useTranscription] Requesting final audio samples from worker for cloud transcription (SR: ${audioSampleRateRef.current}Hz).`);
        workerRef.current.postMessage({ 
            type: 'get-final-audio-samples', // New message type for worker
            data: { sampleRate: audioSampleRateRef.current }
        });
        setProcessing(true); // Indicate processing starts for cloud path
      } else { // local mode
        console.log(`[useTranscription] Sending 'stop-capture-and-transcribe' to local worker (SR: ${audioSampleRateRef.current}Hz).`);
        workerRef.current.postMessage({ 
            type: 'stop-capture-and-transcribe',
            data: { sampleRate: audioSampleRateRef.current } 
        });
        // For local, worker will send 'processing_full_audio' and then 'completed' or 'error'
      }
    } else {
        console.error("[useTranscription] Worker not available to stop capture.");
        setError("Failed to send stop signal to transcription worker.");
        setProcessing(false);
    }
  }, [recording, currentMode, audioSampleRateRef, workerRef]);

  // Method to change mode
  const setMode = useCallback((mode: 'local' | 'cloud') => {
    console.log(`[useTranscription] Setting mode to: ${mode}`);
    setCurrentMode(mode);
    // Optionally, reset states if needed when mode changes
    // setText('');
    // setError(null);
    // setProcessing(false);
    // setReady(mode === 'local' ? readyRef.current : true); // Cloud mode might be considered 'ready' if Groq API is up.
                                                          // Local model readiness is tracked by 'ready' state.
  }, []);

  // Return the public interface
  return {
    recording,
    processing,
    ready,
    text, // Return cumulative text
    error,
    start,
    stop,
    currentMode, // Expose current mode
    setMode,     // Expose method to set mode
  };
}

// Augment the Window interface if not already done globally (e.g., in a .d.ts file)
// This is often in a file like 'electron.d.ts' or similar for Electron projects.
// interface Window {
//   electron?: {
//     toggleDictation: (callback: () => void) => () => void;
//     showPillContextMenu: () => void;
//     insertTextAtCursor: (text: string) => Promise<void>; // Original was Promise<void>
//     viewLogFile: () => Promise<string | null>;
//     sendNotification: (message: string) => void;
//     transcribeGroq: (audioBuffer: ArrayBuffer) => Promise<string>; 
//   };
// }

// Mock for environments where window.electron might not be fully defined (e.g. web testing)
// This should align with the interface Window.electron expected by the hook.
if (typeof window !== 'undefined' && !(window as any).electron) {
  console.log('[useTranscription] Mocking window.electron API for development/testing.');
  (window as any).electron = {
    toggleDictation: (callback: () => void) => {
      console.log('[Mock Electron] toggleDictation called');
      // Call the callback to simulate toggle if needed for testing UI state
      // callback(); 
      return () => console.log('[Mock Electron] cleanup toggleDictation');
    },
    showPillContextMenu: () => {
      console.log('[Mock Electron] showPillContextMenu called');
    },
    insertTextAtCursor: async (text: string) => {
      console.log(`[Mock Electron] insertTextAtCursor called with: "${text.substring(0, 50)}..."`);
      // return Promise.resolve(); // Original was Promise<void>
      return { success: true }; // If the expected type is Promise<{success: boolean; error?: string;}>
    },
    viewLogFile: async () => {
      console.log('[Mock Electron] viewLogFile called');
      return Promise.resolve("Mock log file content");
    },
    sendNotification: (message: string) => {
      console.log(`[Mock Electron] sendNotification called with: "${message}"`);
    },
    transcribeGroq: async (audioBuffer: ArrayBuffer): Promise<string> => {
      console.warn('[Mock Electron] transcribeGroq called with ArrayBuffer (length: '+audioBuffer.byteLength+'). This should be an Electron IPC call.');
      return new Promise(resolve => setTimeout(() => {
        resolve("Mocked Groq transcript from window.electron mock.");
      }, 500));
    }
  };
} 