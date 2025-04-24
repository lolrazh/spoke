import { useState, useEffect, useRef, useCallback } from 'react';
import {
  WHISPER_SAMPLING_RATE,
  PROCESS_INTERVAL,
  RECORDER_REFRESH_INTERVAL,
  MAX_CHUNKS,
  SILENCE_THRESHOLD,
  SILENCE_DURATION_MS,
  convertBlobToAudio, 
} from './useWhisperRecognition'; 

interface UseWhisperRecorderProps {
  onTranscriptionUpdate: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void; 
  onTranscriptionComplete?: (text: string) => void; 
  onSilenceDetected?: (text: string, audioData: Float32Array | null) => void; 
}

interface UseWhisperRecorderReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionReady: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  micStream: MediaStream | null;
  error: string | null;
}

export function useWhisperRecorder({
  onTranscriptionUpdate,
  onRecordingStateChange,
  onTranscriptionComplete, 
  onSilenceDetected,
}: UseWhisperRecorderProps): UseWhisperRecorderReturn {
  // --- Internal State ---
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionReady, setTranscriptionReady] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestTranscribedText, setLatestTranscribedText] = useState<string>(""); // Store latest segment

  // --- Internal Refs ---
  const whisperWorker = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const processingIntervalRef = useRef<number | null>(null);
  const lastProcessingTimeRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const recorderRefreshTimeoutRef = useRef<number | null>(null);

  // Silence Detection Refs 
  const silenceStartTimeRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const hasTranscribedSpeechRef = useRef<boolean>(false);

  // Ref to track recording state reliably in callbacks
  const isRecordingRef = useRef<boolean>(false);

  // Refs for debouncing transcription updates (avoid spamming transcription updates)
  const lastEmittedTranscriptionRef = useRef<string | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  const DEBOUNCE_INTERVAL_MS = 1000; 


  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (onRecordingStateChange) {
      onRecordingStateChange(isRecording);
    }
  }, [isRecording, onRecordingStateChange]);


  // --- Whisper Worker Init & Handling ---
  useEffect(() => {
    //console.log("Initializing Whisper Worker...");
    whisperWorker.current = new Worker(new URL('../whisper-worker.js', import.meta.url), {
        type: 'module',
    });

    const handleWhisperMessage = (e: MessageEvent) => {
        const { status, data, output, tps } = e.data;
        // console.log("Whisper Worker Message:", status, data, output); // Verbose

        switch (status) {
            case 'loading':
                setTranscriptionReady(false);
                break;
            case 'ready':
                //console.log("Whisper Worker Ready");
                setTranscriptionReady(true);
                setError(null); 
                break;
            case 'error':
                //console.error("Whisper Worker Error:", data);
                setError(data || 'Error loading Whisper model');
                setTranscriptionReady(false);
                setIsTranscribing(false); 
                break;
            case 'start':
                setIsTranscribing(true);
                break;
            case 'update':
                if (tps) console.log(`Whisper processing at ${tps.toFixed(2)} tokens/sec`);
                break;
            case 'complete':
                //console.log('Whisper transcription complete:', output);
                setIsTranscribing(false);

                if (output && Array.isArray(output) && output.length > 0) {
                    const transcribedText = output[0].trim();
                    setLatestTranscribedText(transcribedText); 

                    if (transcribedText &&
                        !["[BLANK_AUDIO]", "[ Silence ]", "[Silence]", ""].includes(transcribedText))
                    {
                        hasTranscribedSpeechRef.current = true;

                        const now = Date.now();
                        // check if it's the same text as the last emitted one AND within the debounce interval
                        if (transcribedText === lastEmittedTranscriptionRef.current &&
                            now - lastEmitTimeRef.current < DEBOUNCE_INTERVAL_MS)
                        {
                            //console.log(`Debouncing duplicate transcription: \"${transcribedText}\\"`);
                        } else {
                            //console.log(`Emitting transcription update: \"${transcribedText}\\"`);
                            lastEmittedTranscriptionRef.current = transcribedText; // Store this emitted text
                            lastEmitTimeRef.current = now;
                            onTranscriptionUpdate(transcribedText); 
                        }

                    } else {
                        //console.log("Transcription filtered (silence/blank).");
                        lastEmittedTranscriptionRef.current = null;
                    }
                } else {
                   //console.log("Transcription output empty or invalid.");
                   lastEmittedTranscriptionRef.current = null;
                }
                break;
            case 'initiate':
            case 'download':
            case 'progress':
            case 'done':
                // keep as is
                break;
            default:
                console.warn("Unknown Whisper worker message status:", status);
                break;
        }
    };

    whisperWorker.current.addEventListener('message', handleWhisperMessage);
    whisperWorker.current.postMessage({ type: 'load' });

    // Cleanup
    return () => {
        ////console.log("Terminating Whisper Worker...");
        whisperWorker.current?.terminate();
        whisperWorker.current?.removeEventListener('message', handleWhisperMessage);
        setIsTranscribing(false);
        setTranscriptionReady(false);
    };
  }, [onTranscriptionUpdate, onTranscriptionComplete]); 

  // --- Microphone Init---
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Speech recognition is not supported in your browser.");
      return;
    }

    let streamInstance: MediaStream | null = null;
    let audioContextInstance: AudioContext | null = null;
    let recorderInstance: MediaRecorder | null = null;

    //console.log("Initializing microphone access...");
    navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: WHISPER_SAMPLING_RATE
        }
    })
    .then(stream => {
        streamInstance = stream;
        setMicStream(stream); 

        audioContextInstance = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
        audioContextRef.current = audioContextInstance;
        //console.log("AudioContext initialized with sample rate:", audioContextInstance.sampleRate);

        const mimeTypes = [
          'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'
        ];
        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
        //console.log("Creating MediaRecorder with MIME type:", selectedMimeType);

        recorderInstance = new MediaRecorder(stream, { mimeType: selectedMimeType });
        recorderRef.current = recorderInstance;

        recorderInstance.onstart = () => {
          audioChunksRef.current = [];
          recordingStartTimeRef.current = Date.now();
          lastProcessingTimeRef.current = Date.now();
          //console.log("Internal: Recording started with", recorderInstance?.mimeType);
        };

        recorderInstance.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
            // //console.log("Audio chunk received, size:", e.data.size); // Verbose
          } else {
            console.warn("Received empty audio chunk");
          }
        };

        recorderInstance.onstop = () => {
          const wasRefresh = isRecordingRef.current; // Check ref before state potentially changes
          const isMidRefresh = isRefreshingRef.current;

          if (!wasRefresh && !isMidRefresh) {
              //console.log("Internal: Recording stopped by stopRecording()");
          } else if (isMidRefresh) {
              //console.log("Internal: Recorder stopped for refresh. Skipping final processing.");
          } else {
              console.warn("Internal: Recorder stopped unexpectedly while isRecordingRef was true.");
          }
          if (!isMidRefresh && audioChunksRef.current.length > 0 && !isTranscribing) {
              //console.log("Processing final audio chunks after recorder stopped");
              processLatestAudio(); // Process final chunks
          }
        };

        recorderInstance.onerror = (event) => {
          console.error("MediaRecorder error:", event);
          setError("An error occurred with the audio recorder.");

           if (isRecordingRef.current) {
               stopRecordingInternal(); 
           }
        };

        //console.log("MediaRecorder initialized successfully");
        setError(null); 

    })
    .catch(err => {
        console.error("Error accessing microphone:", err);
        setError("Failed to access microphone. Please grant permission.");
        setMicStream(null);
    });

    // Cleanup function
    return () => {
      //console.log("Cleaning up microphone resources...");
      stopPeriodicProcessing(); 
      clearRecorderRefresh(); 

      if (recorderInstance && recorderInstance.state === "recording") {
          try { recorderInstance.stop(); } catch (e) { console.error("Error stopping recorder on cleanup:", e); }
      }
      if (streamInstance) {
          streamInstance.getTracks().forEach(track => track.stop());
      }
      if (audioContextInstance) {
          try { audioContextInstance.close(); } catch (e) { console.error("Error closing AudioContext on cleanup:", e); }
      }
       // Reset refs
       recorderRef.current = null;
       audioContextRef.current = null;
       setMicStream(null); 
       if (isRecordingRef.current) {
           setIsRecording(false);
       }
    };
  }, []); 



  const processLatestAudio = useCallback(async () => {
    if (!audioContextRef.current || !whisperWorker.current || isTranscribing) {
      // console.log("Skipping processLatestAudio: conditions not met", { hasContext: !!audioContextRef.current, hasWorker: !!whisperWorker.current, isTranscribing });
      return;
    }

    if (audioChunksRef.current.length === 0) {
        return; 
    }

    setIsTranscribing(true); 
    const chunksToProcess = [...audioChunksRef.current]; 
    // console.log(`Processing ${chunksToProcess.length} audio chunks`); // Verbose

    let finalAudioData: Float32Array | null = null; 
    try {
      const mimeType = recorderRef.current?.mimeType || 'audio/webm';
      const blob = new Blob(chunksToProcess, { type: mimeType });
      // console.log(`Created blob, size: ${blob.size} bytes, type: ${mimeType}`);

      const audioData = await convertBlobToAudio(blob);
      finalAudioData = audioData; 

      if (!audioData) {
        //console.error("Failed to convert audio blob - potentially corrupted data.");
        setIsTranscribing(false);
        audioChunksRef.current = []; 
        resetSilenceTimer();
        if (isRecordingRef.current) {
            //console.log("Scheduling immediate recorder refresh due to audio conversion failure");
            refreshRecorder();
        }
        return;
      }

      // --- Silence Detection ---
      const silenceCheckSamples = Math.floor(WHISPER_SAMPLING_RATE * (SILENCE_DURATION_MS / 1000));
      const sliceStart = Math.max(0, audioData.length - silenceCheckSamples);
      const audioSliceForSilenceCheck = audioData.slice(sliceStart);
      let rms = 0;
      if (audioSliceForSilenceCheck.length > 0) {
        rms = Math.sqrt(audioSliceForSilenceCheck.reduce((sum, sample) => sum + sample * sample, 0) / audioSliceForSilenceCheck.length);
      }
      // console.log(`Audio RMS (last ${SILENCE_DURATION_MS}ms slice): ${rms}`); // Verbose

      if (rms < SILENCE_THRESHOLD) {
         // console.log("Silence detected in the last slice."); // Verbose
          if (isRecordingRef.current && silenceStartTimeRef.current === null && hasTranscribedSpeechRef.current) {
            silenceStartTimeRef.current = Date.now();
            // console.log(`Starting silence timer (speech previously detected) for ${SILENCE_DURATION_MS}ms`); // Verbose

            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

            silenceTimerRef.current = window.setTimeout(() => {
              if (silenceStartTimeRef.current !== null && isRecordingRef.current) {
                 const silenceDuration = Date.now() - silenceStartTimeRef.current;
                 if (silenceDuration >= SILENCE_DURATION_MS) {
                    console.log(`Silence duration (${silenceDuration}ms) threshold met.`);
                     audioChunksRef.current = [];
                    if (onSilenceDetected) {
                     
                      onSilenceDetected(latestTranscribedText, finalAudioData); 
                    }
                    
                    resetSilenceTimer();
                    hasTranscribedSpeechRef.current = false; // Requires new speech
                 } else {
                    resetSilenceTimer(); // Timer fired but duration wasn't met
                 }
              } else {
                 resetSilenceTimer(); 
              }
            }, SILENCE_DURATION_MS);
          }
          setIsTranscribing(false); 
      } else {
        // Speech detected
        // console.log("Speech detected, resetting silence timer and sending to Whisper."); // Verbose
        resetSilenceTimer(); // Clear timer if speech resumes

       
        whisperWorker.current.postMessage({
            type: 'generate',
            data: { audio: audioData, language: 'en' }
           
        });
         
      }
      lastProcessingTimeRef.current = Date.now();

    } catch (err) {
      console.error("Error processing audio:", err);
      setIsTranscribing(false);
      resetSilenceTimer();

      setError("Error processing recorded audio.");
    }
  }, [isTranscribing, onSilenceDetected]); 


  const checkAndProcessAudio = useCallback(() => {
   
    if (audioChunksRef.current.length > MAX_CHUNKS * 0.8 && isRecordingRef.current && !isRefreshingRef.current) {
     
      refreshRecorder();
      return; 
    }
    if (isRecordingRef.current && !isTranscribing && audioChunksRef.current.length > 0) {
      processLatestAudio();
    }
  }, [isTranscribing, processLatestAudio]); 

  const startPeriodicProcessing = useCallback(() => {
    stopPeriodicProcessing(); 
    processingIntervalRef.current = window.setInterval(checkAndProcessAudio, PROCESS_INTERVAL);
   
  }, [checkAndProcessAudio]);

  const stopPeriodicProcessing = useCallback(() => {
    if (processingIntervalRef.current) {

      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
  }, []);


  useEffect(() => {
    if (isRecording) {
      startPeriodicProcessing();
      scheduleRecorderRefresh();
    } else {
      stopPeriodicProcessing();
      clearRecorderRefresh();
    }

  }, [isRecording, startPeriodicProcessing, stopPeriodicProcessing]);


  const clearRecorderRefresh = useCallback(() => {
    if (recorderRefreshTimeoutRef.current) {
      window.clearTimeout(recorderRefreshTimeoutRef.current);
      recorderRefreshTimeoutRef.current = null;
    }
  }, []);

  const scheduleRecorderRefresh = useCallback(() => {
    clearRecorderRefresh();
    recorderRefreshTimeoutRef.current = window.setTimeout(() => {
      //console.log("Refreshing recorder (scheduled timeout)");
      refreshRecorder();
    }, RECORDER_REFRESH_INTERVAL);
  }, [clearRecorderRefresh]); 

  const refreshRecorder = useCallback(() => {
    if (!isRecordingRef.current || !recorderRef.current || isRefreshingRef.current) {
      return;
    }

    //console.log("Attempting recorder refresh...");
    isRefreshingRef.current = true; // Set flag immediately

    // ** do NOT process audio here - rely on onstop check **

    try {
      if (recorderRef.current.state === "recording") {
        // console.log("Stopping recorder for refresh..."); // Verbose
        recorderRef.current.stop(); 
      } else {
        console.warn("Recorder not recording during refresh attempt, state:", recorderRef.current.state);

         isRefreshingRef.current = false;

         return;
      }
    } catch (e) {
        console.error("Error stopping recorder during refresh:", e);
        isRefreshingRef.current = false; 
        return;
    }


    setTimeout(() => {
      if (isRecordingRef.current && recorderRef.current) {
        try {
            if (recorderRef.current.state === 'inactive') {
                //console.log("Restarting recorder after refresh timeout");
                audioChunksRef.current = []; 
                recorderRef.current.start(500); 
                scheduleRecorderRefresh();
            } else {
                 console.warn(`Recorder not inactive (state: ${recorderRef.current.state}) after refresh stop timeout, cannot restart.`);

            }
        } catch (e) {
             console.error("Error restarting recorder after refresh:", e);
             setError("Failed to restart recorder after refresh.");
             stopRecordingInternal();
        }
      } else {
          // console.log("Recording stopped by user during refresh timeout, not restarting."); // Verbose
      }
      isRefreshingRef.current = false; 
    }, 300); // Delay before restart

  }, [isTranscribing, processLatestAudio, scheduleRecorderRefresh]); 

  // --- Silence Timer Reset ---
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    silenceStartTimeRef.current = null;
  }, []);


  const startRecording = useCallback(() => {
    if (!recorderRef.current || !transcriptionReady || isRecordingRef.current) {
      console.warn("Cannot start recording:", { hasRecorder: !!recorderRef.current, transcriptionReady, isRecording: isRecordingRef.current });
      return;
    }
    //console.log("Hook: startRecording called");
    try {
      audioChunksRef.current = []; 
      resetSilenceTimer();
      hasTranscribedSpeechRef.current = false; 

      recorderRef.current.start(500); 
      setIsRecording(true); 
      

    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Failed to start recording.");
      setIsRecording(false); 
    }
  }, [transcriptionReady, resetSilenceTimer]);

  
  const stopRecordingInternal = useCallback((isManualStop = false) => {
     if (!recorderRef.current || !isRecordingRef.current) {
         
         return;
     }
     //console.log("Hook: stopRecordingInternal called");
     clearRecorderRefresh(); 
     resetSilenceTimer();
     hasTranscribedSpeechRef.current = false; 

     try {
         if (recorderRef.current.state === "recording") {
             recorderRef.current.stop();
         } else { 
             console.warn("Stop called but recorder wasn't recording, state:", recorderRef.current.state);

             if (isManualStop && audioChunksRef.current.length > 0 && !isTranscribing) {
                 //console.log("Processing final chunks on manual stop.");

                 processLatestAudio(); 
             }
         }
     } catch (err) {
         console.error("Error stopping recording:", err);
         setError("Failed to stop recording cleanly.");
     } finally {
         setIsRecording(false); 
     }
 }, [clearRecorderRefresh, resetSilenceTimer, isTranscribing, processLatestAudio]);



  const stopRecording = useCallback(() => {
    stopRecordingInternal(true); 
  }, [stopRecordingInternal]);

  return {
    isRecording,
    isTranscribing,
    transcriptionReady,
    startRecording,
    stopRecording,
    micStream,
    error,
  };
} 