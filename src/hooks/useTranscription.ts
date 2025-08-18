import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import { MICROPHONE_PREFERRED_RATE } from "../config/audio";
import { ConnectionManager } from "../services/connectionManager";

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
  connectionManager?: ConnectionManager | null;
  connectionStatus?: () => any;
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
  /** Enable WebSocket streaming path (default: false). */
  useWebSocket?: boolean;
  /** WebSocket URL for transcription (default: wss://api.sonicflow.app/transcribe). */
  wsUrl?: string;
  /** Chunk interval in ms for MediaRecorder when WS is enabled (default: 500). */
  wsChunkMs?: number;
  /** Enable real-time transcription updates (default: true). */
  realTimeUpdates?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
    useWebSocket = false,
    wsUrl = "wss://api.sonicflow.app/transcribe",
    wsChunkMs = 500,
    realTimeUpdates = true,
  } = options ?? {};
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef<boolean>(false);
  const wsFinalResolverRef = useRef<(() => void) | null>(null);
  const wsClosedRef = useRef<boolean>(false);
  const connectionManagerRef = useRef<ConnectionManager | null>(null);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  // Initialize connection manager
  useEffect(() => {
    if (useWebSocket) {
      connectionManagerRef.current = new ConnectionManager({
        wsUrl,
        maxConnections: 2,
        reconnectDelay: 1000,
        maxReconnectAttempts: 3
      });
      
      // Pre-warm connections on initialization
      connectionManagerRef.current.warmConnections(1);
    }
    
    return () => {
      connectionManagerRef.current?.cleanup();
    };
  }, [useWebSocket, wsUrl]);

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
    audioChunksRef.current = [];

    try {
      // Create 16kHz AudioContext for real-time downsampling
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      const dest = audioContextRef.current.createMediaStreamDestination();
      source.connect(dest);

      // Use MediaRecorder with pre-downsampled 16kHz stream
      mediaRecorderRef.current = new MediaRecorder(dest.stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000,
      });

      if (useWebSocket) {
        try {
          // Get connection from manager
          wsClosedRef.current = false;
          wsReadyRef.current = false;
          wsRef.current = await connectionManagerRef.current?.getConnection() || null;
          
          if (!wsRef.current) {
            throw new Error('Failed to get WebSocket connection');
          }

          // Start keepalive to prevent 10-second timeout
          keepAliveIntervalRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              try {
                wsRef.current.send(JSON.stringify({ type: 'keepalive' }));
              } catch {}
            }
          }, 5000); // Send every 5 seconds

          // Don't send start immediately - wait for user to actually start recording
          wsReadyRef.current = true; // Connection is ready after we get it from manager
          // Enhanced message handling with real-time updates
          wsRef.current.addEventListener('message', (evt) => {
            try {
              const msg = JSON.parse(String(evt.data));
              
              if (msg?.type === 'ready') {
                wsReadyRef.current = true;
                // Flush any buffered chunks captured before WS was ready
                if (audioChunksRef.current.length > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  (async () => {
                    const pending = audioChunksRef.current.slice();
                    audioChunksRef.current = [];
                    for (const blob of pending) {
                      try {
                        const buf = await blob.arrayBuffer();
                        wsRef.current?.send(buf);
                      } catch {}
                    }
                  })();
                }
              }
              
              if (msg?.type === 'partial' && realTimeUpdates) {
                // Real-time transcription updates
                setText(String(msg.text || ''));
              }
              
              if (msg?.type === 'final') {
                setText(String(msg.text || ''));
                if (msg.text) {
                  try { window.transcript?.update(String(msg.text)); } catch {}
                  try { window.clipboard.insertText(String(msg.text)); } catch {}
                }
                if (wsFinalResolverRef.current) wsFinalResolverRef.current();
              }
              
              if (msg?.type === 'error') {
                setError(String(msg.message || 'WebSocket error'));
                if (wsFinalResolverRef.current) wsFinalResolverRef.current();
              }
            } catch (error) {
              console.warn('[useTranscription] Failed to parse WebSocket message:', error);
            }
          });
          wsRef.current.addEventListener('close', () => { 
            wsClosedRef.current = true;
            console.log('[useTranscription] WebSocket connection closed');
          });
          
          wsRef.current.addEventListener('error', (error) => { 
            console.error('[useTranscription] WebSocket error:', error);
            setError('WebSocket connection error'); 
            if (wsFinalResolverRef.current) wsFinalResolverRef.current();
          });

        } catch (error) {
          console.error('[useTranscription] Failed to establish WebSocket connection:', error);
          setError('Failed to connect to transcription service');
          setRecording(false);
          return;
        }

        // Send start message when recording actually begins
        wsRef.current.send(JSON.stringify({
          type: 'start',
          model: 'whisper-large-v3-turbo',
          language: 'en',
          mime: 'audio/webm;codecs=opus',
          chunkMs: wsChunkMs,
        }));

        mediaRecorderRef.current.ondataavailable = async (event) => {
          if (event.data.size > 0) {
            // send as binary frame when WS is ready
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && wsReadyRef.current) {
              try {
                const buf = await event.data.arrayBuffer();
                wsRef.current.send(buf);
              } catch {}
            } else {
              audioChunksRef.current.push(event.data);
            }
          }
        };
        mediaRecorderRef.current.start(wsChunkMs);
        console.log(`[useTranscription] Started WebSocket transcription with ${wsChunkMs}ms chunks`);
      } else {
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };
        mediaRecorderRef.current.start(100);
      }
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
    }
  }, [recording, processing, openStreamForSelectedDevice, useWebSocket, wsUrl, wsChunkMs]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      // Stop MediaRecorder and wait for final data
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        // Wait for the MediaRecorder to finish and emit final data
        const stopPromise = new Promise<void>((resolve) => {
          if (mediaRecorderRef.current) {
            mediaRecorderRef.current.onstop = () => resolve();
          }
        });
        
        mediaRecorderRef.current.stop();
        await stopPromise;
      }

      // Clean up AudioContext
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Stop capturing audio completely so macOS mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setReady(false);
      }

      if (useWebSocket && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Send end and wait for final
        const finalPromise = new Promise<void>((resolve) => { wsFinalResolverRef.current = resolve; });
        try { wsRef.current.send(JSON.stringify({ type: 'end' })); } catch {}
        await finalPromise;
      } else {
        // Combine all recorded chunks into a single blob
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: 'audio/webm;codecs=opus' 
        });

        console.log(`[useTranscription] Opus file size: ${(audioBlob.size / 1024).toFixed(2)} KB`);

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", "whisper-large-v3-turbo");
        formData.append("prompt", "Vocabulary: Sandheep Rajkumar, Sonic Flow, Groq, Supabase, Gemini Flash Lite");
        formData.append("language", "en");
        formData.append("response_format", "json");
        formData.append("temperature", "0");

        // Wire an abort signal so cancel() can abort processing in-flight
        abortControllerRef.current = new AbortController();
        const response = await fetch("https://api.sonicflow.app", {
          method: "POST",
          body: formData,
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${errorText}`);
        }

        const result = await response.json();
        setText(result.text);
        if (result.text) {
          // Send transcript to main process for context menu copy functionality
          window.transcript?.update(result.text);
          window.clipboard.insertText(result.text);
        }
      }
    } catch (err) {
      // Swallow aborts quietly; surface other errors
      if ((err as DOMException)?.name === "AbortError") {
        // No-op: canceled by user
      } else {
        setError((err as Error).message);
      }
    } finally {
      setProcessing(false);
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      abortControllerRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Cleanup WebSocket and return connection to pool
      if (useWebSocket && wsRef.current) {
        try {
          // Clear keepalive
          if (keepAliveIntervalRef.current) {
            clearInterval(keepAliveIntervalRef.current);
            keepAliveIntervalRef.current = null;
          }
          
          // Return connection to pool if it's still good
          if (wsRef.current.readyState === WebSocket.OPEN) {
            connectionManagerRef.current?.returnConnection(wsRef.current);
          } else {
            wsRef.current.close();
          }
        } catch {}
        
        wsRef.current = null;
        wsReadyRef.current = false;
        wsFinalResolverRef.current = null;
      }
    }
  }, [recording, useWebSocket]);

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
      // Stop MediaRecorder without using the captured audio
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        const stopPromise = new Promise<void>((resolve) => {
          const mr = mediaRecorderRef.current;
          if (mr) {
            mr.onstop = () => resolve();
          } else {
            resolve();
          }
        });
        mediaRecorderRef.current.stop();
        await stopPromise;
      }

      // Clean up AudioContext
      if (audioContextRef.current) {
        audioContextRef.current.close();
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

      // Discard any accumulated audio chunks (scrap the audio)
      audioChunksRef.current = [];
      // Abort any in-flight processing (if cancel is invoked during processing)
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
    } finally {
      // Ensure UI reflects cancellation immediately
      setRecording(false);
      setProcessing(false);
      mediaRecorderRef.current = null;
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
    connectionManager: connectionManagerRef.current,
    connectionStatus: () => connectionManagerRef.current?.getStatus(),
  };
}
