import { useRef, useState, useEffect, useCallback } from "react";
import { playToggleOn, playToggleOff } from "../utils/audioFeedback";
import {
  MICROPHONE_PREFERRED_RATE,
  TARGET_SAMPLE_RATE,
  SAMPLES_PER_CHUNK,
  WS_MAX_BUFFERED_BYTES,
} from "../config/audio";
import { getTranscribeWsUrl } from "../config/api";
import { encodeFrameHeader } from "../utils/pcm";

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
  // Streaming-only: no client-side PCM accumulation
  const abortControllerRef = useRef<AbortController | null>(null);
  // Streaming v2 state
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef(false);
  const wsErrorRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const sendQueueRef = useRef<ArrayBuffer[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  // Streaming is always enabled
  const startedMsRef = useRef<number>(0);
  const wsEndpointLoggedRef = useRef<boolean>(false);
  // Metrics
  const metricsRef = useRef<{
    sessionId: string;
    pttDownMs: number;
    wsOpenMs?: number;
    firstFrameOutMs?: number;
    lastFrameOutMs?: number;
    wsEndMs?: number;
    sttStartMs?: number;
    sttEndMs?: number;
    finalRenderMs?: number;
    framesProduced: number;
    bytesProduced: number;
    framesQueued: number;
    framesSentApprox: number;
  } | null>(null);

  const nowRelNs = () => {
    try {
      const relMs = Math.max(0, performance.now() - startedMsRef.current);
      return BigInt(Math.round(relMs * 1e6));
    } catch {
      return BigInt(0);
    }
  };

  const flushQueue = useCallback(() => {
    if (!wsRef.current || !wsReadyRef.current) return;
    const ws = wsRef.current;
    while (sendQueueRef.current.length) {
      if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) break;
      const next = sendQueueRef.current.shift()!;
      try { ws.send(next); } catch {}
    }
    if (sendQueueRef.current.length && ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      if (flushTimerRef.current == null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          flushQueue();
        }, 10);
      }
    }
  }, []);

  const ensureStreamingSocket = useCallback(() => {
    if (wsRef.current) return;
    const wsUrl = getTranscribeWsUrl();
    if (!wsEndpointLoggedRef.current) {
      try { console.info('[SF] WS endpoint', { url: wsUrl }); } catch {}
      wsEndpointLoggedRef.current = true;
    }
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    wsReadyRef.current = false;
    wsErrorRef.current = null;

    ws.onopen = () => {
      wsReadyRef.current = true;
      if (metricsRef.current && !metricsRef.current.wsOpenMs) metricsRef.current.wsOpenMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        const startMsg = { type: "start", version: 2 as const, format: "pcm16le" as const, rate: TARGET_SAMPLE_RATE, language: "en" };
        ws.send(JSON.stringify(startMsg));
      } catch {}
      flushQueue();
    };
    ws.onerror = () => {
      wsErrorRef.current = "WebSocket error";
    };
    ws.onclose = () => {
      wsReadyRef.current = false;
    };
  }, [flushQueue]);

  const streamFrame = useCallback((pcmBuf: ArrayBuffer) => {
    // Build header + payload into a single ArrayBuffer
    const payload = new Uint8Array(pcmBuf);
    const header = encodeFrameHeader(seqRef.current++, payload.byteLength, nowRelNs());
    const out = new Uint8Array((header.byteLength || 16) + payload.byteLength);
    out.set(new Uint8Array(header), 0);
    out.set(payload, (header.byteLength || 16));

    // Metrics: count frames/bytes and first-frame timestamp
    if (metricsRef.current) {
      metricsRef.current.framesProduced += 1;
      metricsRef.current.bytesProduced += payload.byteLength;
      if (!metricsRef.current.firstFrameOutMs) metricsRef.current.firstFrameOutMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    const ws = wsRef.current;
    if (ws && wsReadyRef.current && ws.bufferedAmount <= WS_MAX_BUFFERED_BYTES) {
      try { ws.send(out.buffer); } catch { sendQueueRef.current.push(out.buffer); }
      if (metricsRef.current) metricsRef.current.framesSentApprox += 1;
    } else {
      sendQueueRef.current.push(out.buffer);
      if (metricsRef.current) metricsRef.current.framesQueued += 1;
      ensureStreamingSocket();
      flushQueue();
    }
  }, [flushQueue, ensureStreamingSocket]);

  const waitForAllFramesSent = useCallback(async (timeoutMs = 1500) => {
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        flushQueue();
        const ws = wsRef.current;
        if (!ws || !wsReadyRef.current) return resolve();
        if (sendQueueRef.current.length === 0 && ws.bufferedAmount === 0) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 10);
      };
      tick();
    });
  }, [flushQueue]);

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
    // Reset streaming state
    seqRef.current = 0;
    sendQueueRef.current = [];
    wsErrorRef.current = null;
    // Keep an existing socket open to allow reuse across sessions
    startedMsRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    metricsRef.current = {
      sessionId: Math.random().toString(36).slice(2),
      pttDownMs: startedMsRef.current,
      framesProduced: 0,
      bytesProduced: 0,
      framesQueued: 0,
      framesSentApprox: 0,
    };

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
          // Stream immediately
          streamFrame(buf);
        }
      };

      // Connect source -> worklet (silent path)
      sourceNodeRef.current.connect(workletNodeRef.current);
      // Ensure WS is connected; if already open, send a fresh start for this session
      ensureStreamingSocket();
      if (wsRef.current && wsReadyRef.current) {
        try {
          const startMsg = { type: "start", version: 2 as const, format: "pcm16le" as const, rate: TARGET_SAMPLE_RATE, language: "en" };
          wsRef.current.send(JSON.stringify(startMsg));
        } catch {}
      }

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
  }, [recording, processing, openStreamForSelectedDevice, streamFrame]);

  const stop = useCallback(async () => {
    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setProcessing(true);

    try {
      // Disconnect nodes
      // Ask the worklet to flush any partial frame before tearing down
      try { workletNodeRef.current?.port.postMessage({ type: "flush" }); } catch {}
      // Record last-frame-out time right after requesting flush
      if (metricsRef.current && !metricsRef.current.lastFrameOutMs) metricsRef.current.lastFrameOutMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Disconnect nodes
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.port.postMessage({ type: "reset" }); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
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
      // Streaming-only: flush any queued frames and signal end; wait for final
      if (wsRef.current && !wsErrorRef.current) {
        abortControllerRef.current = new AbortController();
        await new Promise<void>((resolve, reject) => {
          let resolved = false;
          const ws = wsRef.current!;
          const onAbort = () => {
            if (!resolved) {
              resolved = true;
              reject(new DOMException("Aborted", "AbortError"));
            }
          };
          abortControllerRef.current!.signal.addEventListener('abort', onAbort);

          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(String(event.data));
              if (msg.type === "status" && msg.state === "processing") {
                if (!metricsRef.current?.sttStartMs) {
                  if (metricsRef.current) metricsRef.current.sttStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                }
                if (window.devFlags?.devConsoleLogs) console.info("[SF] Transcribe processing started");
              } else if (msg.type === "final") {
                if (!resolved) {
                  resolved = true;
                  setText(msg.text || "");
                  if (msg.text) {
                    window.transcript?.update(msg.text);
                    window.clipboard.insertText(msg.text);
                  }
                  if (metricsRef.current) {
                    metricsRef.current.sttEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    metricsRef.current.finalRenderMs = metricsRef.current.sttEndMs;
                    if (window.devFlags?.devConsoleLogs) {
                      console.info("[SF] Session metrics", {
                        sessionId: metricsRef.current.sessionId,
                        framesProduced: metricsRef.current.framesProduced,
                        framesQueued: metricsRef.current.framesQueued,
                        framesSentApprox: metricsRef.current.framesSentApprox,
                        bytesProducedKB: Number((metricsRef.current.bytesProduced/1024).toFixed(2)),
                        pttDownToFirstFrameMs: metricsRef.current.firstFrameOutMs ? Math.round(metricsRef.current.firstFrameOutMs - metricsRef.current.pttDownMs) : null,
                        firstToLastFrameMs: (metricsRef.current.firstFrameOutMs && metricsRef.current.lastFrameOutMs) ? Math.round(metricsRef.current.lastFrameOutMs - metricsRef.current.firstFrameOutMs) : null,
                        wsOpenDeltaMs: metricsRef.current.wsOpenMs ? Math.round(metricsRef.current.wsOpenMs - metricsRef.current.pttDownMs) : null,
                        wsEndDeltaMs: metricsRef.current.wsEndMs ? Math.round(metricsRef.current.wsEndMs - metricsRef.current.pttDownMs) : null,
                        sttDurationMs: (metricsRef.current.sttStartMs && metricsRef.current.sttEndMs) ? Math.round(metricsRef.current.sttEndMs - metricsRef.current.sttStartMs) : null,
                        totalMs: Math.round(metricsRef.current.sttEndMs - metricsRef.current.pttDownMs),
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
            } catch {}
          };
          ws.onerror = () => {
            if (!resolved) { resolved = true; reject(new Error("WebSocket connection error")); }
          };
          // Kick a final flush, wait for queue drain, then send end
          (async () => {
            try { await waitForAllFramesSent(); } catch {}
            try {
              if (metricsRef.current) metricsRef.current.wsEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
              ws.send(JSON.stringify({ type: "end" }));
            } catch {}
          })();
        });
      } else {
        throw new Error("WebSocket not ready for streaming");
      }
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
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      abortControllerRef.current = null;
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      // Reset metrics
      metricsRef.current = null;
    }
  }, [recording]);

  const cancel = useCallback(async () => {
    // Cancel discards current capture, does not send audio, and does not close WS
    // Also abort any in-flight processing if present
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
    }

    try {
      // Disconnect nodes and clean up (discard captured audio)
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { workletNodeRef.current?.disconnect(); } catch {}
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((track) => track.stop()); } catch {}
        streamRef.current = null;
        setReady(false);
      }
      // Reset streaming state (keep socket for reuse)
      sendQueueRef.current = [];
      seqRef.current = 0;
      // Notify server to drop frames for this session without closing
      if (wsRef.current && wsReadyRef.current) {
        try { wsRef.current.send(JSON.stringify({ type: "cancel" })); } catch {}
      }
    } finally {
      setRecording(false);
      setProcessing(false);
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      // Clear metrics for a fresh next session
      metricsRef.current = null;
    }
  }, [recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up WebSocket connection on component unmount
      if (wsRef.current) {
        try {
          if (wsReadyRef.current) {
            wsRef.current.send(JSON.stringify({ type: "cancel" }));
          }
          wsRef.current.close(1000, "component_unmount");
        } catch {}
        wsRef.current = null;
        wsReadyRef.current = false;
      }
      
      // Clean up audio resources
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach(track => track.stop()); } catch {}
        streamRef.current = null;
      }
      
      // Clear any pending timers
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      
      // Abort any pending operations
      if (abortControllerRef.current) {
        try { abortControllerRef.current.abort(); } catch {}
        abortControllerRef.current = null;
      }
    };
  }, []);

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
