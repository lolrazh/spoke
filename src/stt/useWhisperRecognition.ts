import { useState, useEffect, useRef, useCallback } from 'react';

// speech recognition
export const WHISPER_SAMPLING_RATE = 16_000;
export const MAX_AUDIO_LENGTH = 30; // Max audio length in seconds for Whisper processing
export const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
export const PROCESS_INTERVAL = 500; // Process audio every 500ms, aligning with MediaRecorder timeslice
export const RECORDER_REFRESH_INTERVAL = 60000; // Restart recorder every 60 seconds to avoid corruption
export const MAX_CHUNKS = 200; // Maximum number of audio chunks to keep to prevent memory issues

// silence detection
export const SILENCE_THRESHOLD = 0.005; // RMS threshold
export const SILENCE_DURATION_MS = 1500; // silence duration 
export const RECORDING_GRACE_PERIOD_MS = 1000; // dont detect silence for the first 1 second

export const convertBlobToAudio = async (blob: Blob): Promise<Float32Array | null> => {
  try {
    const url = URL.createObjectURL(blob);
    const tempCtx = new AudioContext();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength < 100) { 
        console.warn("Skipping decode for very small ArrayBuffer:", arrayBuffer.byteLength);
        URL.revokeObjectURL(url);
        await tempCtx.close();
        return null;
    }

    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    // console.log("Audio decoded:", {
    //   duration: audioBuffer.duration,
    //   sampleRate: audioBuffer.sampleRate,
    //   numberOfChannels: audioBuffer.numberOfChannels,
    //   length: audioBuffer.length
    // });

    // Cleanup
    URL.revokeObjectURL(url);
    await tempCtx.close();
    
    const originalAudio = audioBuffer.getChannelData(0);

    // use the last MAX_AUDIO_LENGTH seconds of the audio
    let audioToProcess = originalAudio;
    const maxSamplesAtOriginalRate = MAX_AUDIO_LENGTH * audioBuffer.sampleRate;

    if (originalAudio.length > maxSamplesAtOriginalRate) {
      //console.log(`Audio too long (${audioBuffer.duration}s), using only the last ${MAX_AUDIO_LENGTH}s`);
      audioToProcess = originalAudio.slice(-maxSamplesAtOriginalRate);
    }

    if (audioBuffer.sampleRate === WHISPER_SAMPLING_RATE) {
      //console.log("Sample rates match, using audio data directly");
      return audioToProcess;
    }
    //console.log(`Resampling audio from ${audioBuffer.sampleRate}Hz to ${WHISPER_SAMPLING_RATE}Hz`);

    const offlineCtx = new OfflineAudioContext(
      1, // mono
      Math.ceil(audioToProcess.length * WHISPER_SAMPLING_RATE / audioBuffer.sampleRate),
      WHISPER_SAMPLING_RATE
    );

    const bufferCreateCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });

    const tempBuffer = bufferCreateCtx.createBuffer(
      1,
      audioToProcess.length,
      audioBuffer.sampleRate
    );

    tempBuffer.copyToChannel(audioToProcess, 0);


    await bufferCreateCtx.close();


    const source = offlineCtx.createBufferSource();
    source.buffer = tempBuffer;
    source.connect(offlineCtx.destination);


    source.start();
    const resampledBuffer = await offlineCtx.startRendering();


    return resampledBuffer.getChannelData(0);
  } catch (err) {
    //console.error("Error converting blob to audio:", err);
    return null;
  }
};

// --- New React Hook --- 
export const useWhisperRecognition = () => {
  const workerRef = useRef<Worker | null>(null);

  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [transcriptionState, setTranscriptionState] = useState<'idle' | 'transcribing' | 'error'>('idle');
  const [transcriptionText, setTranscriptionText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Function to initialize the worker and model
  const initializeWorker = useCallback(() => {
    if (workerRef.current) {
      console.log('Worker already exists.');
      return;
    }
    
    console.log('Initializing Whisper worker...');
    // Create the worker
    const worker = new Worker(new URL('./whisper-worker.js', import.meta.url), {
        type: 'module'
    });
    
    // Add message listener
    worker.onmessage = (event) => {
      const { status, progress, text, error: workerError } = event.data;
      console.log('[useWhisperRecognition] Worker message received:', event.data);

      // Relay progress to main process for terminal logging
      if (status === 'loading-progress' && progress && (window.electron as any)?.logProgress) {
        (window.electron as any).logProgress(progress);
      }

      switch (status) {
        case 'loading-model':
          setModelState('loading');
          setError(null);
          setLoadingProgress(0);
          break;
        case 'loading-progress':
          setModelState('loading');
          setLoadingProgress(progress?.progress || 0);
          break;
        case 'init-complete':
          setModelState('ready');
          setError(null);
          setLoadingProgress(100);
          console.log('Whisper model ready.');
          break;
        case 'init-error':
          setModelState('error');
          setError(`Model Initialization Error: ${workerError}`);
          console.error('Model Initialization Error:', workerError);
          break;
        case 'transcribing':
          setTranscriptionState('transcribing');
          setError(null);
          setTranscriptionText(''); // Clear previous result
          break;
        case 'transcription-result':
          setTranscriptionState('idle');
          setTranscriptionText(text);
          setError(null);
          break;
        case 'transcription-error':
          setTranscriptionState('error');
          setError(`Transcription Error: ${workerError}`);
          console.error('Transcription Error:', workerError);
          break;
        default:
          console.warn('Unknown worker message status:', status);
      }
    };

    worker.onerror = (err) => {
        console.error("Worker error:", err);
        setModelState('error');
        setError(`Worker Error: ${err.message}`);
    }

    workerRef.current = worker;

    // Send init message to load model
    worker.postMessage({ type: 'init' });
  }, []);

  // Initialize worker on mount
  useEffect(() => {
    if (modelState === 'idle') {
      initializeWorker();
    }

    // Cleanup worker on unmount
    return () => {
      if (workerRef.current) {
        console.log('Terminating Whisper worker...');
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [initializeWorker, modelState]);

  // Function to send audio to the worker for transcription
  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    if (modelState !== 'ready') {
        setError('Model not ready for transcription.');
        console.warn('Model not ready, cannot transcribe.');
        return;
    }
    if (transcriptionState === 'transcribing') {
        setError('Already transcribing.');
        console.warn('Already transcribing, skipping new request.');
        return;
    }

    setTranscriptionState('transcribing'); // Set state immediately
    setError(null);
    setTranscriptionText('');

    // Convert and resample audio
    const audioFloat32Array = await convertBlobToAudio(audioBlob);

    if (audioFloat32Array && workerRef.current) {
      // Send audio data to worker
      // Transferable object for performance
      workerRef.current.postMessage({ type: 'transcribe', audio: audioFloat32Array }, [audioFloat32Array.buffer]);
    } else if (!audioFloat32Array) {
        console.error('Failed to convert audio blob to Float32Array.');
        setError('Failed to process audio data.');
        setTranscriptionState('error');
    } else {
        // This case should ideally not happen if modelState is checked
        console.error('Worker not available for transcription.');
        setError('Worker not available.');
        setTranscriptionState('error');
    }

  }, [modelState, transcriptionState]); // Dependencies

  return {
    isModelLoading: modelState === 'loading',
    isReady: modelState === 'ready',
    isTranscribing: transcriptionState === 'transcribing',
    loadingProgress,
    transcriptionText,
    error,
    transcribeAudio, // Function to trigger transcription
  };
};

