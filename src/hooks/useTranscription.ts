import { useRef, useState, useEffect, useCallback } from 'react';

// Constants (can be moved or adjusted)
const TARGET_AUDIO_CONTEXT_RATE = 16000; // Use 16kHz for AudioContext
// MAX_SAMPLES calculation might not be needed here anymore if worker handles clipping

// --- Text Diffing Helper Functions (copied from local-worker.ts) ---
/** Longest suffix of `prev` that is a prefix of `next` */
function overlapLen(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length);
  for (let len = max; len > 0; len--) {
    if (prev.endsWith(next.slice(0, len))) return len;
  }
  return 0;
}

/** Drop duplicate overlap and concatenate */
function mergeWithOverlap(prev: string, next: string): { merged: string, overlapLength: number } {
  const p = prev.trim();
  const n = next.trim();
  const o = overlapLen(p, n);
  let mergedText;
  if (p && n) {
    if (o > 0) {
      mergedText = (p + n.slice(o));
    } else {
      mergedText = (p + " " + n);
    }
  } else if (n) {
    mergedText = n;
  } else {
    mergedText = p;
  }
  return { merged: mergedText.replace(/\s+/g, " ").trim(), overlapLength: o };
}

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
  // --- Refs for local ASR (AudioWorklet, SAB, local-worker) --
  const localWorkerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null); // For local AudioWorklet path
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sabRef = useRef<SharedArrayBuffer | null>(null);
  const localAudioSampleRateRef = useRef<number>(TARGET_AUDIO_CONTEXT_RATE);

  // --- Refs for Cloud ASR (MediaRecorder) --
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // --- Common Refs --
  const streamRef = useRef<MediaStream | null>(null); // Mic stream, shared by both modes
  const profilingStartTimeRef = useRef<number | null>(null); // For profiling E2E latency

  // --- State Variables --
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false); // General readiness. Mic access is a key part.
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<'local' | 'cloud'>('local'); // Default to local mode

  // Refs to track the latest state for potential callbacks
  const readyRef = useRef(ready);
  const processingRef = useRef(processing);
  const textRef = useRef(text);

  // Update refs whenever state changes
  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { processingRef.current = processing; }, [processing]);
  useEffect(() => { textRef.current = text; }, [text]);

  // --- Effects for Mic Permission (runs for both modes initially) --
  useEffect(() => {
    (async () => {
      if (streamRef.current) return; // Mic stream already obtained
      console.log('[useTranscription] Requesting microphone access...');
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              sampleRate: 16000, // Target 16kHz
              channelCount: 1,   // Mono audio
              // bitsPerSample: 16, // Often implied by other settings, Safari might need it. Let's omit for now unless issues arise.
              echoCancellation: false, // Lower CPU, potentially cleaner for ASR if environment is controlled
              noiseSuppression: false, // Lower CPU, ASR models often handle noise
            }
        });
        console.log('[useTranscription] Microphone access granted.');
        setReady(true); // Basic readiness: mic is available.
      } catch (err) {
        console.error("[useTranscription] Microphone access error:", err);
        setError('Microphone permissions denied or microphone not available.');
        setReady(false);
      }
    })();
    // Cleanup mic stream when component unmounts
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      console.log('[useTranscription] Microphone stream stopped on unmount.');
    };
  }, []);

  // --- Effects for LOCAL ASR WORKER setup (only if mode is local) --
  useEffect(() => {
    if (currentMode === 'local' && !localWorkerRef.current) {
      console.log('[useTranscription] Local mode: Initializing local ASR worker, AudioContext, SAB...');
      
      // Initialize AudioContext for local path
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: TARGET_AUDIO_CONTEXT_RATE });
        localAudioSampleRateRef.current = audioCtxRef.current.sampleRate;
        console.log(`[useTranscription] Local AudioContext created (Rate: ${localAudioSampleRateRef.current}Hz).`);
      }

      // Initialize SAB for local path
      if (!sabRef.current && typeof SharedArrayBuffer !== 'undefined') {
        const sabCapacity = 16000 * 10; // samples for 10 seconds (as in local-worker)
        const sabSizeBytes = (sabCapacity * Float32Array.BYTES_PER_ELEMENT) + Int32Array.BYTES_PER_ELEMENT;
        sabRef.current = new SharedArrayBuffer(sabSizeBytes);
        console.log(`[useTranscription] Local SharedArrayBuffer created (${sabSizeBytes} bytes).`);
      } else if (typeof SharedArrayBuffer === 'undefined') {
        console.error('[useTranscription] Local mode: SharedArrayBuffer is not supported. Local ASR will not work.');
        setError('SharedArrayBuffer not supported, local ASR disabled.');
        return; // Cannot proceed with local setup
      }

      // Initialize Local Worker
      localWorkerRef.current = new Worker(
        new URL('../workers/local-worker.ts', import.meta.url),
        { type: 'module' }
      );
      console.log('[useTranscription] Local ASR worker instance created.');

      // Send INIT message to local worker with SAB
      if (sabRef.current) {
        localWorkerRef.current.postMessage({ 
            type: 'init', 
            data: { sab: sabRef.current }
        });
      } else {
        console.error("[useTranscription] Local SAB not ready for init message to worker.");
        setError("Failed to initialize local worker with audio buffer.");
        localWorkerRef.current.terminate();
        localWorkerRef.current = null;
        return;
      }
      
      // Send message to load local ASR model
      localWorkerRef.current.postMessage({ type: 'initialize-local-asr' });
      // `ready` state for local will be set true by worker message 'asr_model_ready'
      setReady(false); // Set to false until local model confirms readiness
      setProcessing(true); // Indicate local model loading

      // Add message listener for the local worker
      const localWorkerListener = (e: MessageEvent) => {
        console.log('[useTranscription] Message from local-worker:', e.data);
        const { status, transcription, error: workerError } = e.data;
        switch (status) {
          case 'sab_initialized':
            console.log('[useTranscription] Local worker confirmed SAB init.');
            break;
          case 'asr_model_loading':
            setProcessing(true);
            setReady(false);
            setText(''); // Ensure text is cleared when model is loading
            setError(null);
            console.log('[useTranscription] Local ASR model loading...');
            break;
          case 'asr_model_ready':
            setProcessing(false);
            setReady(true);
            setError(null);
            console.log('[useTranscription] Local ASR model ready.');
            break;
          case 'capture_started': // Handled by local worker
            setText(''); // Clear text when new capture starts
            break;
          case 'partial': // Handle partial transcriptions for smoother UI updates
            if (typeof transcription === 'string') {
              setText(prevText => mergeWithOverlap(prevText, transcription).merged);
            }
            break;
          case 'processing_full_audio': // Local worker processing
            setProcessing(true);
            break;
          case 'completed': // Local transcription complete
            setText(transcription || '');
            if (transcription && window.electron?.insertTextAtCursor) {
              window.electron.insertTextAtCursor(transcription)
                .catch(err => console.error('[useTranscription] Error inserting local transcript:', err));
            }
            setProcessing(false);
            break;
          case 'error':
            setError(String(workerError || 'Local ASR worker error'));
            setProcessing(false);
            setReady(false);
            break;
          default:
            console.warn('[useTranscription] Unknown message from local-worker:', e.data);
        }
      };
      localWorkerRef.current.addEventListener('message', localWorkerListener);

      // Cleanup for local worker path
      return () => {
        console.log('[useTranscription] Cleaning up local ASR worker and AudioContext.');
        localWorkerRef.current?.terminate();
        localWorkerRef.current = null;
        audioCtxRef.current?.close().catch(console.error);
        audioCtxRef.current = null;
        // SAB and streamRef are managed by their own effects or refs
        // workletNode and microphoneSourceRef are cleaned up in stop() for local mode
        setReady(streamRef.current ? true : false); // Reset ready to mic status if switching away from local
        setProcessing(false);
      };
    } else if (currentMode === 'cloud' && localWorkerRef.current) {
      // If switching from local to cloud, terminate the local worker and clean up
      console.log('[useTranscription] Switched to Cloud mode. Terminating local ASR worker.');
      localWorkerRef.current.terminate();
      localWorkerRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(console.error);
        audioCtxRef.current = null;
      }
      // Reset relevant states
      setReady(streamRef.current ? true : false); // Cloud ready if mic is available
      setProcessing(false);
    }
  }, [currentMode]);

  // --- 4️⃣ Public API ---
  const start = useCallback(async () => {
    console.log(`[useTranscription] start() called. Mode: ${currentMode}`);
    if (recording) {
      console.warn('[useTranscription] Already recording.');
      return;
    }
    if (!streamRef.current) {
      setError('Microphone stream not available. Cannot start recording.');
      console.error('[useTranscription] Mic stream not available for start().');
      setReady(false);
      return;
    }
    // Ensure general readiness (mic) before mode-specific checks
    if (!ready && currentMode === 'local') { // For local mode, `ready` means model is also ready
        setError('Local transcription engine not ready.');
        console.warn('[useTranscription] Local ASR not ready, cannot start.');
        return;
    }
     if (!ready && currentMode === 'cloud') { // For cloud, `ready` means mic is available.
        setError('Mic not available.'); // Should have been caught by streamRef check
        console.warn('[useTranscription] Mic not ready for cloud recording.');
        return;
    }

    setError(null);
    setText('');
    setRecording(true);

    if (currentMode === 'cloud') {
      console.log('[useTranscription] Starting cloud recording with MediaRecorder...');
      audioChunksRef.current = []; // Clear previous chunks
      try {
        const options = {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 64000, // Lower bitrate for smaller files
        }; 
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn(`[useTranscription] Fallback: ${options.mimeType} not supported. Trying with 'audio/webm'.`);
            // Try a more generic webm if opus-specific one fails
            mediaRecorderRef.current = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm', audioBitsPerSecond: 64000 });
        } else {
            mediaRecorderRef.current = new MediaRecorder(streamRef.current, options);
        }
        console.log('[useTranscription] MediaRecorder using MIME type:', mediaRecorderRef.current.mimeType);

        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            console.log(`[useTranscription] MediaRecorder data available: ${event.data.size} bytes`);
          }
        };

        mediaRecorderRef.current.onstop = async () => {
          console.log('[useTranscription] MediaRecorder stopped. Processing collected audio chunks.');
          if (audioChunksRef.current.length === 0) {
            console.warn('[useTranscription] No audio chunks recorded.');
            setProcessing(false);
            // setError('No audio was recorded.'); // Optional: inform user
            return;
          }
          const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm;codecs=opus' });
          audioChunksRef.current = []; // Clear for next recording
          
          console.log(`[useTranscription] Audio blob created: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
          setProcessing(true);
          try {
            const arrayBufferPromise = audioBlob.arrayBuffer();
            arrayBufferPromise.then(async (arrayBuffer) => {
              console.log(`[useTranscription] Profiling: Step 2 - ArrayBuffer created (${arrayBuffer.byteLength} bytes).`);
              if (!window.electron?.transcribeGroq) {
                throw new Error('Groq transcription service (window.electron.transcribeGroq) is not available.');
              }
              console.log('[useTranscription] Sending audio ArrayBuffer to Groq (transferable)...');
              
              const preIPCTime = performance.now();
              // Send as transferable
              const transcript = await window.electron.transcribeGroq(arrayBuffer, [arrayBuffer]); 
              
              if (profilingStartTimeRef.current) {
                const endTime = performance.now();
                const durationTotal = endTime - profilingStartTimeRef.current; // From mediaRecorder.stop() to result
                const durationIPCAndGroq = endTime - preIPCTime; // From pre-IPC call to result
                console.log(`[useTranscription] Profiling: Step 4 (Renderer) - Groq transcript received.`);
                console.log(`[useTranscription]   Total E2E (MediaRecorder.stop to result): ${durationTotal.toFixed(2)} ms`);
                console.log(`[useTranscription]   IPC + Groq (Main Thread actual work): ${durationIPCAndGroq.toFixed(2)} ms`);
                profilingStartTimeRef.current = null; // Reset for next run
              }
              // console.log(`[useTranscription] Groq transcript received: "${transcript.substring(0, 100)}..."`); // Redundant with profiling log
              setText(transcript);
              if (transcript && window.electron.insertTextAtCursor) {
                window.electron.insertTextAtCursor(transcript)
                  .catch(err => console.error('[useTranscription] Error inserting Groq text:', err));
              }
              setProcessing(false);
            }).catch(err => {
              console.error('[useTranscription] Error converting Blob to ArrayBuffer:', err);
              setError(err.message || 'Failed to process audio data.');
              setProcessing(false);
            });
          } catch (err: any) {
            console.error('[useTranscription] Error during Groq transcription IPC or Blob processing setup:', err);
            setError(err.message || 'Cloud transcription failed.');
            setProcessing(false); // Ensure processing is false on outer catch
          }
          // Remove finally setProcessing(false) from here as it's handled in promise chain or its catch
        };

        mediaRecorderRef.current.onerror = (event: Event) => {
            console.error('[useTranscription] MediaRecorder error:', event);
            setError('Error during MediaRecorder operation.');
            setRecording(false);
            setProcessing(false);
        };

        mediaRecorderRef.current.start(); // Default timeslice (collect all until stop)
        console.log('[useTranscription] MediaRecorder started.');

      } catch (err: any) {
        console.error('[useTranscription] Error starting MediaRecorder:', err);
        setError(`Failed to start cloud recording: ${err.message}`);
        setRecording(false);
      }
    } else { // currentMode === 'local'
      if (!localWorkerRef.current || !audioCtxRef.current || !sabRef.current || !streamRef.current) {
        setError('Local ASR system not fully initialized. Cannot start.');
        console.error('[useTranscription] Attempted to start local recording but components are missing.');
        setRecording(false);
        return;
      }
      console.log('[useTranscription] Starting local recording with AudioWorklet...');
      try {
        // Ensure AudioContext is running
        if (audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        const workletPath = '/audioworklet-processor.js'; 
        // Check if module already added, this is tricky as addModule doesn't return status
        // For simplicity, assuming it might need to be added each time or managed via a flag if errors occur.
        try {
          await audioCtxRef.current.audioWorklet.addModule(workletPath);
        } catch (moduleError) {
          // Ignore if already added, but log other errors
          if (!String(moduleError).includes('already been loaded')) {
            console.error('[useTranscription] Error adding AudioWorklet module:', moduleError);
            throw moduleError; // Propagate error
          } else {
            console.log('[useTranscription] AudioWorklet module likely already added.');
          }
        }
        
        microphoneSourceRef.current = audioCtxRef.current.createMediaStreamSource(streamRef.current);
        workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'capture-processor', {
            processorOptions: { sab: sabRef.current }
        });
        microphoneSourceRef.current.connect(workletNodeRef.current);
        // DO NOT connect workletNode to destination unless debugging audio passthrough
        
        localWorkerRef.current.postMessage({ type: 'start-capture' });
        console.log('[useTranscription] Local recording started. AudioWorklet connected, worker notified.');
      } catch (err: any) {
        console.error('[useTranscription] Error starting local recording or AudioWorklet:', err);
        setError(`Failed to start local recording: ${err.message}`);
        setRecording(false);
      }
    }
  }, [recording, currentMode, ready, streamRef]); // streamRef is now a dependency for mic check

  const stop = useCallback(async () => {
    console.log(`[useTranscription] stop() called. Mode: ${currentMode}`);
    if (!recording) {
      console.warn('[useTranscription] Not recording, cannot stop.');
      return;
    }
    setRecording(false); // Set recording false immediately

    if (currentMode === 'cloud') {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
        console.warn('[useTranscription] Cloud MediaRecorder not recording or not initialized.');
        setRecording(false); // also set recording to false here
        return;
      }
      console.log('[useTranscription] Profiling: Step 1 - Stopping MediaRecorder...');
      profilingStartTimeRef.current = performance.now(); // Start E2E profiling for cloud path
      mediaRecorderRef.current.stop(); // This will trigger 'dataavailable' then 'stop'
    } else { // currentMode === 'local'
      console.log('[useTranscription] Stopping local recording. Disconnecting AudioWorklet, notifying worker.');
      if (microphoneSourceRef.current) {
        microphoneSourceRef.current.disconnect();
        microphoneSourceRef.current = null;
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (localWorkerRef.current) {
        localWorkerRef.current.postMessage({ 
            type: 'stop-capture-and-transcribe',
            data: { sampleRate: localAudioSampleRateRef.current } 
        });
        // setProcessing(true); // Worker will send messages to update processing state
      } else {
        console.error("[useTranscription] Local worker not available to stop capture.");
        setError("Failed to send stop signal to local transcription worker.");
      }
    }
  }, [recording, currentMode]);

  const setMode = useCallback((mode: 'local' | 'cloud') => {
    if (mode === currentMode) return;
    console.log(`[useTranscription] Setting mode from ${currentMode} to: ${mode}`);
    
    // If currently recording, stop it before switching modes
    if (recording) {
      console.warn('[useTranscription] Recording active. Stopping current recording before mode switch.');
      // Calling stop here will use the logic for the *current* mode before it changes.
      stop(); 
    }

    setCurrentMode(mode);
    setText('');
    setError(null);
    setProcessing(false);
    // `ready` state will be managed by the useEffect for local worker init or mic check for cloud.
    // When switching to cloud, if mic is available (streamRef.current exists), it should be ready.
    // When switching to local, ready will be false until local model is loaded.
    if (mode === 'cloud') {
      setReady(streamRef.current ? true : false);
    } else {
      setReady(false); // Will be set true by local worker init effect
    }
  }, [currentMode, recording, stop]); // Added stop and recording as dependencies for safety

  return {
    recording,
    processing,
    ready,
    text,
    error,
    start,
    stop,
    currentMode,
    setMode,
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