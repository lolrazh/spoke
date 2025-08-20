import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import {
  MICROPHONE_PREFERRED_RATE,
  TARGET_SAMPLE_RATE,
  SAMPLES_PER_CHUNK,
} from "../config/audio";
import { getTranscribeUrl, getTranscribeWsUrl } from "../config/api";
import { concatInt16, encodeWavInt16 } from "../utils/pcm";

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export interface UseTranscriptionOptions {
  /**
   * When true (default), the hook will enumerate audio devices on mount and on device changes.
   * This requires getUserMedia to obtain device labels on macOS and may trigger a permission prompt.
   */
  autoEnumerateDevices?: boolean;
  /**
   * When true (default), the hook will open a microphone stream automatically based on the
   * currently selected device. When false, a stream will only be opened on start().
   */
  autoInitStream?: boolean;
  /**
   * When true, request mic permission during device enumeration to fetch device labels.
   * Defaults to false to avoid opening the mic until dictation starts.
   */
  requestLabelPermissionForEnumeration?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
  } = options ?? {};
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null); // legacy path (unused after PCM switch)
  const audioChunksRef = useRef<Blob[]>([]); // legacy path (unused after PCM switch)
  const abortControllerRef = useRef<AbortController | null>(null);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  // Device enumeration function
  const enumerateAndSendDevices = useCallback(async () => {
    try {
      // Avoid opening the mic by default; only request permission for labels if explicitly asked
      if (requestLabelPermissionForEnumeration) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks to prevent persistent capture
        tempStream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
        }));

      console.log("[useTranscription] Found audio input devices:", audioInputs);

      // Send to main process with a small delay to ensure tray is ready
      setTimeout(() => {
        if (window.mic?.updateDevices) {
          console.log(
            "[useTranscription] Sending devices to main process:",
            audioInputs,
          );
          window.mic.updateDevices(audioInputs, selectedMicId);
        }
      }, 500);
    } catch (err) {
      console.error("[useTranscription] Failed to enumerate devices:", err);
    }
  }, [selectedMicId, requestLabelPermissionForEnumeration]);

  // Enumerate and send available microphones to main process
  useEffect(() => {
    if (!autoEnumerateDevices) {
      return;
    }
    enumerateAndSendDevices();

    // Listen for device changes (plug/unplug)
    const handleDeviceChange = () => {
      console.log(
        "[useTranscription] Device change detected, re-enumerating...",
      );
      // Add a small delay to let the system settle after device changes
      setTimeout(() => {
        enumerateAndSendDevices();
      }, 200);
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [enumerateAndSendDevices, autoEnumerateDevices]);

  // Listen for microphone selection changes from main process
  useEffect(() => {
    if (!window.mic?.onSelectedChanged) return;

    const unsubscribe = window.mic.onSelectedChanged(({ id }) => {
      console.log("[useTranscription] Microphone selection changed to:", id);
      setSelectedMicId(id);
    });

    return unsubscribe;
  }, []);

  // Listen for refresh requests from main process
  useEffect(() => {
    if (!window.mic?.onRefreshRequest) return;

    const unsubscribe = window.mic.onRefreshRequest(() => {
      console.log(
        "[useTranscription] ✅ Refresh devices requested from main process - executing refresh...",
      );
      if (autoEnumerateDevices) {
        enumerateAndSendDevices();
      }
    });

    return unsubscribe;
  }, [enumerateAndSendDevices, autoEnumerateDevices]);

  // Helper to open a microphone stream for the currently selected device
  const openStreamForSelectedDevice = useCallback(async (): Promise<boolean> => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          sampleRate: MICROPHONE_PREFERRED_RATE,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
        },
      };

      if (selectedMicId !== "default") {
        (constraints.audio as MediaTrackConstraints).deviceId = {
          exact: selectedMicId,
        };
      }

      console.log(
        "[useTranscription] Opening microphone stream with constraints:",
        constraints,
      );
      streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      setReady(true);
      setError(null);
      console.log(
        "[useTranscription] Microphone stream opened successfully",
      );
      return true;
    } catch (err) {
      console.error("[useTranscription] Failed to open microphone stream:", err);
      setError(
        "Microphone permissions denied or selected microphone not available.",
      );
      setReady(false);
      return false;
    }
  }, [selectedMicId]);

  // Initialize microphone stream when selected device changes
  useEffect(() => {
    if (!autoInitStream) {
      return;
    }
    const initializeMicrophone = async () => {
      // Stop existing stream if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }

      await openStreamForSelectedDevice();
    };

    initializeMicrophone();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedMicId, autoInitStream, openStreamForSelectedDevice]);

  const start = useCallback(async () => {
    if (recording) return;
    if (processing) return; // Prevent starting while processing
    if (!streamRef.current) {
      const ok = await openStreamForSelectedDevice();
      if (!ok) return;
    }

    playToggleOn();
    setError(null);
    setText("");
    setRecording(true);
    pcmChunksRef.current = [];

    try {
      // Create AudioContext at device/hardware rate and attach downsampler worklet
      audioContextRef.current = new AudioContext();
      await audioContextRef.current.audioWorklet.addModule(
        "/worklets/pcm16-downsampler.worklet.js",
      );

      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(
        streamRef.current,
      );
      workletNodeRef.current = new AudioWorkletNode(
        audioContextRef.current,
        "pcm16-downsampler",
        {
          processorOptions: {
            targetSampleRate: TARGET_SAMPLE_RATE,
            frameSamples: SAMPLES_PER_CHUNK,
          },
        },
      );

      workletNodeRef.current.port.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (msg?.type === "audio" && msg?.samples) {
          const buf: ArrayBuffer = msg.samples as ArrayBuffer;
          pcmChunksRef.current.push(new Int16Array(buf));
        }
      };

      // Connect source -> worklet (silent path)
      sourceNodeRef.current.connect(workletNodeRef.current);

      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] AudioContext (PCM capture)", {
          actualRate: audioContextRef.current.sampleRate,
          targetRate: TARGET_SAMPLE_RATE,
          samplesPerChunk: SAMPLES_PER_CHUNK,
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
    }
  }, [recording, processing, openStreamForSelectedDevice]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      // Disconnect nodes
      try {
        sourceNodeRef.current?.disconnect();
      } catch {}
      try {
        workletNodeRef.current?.port.postMessage({ type: "reset" });
        workletNodeRef.current?.disconnect();
      } catch {}
      // Close AudioContext to release mic indicator faster
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Stop capturing audio completely so macOS mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }

      // Combine all PCM Int16 frames and wrap to a small WAV for compatibility
      const pcm = concatInt16(pcmChunksRef.current);
      const wav = encodeWavInt16(pcm, TARGET_SAMPLE_RATE);
      const audioBlob = new Blob([wav], { type: "audio/wav" });

      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] Audio blob (PCM16/WAV)", {
          sizeKB: Number((audioBlob.size / 1024).toFixed(2)),
          type: audioBlob.type,
          frames: pcmChunksRef.current.length,
          samples: pcm.length,
        });
      }

      // Use WebSocket for transcription
      const wsUrl = getTranscribeWsUrl();
      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] Transcribe WebSocket request", { url: wsUrl });
      }

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      // Wire an abort signal so cancel() can abort processing in-flight
      abortControllerRef.current = new AbortController();
      
      // Promise to handle WebSocket communication
      await new Promise<void>((resolve, reject) => {
        let resolved = false;

        // Handle abortion
        abortControllerRef.current!.signal.addEventListener('abort', () => {
          if (!resolved) {
            resolved = true;
            ws.close();
            reject(new DOMException("Aborted", "AbortError"));
          }
        });

        ws.onopen = async () => {
          try {
            // Send metadata first
            ws.send(JSON.stringify({ type: "start", language: "en" }));
            
            // Send audio data as binary
            ws.send(await audioBlob.arrayBuffer());
            
            // Signal end of transmission
            ws.send(JSON.stringify({ type: "end" }));
            
            if (window.devFlags?.devConsoleLogs) {
              console.info("[SF] Audio sent via WebSocket", { 
                sizeKB: Number((audioBlob.size / 1024).toFixed(2)) 
              });
            }
          } catch (err) {
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            
            if (msg.type === "status" && msg.state === "processing") {
              if (window.devFlags?.devConsoleLogs) {
                console.info("[SF] Transcribe processing started");
              }
            } else if (msg.type === "final") {
              if (!resolved) {
                resolved = true;
                
                setText(msg.text || "");
                if (msg.text) {
                  // Send transcript to main process for context menu copy functionality
                  window.transcript?.update(msg.text);
                  window.clipboard.insertText(msg.text);

                  if (window.devFlags?.devConsoleLogs) {
                    const preview = typeof msg.text === "string" ? msg.text.slice(0, 120) : "";
                    console.info("[SF] Transcribe result", { 
                      chars: msg.text?.length ?? 0, 
                      preview,
                      segments: msg.segments?.length ?? 0 
                    });
                  }
                }
                resolve();
              }
            } else if (msg.type === "error") {
              if (!resolved) {
                resolved = true;
                reject(new Error(`Server error: ${msg.body || 'Unknown error'}`));
              }
            }
          } catch (err) {
            // Ignore malformed messages
            if (window.devFlags?.devConsoleLogs) {
              console.warn("[SF] Ignoring malformed WebSocket message");
            }
          }
        };

        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            reject(new Error("WebSocket connection error"));
          }
        };

        ws.onclose = () => {
          if (!resolved) {
            resolved = true;
            reject(new Error("WebSocket closed unexpectedly"));
          }
        };
      });
    } catch (err) {
      // Swallow aborts quietly; surface other errors
      if ((err as DOMException)?.name === "AbortError") {
        // No-op: canceled by user
      } else {
        if (window.devFlags?.devConsoleLogs) {
          console.error("[SF] Transcribe exception", { error: (err as Error)?.message });
        }
        setError((err as Error).message);
      }
    } finally {
      setProcessing(false);
      pcmChunksRef.current = [];
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      abortControllerRef.current = null;
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    }
  }, [recording]);

  const cancel = useCallback(async () => {
    // Cancel only affects active recordings; it does not send audio to the API
    if (!recording && !mediaRecorderRef.current && !audioContextRef.current && !streamRef.current) {
      // Also abort any in-flight processing if present
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
      return;
    }

    try {
      // Disconnect nodes and clean up (discard captured audio)
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }

      // Stop capturing audio completely
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
        streamRef.current = null;
        setReady(false);
      }

      // Discard any accumulated PCM frames (scrap the audio)
      pcmChunksRef.current = [];
      // Abort any in-flight processing (if cancel is invoked during processing)
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
    } finally {
      // Ensure UI reflects cancellation immediately
      setRecording(false);
      setProcessing(false);
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    }
  }, [recording]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    start,
    stop,
    cancel,
  };
}
