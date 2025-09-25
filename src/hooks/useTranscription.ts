import { useRef, useState, useEffect, useCallback } from "react";
import type {
  SelectionInspectSnapshot,
  SelectionRange,
} from "../types/shared";
import type {
  ClientSessionMode,
  SelectionSnapshotPayload,
} from "../types/protocol";
import { playToggleOff } from "../utils/audioFeedback";
import {
  MICROPHONE_PREFERRED_RATE,
  TARGET_SAMPLE_RATE,
  SAMPLES_PER_CHUNK,
  WS_MAX_BUFFERED_BYTES,
  POST_ROLL_MS,
} from "../config/audio";
import { getTranscribeWsUrl, getMetricsUrl } from "../config/api";
import { AUDIO_PROCESSING_TRACK_CONSTRAINTS } from "../config/audioConstraints";
import { encodeFrameHeader } from "../utils/pcm";
import { VAD_ENABLED } from "../config/vad";
import { SileroVadEngine, EnergyVadEngine } from "../utils/vadEngine";
import { VadStreamGate } from "../utils/vadStreamGate";

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  mode: ClientSessionMode;
  selection: SelectionInspectSnapshot | null;
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
  /**
   * When true, the hook will NOT trigger native paste on final results.
   * Useful for onboarding/tests where the UI wants to control insertion.
   */
  suppressNativePaste?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
    suppressNativePaste = false,
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
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const seqRef = useRef(0);
  const sendQueueRef = useRef<ArrayBuffer[]>([]);
  const sendQueueBytesRef = useRef<number>(0);
  const flushTimerRef = useRef<number | null>(null);
  // Streaming is always enabled
  const startedMsRef = useRef<number>(0);
  const wsEndpointLoggedRef = useRef<boolean>(false);
  // Metrics
  const metricsRef = useRef<{
    sessionId: string;
    pttDownMs: number;
    stopInvokedMs?: number;
    wsOpenMs?: number;
    firstFrameOutMs?: number;
    lastFrameOutMs?: number;
    wsEndMs?: number; // maintained for backward compat; equals endSentMs
    endSentMs?: number;
    sttStartMs?: number;
    sttEndMs?: number;
    finalRenderMs?: number;
    pasteStartMs?: number;
    pasteDoneMs?: number;
    postRollStartMs?: number;
    postRollEndMs?: number;
    drainDoneMs?: number;
    framesProduced: number;
    bytesProduced: number;
    framesQueued: number;
    framesSentApprox: number;
    framesForwarded?: number;
    framesDropped?: number;
  } | null>(null);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ClientSessionMode>("dictation");
  const selectionRef = useRef<SelectionInspectSnapshot | null>(null);
  const [selection, setSelection] = useState<SelectionInspectSnapshot | null>(null);
  const sessionSelectionPayloadRef = useRef<SelectionSnapshotPayload | null>(null);
  const sessionModeRef = useRef<ClientSessionMode>("dictation");
  const startSentRef = useRef(false);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");

  const buildSelectionPayload = (
    snapshot: SelectionInspectSnapshot | null,
  ): SelectionSnapshotPayload | null => {
    if (!snapshot) return null;
    const range: SelectionRange | null = snapshot.range ?? null;
    return {
      status: snapshot.status,
      hadSelection: snapshot.hadSelection,
      text: snapshot.selectedText ?? null,
      range,
      valueLength: snapshot.valueLength ?? null,
    };
  };

  const trySendStartMessage = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || startSentRef.current) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    const traceId = metricsRef.current?.sessionId;
    if (!traceId) return;
    const startPayload: {
      type: "start";
      version: 2;
      format: "pcm16le";
      rate: number;
      language: string;
      traceId: string;
      mode?: ClientSessionMode;
      selection?: SelectionSnapshotPayload | null;
    } = {
      type: "start",
      version: 2,
      format: "pcm16le",
      rate: TARGET_SAMPLE_RATE,
      language: "en",
      traceId,
    };

    if (sessionModeRef.current) {
      startPayload.mode = sessionModeRef.current;
    }

    if (sessionSelectionPayloadRef.current) {
      startPayload.selection = sessionSelectionPayloadRef.current;
    }

    try {
      ws.send(JSON.stringify(startPayload));
      startSentRef.current = true;
    } catch (err) {
      if (window.devFlags?.devConsoleLogs) {
        console.warn("[useTranscription] Failed to send start payload", err);
      }
    }
  }, []);

  // VAD
  const vadEngineRef = useRef<SileroVadEngine | EnergyVadEngine | null>(null);
  const vadStreamGateRef = useRef<VadStreamGate | null>(null);
  const vadReadyRef = useRef<boolean>(false);

  const nowRelNs = () => {
    try {
      const relMs = Math.max(0, performance.now() - startedMsRef.current);
      return BigInt(Math.round(relMs * 1e6));
    } catch {
      return BigInt(0);
    }
  };

  const MAX_CLIENT_BUFFER_BYTES = 2 * 1024 * 1024; // Reduced to 2MB for faster detection
  const WARNING_BUFFER_BYTES = 1024 * 1024; // Warn at 1MB
  const CRITICAL_BUFFER_BYTES = 1536 * 1024; // Critical at 1.5MB

  const resetReconnectBackoff = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
  };

  const MAX_RECONNECT_ATTEMPTS = 10;
  const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

  const scheduleReconnect = () => {
    if (wsRef.current) return; // socket exists (OPEN/CONNECTING)
    if (!recording && sendQueueRef.current.length === 0) return; // nothing to send
    if (reconnectTimerRef.current != null) return;
    
    // Circuit breaker: stop trying after max attempts
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[useTranscription] Max reconnect attempts exceeded, entering circuit breaker mode");
      setError("Connection failed. Please check your internet connection and try again.");
      
      // Set a longer timeout before allowing reconnect attempts again
      reconnectTimerRef.current = window.setTimeout(() => {
        console.info("[useTranscription] Circuit breaker reset, allowing reconnect attempts");
        reconnectAttemptRef.current = 0;
        reconnectTimerRef.current = null;
      }, CIRCUIT_BREAKER_TIMEOUT);
      return;
    }
    
    const base = 150;
    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(base * Math.pow(2, attempt), 2000);
    console.debug(`[useTranscription] Scheduling reconnect attempt ${attempt} in ${delay}ms`);
    
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      ensureStreamingSocket();
    }, delay);
  };

  const flushQueue = useCallback(() => {
    if (!wsRef.current || !wsReadyRef.current) return;
    const ws = wsRef.current;
    while (sendQueueRef.current.length) {
      if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) break;
      const next = sendQueueRef.current.shift();
      if (!next) break;
      try {
        ws.send(next);
        sendQueueBytesRef.current -= next.byteLength;
      } catch {}
    }
    if (
      sendQueueRef.current.length &&
      ws.bufferedAmount > WS_MAX_BUFFERED_BYTES
    ) {
      if (flushTimerRef.current == null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          flushQueue();
        }, 10);
      }
    }
  }, []);

  const ensureStreamingSocket = useCallback(() => {
    // If there's an existing socket, only keep it if it's OPEN or CONNECTING.
    // After idle timeouts, the socket may be CLOSED but non-null; recreate in that case.
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    const wsUrl = getTranscribeWsUrl();
    if (!wsEndpointLoggedRef.current) {
      try {
        console.info("[SF] WS endpoint", { url: wsUrl });
      } catch {}
      wsEndpointLoggedRef.current = true;
    }
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    wsReadyRef.current = false;
    wsErrorRef.current = null;

    ws.onopen = () => {
      wsReadyRef.current = true;
      wsLastActivityRef.current = Date.now(); // Track activity
      if (metricsRef.current && !metricsRef.current.wsOpenMs)
        metricsRef.current.wsOpenMs =
          typeof performance !== "undefined" ? performance.now() : Date.now();
      trySendStartMessage();
      resetReconnectBackoff();
      flushQueue();
      // Start health monitoring when WebSocket is ready
      startWebSocketHealthCheck();
    };
    ws.onerror = () => {
      wsErrorRef.current = "WebSocket error";
      wsLastActivityRef.current = Date.now(); // Track error as activity
      if (ws.readyState !== WebSocket.OPEN) {
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      }
    };
    ws.onclose = () => {
      wsReadyRef.current = false;
      wsLastActivityRef.current = Date.now(); // Track close as activity
      // Reset start flag on close to allow re-sending start message on reconnect
      startSentRef.current = false;
      // Ensure future sessions can recreate the socket after idle closes
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      scheduleReconnect();
      // Stop health monitoring when connection closes
      stopWebSocketHealthCheck();
    };
  }, [flushQueue, trySendStartMessage]);

  const streamFrame = useCallback(
    (pcmBuf: ArrayBuffer) => {
      // Build header + payload into a single ArrayBuffer
      const payload = new Uint8Array(pcmBuf);
      const header = encodeFrameHeader(
        seqRef.current++,
        payload.byteLength,
        nowRelNs(),
      );
      const out = new Uint8Array(
        (header.byteLength || 16) + payload.byteLength,
      );
      out.set(new Uint8Array(header), 0);
      out.set(payload, header.byteLength || 16);

      // Metrics: count frames/bytes and first-frame timestamp
      if (metricsRef.current) {
        metricsRef.current.framesProduced += 1;
        metricsRef.current.bytesProduced += payload.byteLength;
        if (!metricsRef.current.firstFrameOutMs)
          metricsRef.current.firstFrameOutMs =
            typeof performance !== "undefined" ? performance.now() : Date.now();
      }

      const ws = wsRef.current;
      if (
        ws &&
        wsReadyRef.current &&
        ws.readyState === WebSocket.OPEN &&
        ws.bufferedAmount <= WS_MAX_BUFFERED_BYTES
      ) {
        try {
          // Double-check state right before sending to prevent race condition
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(out.buffer);
            if (metricsRef.current) metricsRef.current.framesSentApprox += 1;
            wsLastActivityRef.current = Date.now(); // Track successful send as activity
          } else {
            // State changed between checks, queue it
            sendQueueRef.current.push(out.buffer);
          }
        } catch (error) {
          // Connection might have closed during send
          console.warn("[useTranscription] Failed to send frame, queuing:", error);
          sendQueueRef.current.push(out.buffer);
        }
      } else {
        // Virtual gate: buffer locally until WS can accept
        sendQueueRef.current.push(out.buffer);
        sendQueueBytesRef.current += out.byteLength;

        // Granular backpressure handling
        if (sendQueueBytesRef.current > WARNING_BUFFER_BYTES && sendQueueBytesRef.current <= CRITICAL_BUFFER_BYTES) {
          console.warn(`[useTranscription] High buffer usage: ${Math.round(sendQueueBytesRef.current / 1024)}KB`);
          // Try more aggressive reconnection
          ensureStreamingSocket();
          scheduleReconnect();
        } else if (sendQueueBytesRef.current > CRITICAL_BUFFER_BYTES && sendQueueBytesRef.current <= MAX_CLIENT_BUFFER_BYTES) {
          console.error(`[useTranscription] Critical buffer usage: ${Math.round(sendQueueBytesRef.current / 1024)}KB, pausing audio worklet`);
          // Pause audio worklet to prevent further buildup
          pauseAudioWorklet();
        } else if (sendQueueBytesRef.current > MAX_CLIENT_BUFFER_BYTES) {
          console.error(`[useTranscription] Buffer limit exceeded: ${Math.round(sendQueueBytesRef.current / 1024)}KB, stopping recording`);
          setError("Network unavailable: buffered audio limit reached");
          // Emergency stop - pause worklet and stop recording
          pauseAudioWorklet();
          setRecording(false);
          return;
        }

        if (metricsRef.current) metricsRef.current.framesQueued += 1;
        flushQueue();
      }
    },
    [flushQueue, ensureStreamingSocket],
  );

  const waitForAllFramesSent = useCallback(
    async (timeoutMs = 1500) => {
      const start = Date.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          flushQueue();
          const ws = wsRef.current;
          if (!ws || !wsReadyRef.current) return resolve();
          if (sendQueueRef.current.length === 0 && ws.bufferedAmount === 0)
            return resolve();
          if (Date.now() - start > timeoutMs) return resolve();
          setTimeout(tick, 10);
        };
        tick();
      });
    },
    [flushQueue],
  );

  // WebSocket health monitoring
  const wsHealthCheckRef = useRef<number | null>(null);
  const wsLastActivityRef = useRef<number>(Date.now());

  // Pause/resume audio worklet functionality
  const pauseAudioWorklet = useCallback(() => {
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ type: 'pause' });
      } catch (error) {
        console.warn("[useTranscription] Failed to pause audio worklet:", error);
      }
    }
  }, []);

  const resumeAudioWorklet = useCallback(() => {
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ type: 'resume' });
      } catch (error) {
        console.warn("[useTranscription] Failed to resume audio worklet:", error);
      }
    }
  }, []);

  // WebSocket health monitoring
  const startWebSocketHealthCheck = useCallback(() => {
    if (wsHealthCheckRef.current) {
      clearInterval(wsHealthCheckRef.current);
    }

    wsHealthCheckRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws) return;

      const now = Date.now();
      const timeSinceActivity = now - wsLastActivityRef.current;
      const timeSinceOpen = wsReadyRef.current ? now - (metricsRef.current?.wsOpenMs || 0) : Infinity;

      // Consider connection unhealthy if:
      // 1. No activity for 10 seconds AND connection has been open for more than 5 seconds
      // 2. Or if there are many queued frames with no progress
      // 3. Or if buffer is still high despite connection being "healthy"
      const isUnhealthy = (
        (timeSinceActivity > 10000 && timeSinceOpen > 5000) ||
        (sendQueueRef.current.length > 10 && timeSinceActivity > 3000) ||
        (sendQueueBytesRef.current > WARNING_BUFFER_BYTES)
      );

      if (isUnhealthy && recording) {
        console.warn(`[useTranscription] WebSocket appears unhealthy, buffer: ${Math.round(sendQueueBytesRef.current / 1024)}KB, pausing audio worklet`);
        pauseAudioWorklet();

        // Try to reconnect
        if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
          ensureStreamingSocket();
        }
      } else if (!isUnhealthy && recording && sendQueueBytesRef.current < WARNING_BUFFER_BYTES) {
        // Resume if connection is healthy again AND buffer is low enough
        if (wsReadyRef.current && ws.readyState === WebSocket.OPEN) {
          resumeAudioWorklet();
        }
      }
    }, 2000); // Check every 2 seconds
  }, [pauseAudioWorklet, resumeAudioWorklet, ensureStreamingSocket, recording]);

  const stopWebSocketHealthCheck = useCallback(() => {
    if (wsHealthCheckRef.current) {
      clearInterval(wsHealthCheckRef.current);
      wsHealthCheckRef.current = null;
    }
  }, []);

  // Device enumeration function
  const enumerateAndSendDevices = useCallback(async () => {
    try {
      // Avoid opening the mic by default; only request permission for labels if explicitly asked
      if (requestLabelPermissionForEnumeration) {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...AUDIO_PROCESSING_TRACK_CONSTRAINTS },
        });
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
  const openStreamForSelectedDevice =
    useCallback(async (): Promise<boolean> => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: {
            sampleRate: MICROPHONE_PREFERRED_RATE,
            channelCount: 1,
            ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
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
        streamRef.current =
          await navigator.mediaDevices.getUserMedia(constraints);

        // Enforce and log actual audio track settings that were applied
        const audioTracks = streamRef.current.getAudioTracks();
        if (audioTracks.length > 0) {
          const track = audioTracks[0];
          try {
            await track.applyConstraints({
              ...AUDIO_PROCESSING_TRACK_CONSTRAINTS,
            } as MediaTrackConstraints);
          } catch {}
          const settings = track.getSettings();
          const capabilities = track.getCapabilities?.() || {};
          
          console.log("[useTranscription] Actual audio track settings:", {
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
            deviceId: settings.deviceId,
            groupId: settings.groupId,
          });
          
          console.log("[useTranscription] Audio track capabilities:", {
            sampleRate: capabilities.sampleRate,
            channelCount: capabilities.channelCount,
            echoCancellation: capabilities.echoCancellation,
            noiseSuppression: capabilities.noiseSuppression,
            autoGainControl: capabilities.autoGainControl,
          });
        }
        
        setReady(true);
        setError(null);
        console.log("[useTranscription] Microphone stream opened successfully");
        return true;
      } catch (err) {
        console.error(
          "[useTranscription] Failed to open microphone stream:",
          err,
        );
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
    // Start cue moved to PTT/button handlers for immediacy

    startSentRef.current = false;
    sessionSelectionPayloadRef.current = null;
    sessionModeRef.current = "dictation";
    setMode("dictation");
    selectionRef.current = null;
    setSelection(null);
    if (window.selection?.inspect) {
      try {
        const snapshot = await window.selection.inspect();
        selectionRef.current = snapshot ?? null;
        setSelection(snapshot ?? null);
        sessionSelectionPayloadRef.current = buildSelectionPayload(snapshot ?? null);
        const nextMode: ClientSessionMode = snapshot?.hadSelection
          ? "edit"
          : "dictation";
        sessionModeRef.current = nextMode;
        setMode(nextMode);
        if (window.devFlags?.devConsoleLogs) {
          console.log("[useTranscription] Selection snapshot", snapshot);
        }
      } catch (err) {
        if (window.devFlags?.devConsoleLogs) {
          console.warn("[useTranscription] Selection inspect failed", err);
        }
        selectionRef.current = null;
        setSelection(null);
        sessionSelectionPayloadRef.current = null;
        sessionModeRef.current = "dictation";
        setMode("dictation");
      }
    }

    if (!streamRef.current) {
      const ok = await openStreamForSelectedDevice();
      if (!ok) return;
    }
    setError(null);
    setText("");
    setRecording(true);

    // Resume audio worklet if it was paused
    resumeAudioWorklet();

    // Reset streaming state
    seqRef.current = 0;
    sendQueueRef.current = [];
    sendQueueBytesRef.current = 0;
    resetReconnectBackoff();
    wsErrorRef.current = null;
    // Keep an existing socket open to allow reuse across sessions
    startedMsRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    metricsRef.current = {
      sessionId: Math.random().toString(36).slice(2),
      pttDownMs: startedMsRef.current,
      framesProduced: 0,
      bytesProduced: 0,
      framesQueued: 0,
      framesSentApprox: 0,
    };

    try {
      // Try to establish the WebSocket early so audio failures don't mask connectivity
      ensureStreamingSocket();
      trySendStartMessage();
      // Create AudioContext at device/hardware rate and attach downsampler worklet
      audioContextRef.current = new AudioContext();
      // Resolve worklet URL for both dev (http://localhost) and prod (file://)
      const workletUrl = (() => {
        try {
          const baseEnv = (
            (import.meta as unknown) as { env?: Record<string, unknown> }
          )?.env?.BASE_URL;
          const base = typeof baseEnv === "string" ? baseEnv : "./";
          const rel = `${base.replace(/\/$/, "")}/worklets/pcm16-downsampler.worklet.js`;
          return new URL(
            rel,
            typeof window !== "undefined" ? window.location.href : "file://",
          ).toString();
        } catch {
          return "worklets/pcm16-downsampler.worklet.js";
        }
      })();
      await audioContextRef.current.audioWorklet.addModule(workletUrl);

      // Initialize VAD (gate-only). Fail gracefully to energy fallback.
      if (VAD_ENABLED) {
        try {
          const eng = new SileroVadEngine();
          await eng.init();
          vadEngineRef.current = eng;
        } catch {
          const fallback = new EnergyVadEngine();
          await fallback.init();
          vadEngineRef.current = fallback;
        }
        vadStreamGateRef.current = new VadStreamGate(
          vadEngineRef.current,
          (ev) => {
            if (window.devFlags?.devConsoleLogs) {
              console.log("[VAD]", ev.type, { atMs: ev.atMs });
            }
          },
        );
        vadReadyRef.current = true;
        // Pre-warm: push a short span of silence to stabilize initial state
        try {
          const warmupFrames = 5; // ~150ms at 30ms windows
          const silence = new Int16Array(SAMPLES_PER_CHUNK);
          for (let i = 0; i < warmupFrames; i++) {
            vadStreamGateRef.current.pushFrame(silence);
          }
        } catch {}
      } else {
        vadEngineRef.current = null;
        vadStreamGateRef.current = null;
        vadReadyRef.current = false;
      }

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

      // Initial unconditional streaming window to avoid start clipping
      let initialBypassSamplesRemaining = TARGET_SAMPLE_RATE * 0.3; // ~300ms at 16k
      workletNodeRef.current.port.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as unknown as { type?: string; samples?: ArrayBuffer };
        if (msg?.type !== "audio" || !msg?.samples) return;
        const buf: ArrayBuffer = msg.samples as ArrayBuffer;

        if (initialBypassSamplesRemaining > 0) {
          const int16 = new Int16Array(buf);
          const take = Math.min(initialBypassSamplesRemaining, int16.length);
          const chunk = int16.subarray(0, take);
          streamFrame(chunk.buffer);
          initialBypassSamplesRemaining -= take;
          if (take < int16.length) {
            const rest = int16.subarray(take);
            // process remainder through gate if enabled
            if (VAD_ENABLED && vadReadyRef.current && vadStreamGateRef.current) {
              const chunks = vadStreamGateRef.current.pushFrame(rest);
              for (const c of chunks) streamFrame(c.buffer);
            } else {
              streamFrame(rest.buffer);
            }
          }
          return;
        }

        if (VAD_ENABLED && vadReadyRef.current && vadStreamGateRef.current) {
          const chunks = vadStreamGateRef.current.pushFrame(buf);
          if (chunks.length === 0) {
            if (metricsRef.current) {
              metricsRef.current.framesDropped = (metricsRef.current.framesDropped ?? 0) + 1;
            }
            if (window.devFlags?.devConsoleLogs) {
              console.debug("[VAD] drop frame (silence)");
            }
          }
          for (const chunk of chunks) {
            streamFrame(chunk.buffer);
            if (metricsRef.current) {
              metricsRef.current.framesForwarded = (metricsRef.current.framesForwarded ?? 0) + 1;
            }
            if (window.devFlags?.devConsoleLogs) {
              console.debug("[VAD] forward frame (speech)");
            }
          }
        } else {
          // No VAD: pass-through
          streamFrame(buf);
        }
      };

      // Connect source -> worklet (silent path)
      sourceNodeRef.current.connect(workletNodeRef.current);
      // Ensure WS is connected; start is sent on open
      ensureStreamingSocket();

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

    // Pause audio worklet when stopping to prevent buffer buildup
    pauseAudioWorklet();
    // Stop health monitoring when not recording
    stopWebSocketHealthCheck();

    setProcessing(true);
    if (metricsRef.current && !metricsRef.current.stopInvokedMs) {
      metricsRef.current.stopInvokedMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }

    try {
      // Streaming-only: flush any queued frames and signal end; wait for final
      if (wsRef.current && !wsErrorRef.current) {
        abortControllerRef.current = new AbortController();
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const ws = wsRef.current;
          if (!ws) {
            reject(new Error("WebSocket not available"));
            return;
          }

          const cleanup = (abortOnly = false) => {
            try { ws.removeEventListener("message", onMessage as EventListener); } catch {}
            try { ws.removeEventListener("error", onError as EventListener); } catch {}
            try { ws.removeEventListener("close", onClose as EventListener); } catch {}
            try {
              abortControllerRef.current?.signal.removeEventListener(
                "abort",
                onAbort,
              );
            } catch {}
            try {
              if (!abortOnly && timeoutId) clearTimeout(timeoutId);
            } catch {}
          };

          const onAbort = () => {
            if (!settled) {
              settled = true;
              cleanup(true);
              // Inform server to drop the session if the socket is still open
              try {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "cancel" }));
                }
              } catch {}
              reject(new DOMException("Aborted", "AbortError"));
            }
          };
          const signal = abortControllerRef.current?.signal;
          signal?.addEventListener("abort", onAbort);

          const onMessage = async (event: MessageEvent) => {
            try {
              const msg = JSON.parse(String(event.data));
              if (msg.type === "status" && msg.state === "processing") {
                if (!metricsRef.current?.sttStartMs) {
                  if (metricsRef.current)
                    metricsRef.current.sttStartMs =
                      typeof performance !== "undefined"
                        ? performance.now()
                        : Date.now();
                }
                if (window.devFlags?.devConsoleLogs)
                  console.info("[SF] Transcribe processing started");
              } else if (msg.type === "llm_status" && msg.state === "llm_processing") {
                if (window.devFlags?.devConsoleLogs)
                  console.info("[SF] LLM post-process started");
              } else if (msg.type === "llm_delta" && typeof msg.delta === "string") {
                // Progressive UI update only; paste remains on final
                setText((prev) => {
                  const next = (prev || "") + msg.delta;
                  try { window.transcript?.update(next); } catch {}
                  return next;
                });
              } else if (msg.type === "final") {
                if (!settled) {
                  settled = true;
                  try {
                    setText(msg.text || "");
                    if (msg.text) {
                      window.transcript?.update(msg.text);
                      if (metricsRef.current)
                        metricsRef.current.pasteStartMs =
                          typeof performance !== "undefined"
                            ? performance.now()
                            : Date.now();
                      if (!suppressNativePaste) {
                        try {
                          await window.clipboard.insertText(msg.text);
                          if (metricsRef.current)
                            metricsRef.current.pasteDoneMs =
                              typeof performance !== "undefined"
                                ? performance.now()
                                : Date.now();
                        } catch {}
                      }
                    }
                    if (metricsRef.current) {
                      metricsRef.current.sttEndMs =
                        typeof performance !== "undefined"
                          ? performance.now()
                          : Date.now();
                      metricsRef.current.finalRenderMs =
                        metricsRef.current.sttEndMs;
                      try {
                        // Unified timeline: client + worker (if provided)
                        const m = metricsRef.current;
                        const client = {
                          sessionId: m.sessionId,
                          pttDownMs: m.pttDownMs,
                          stopInvokedMs: m.stopInvokedMs ?? null,
                          wsOpenMs: m.wsOpenMs ?? null,
                          firstFrameOutMs: m.firstFrameOutMs ?? null,
                          lastFrameOutMs: m.lastFrameOutMs ?? null,
                          endSentMs: m.endSentMs ?? m.wsEndMs ?? null,
                          statusRecvMs: m.sttStartMs ?? null,
                          finalRecvMs: m.sttEndMs ?? null,
                          pasteStartMs: m.pasteStartMs ?? null,
                          pasteDoneMs: m.pasteDoneMs ?? null,
                        } as const;

                        const worker = (msg?.metrics?.worker ?? null) as
                          | {
                              traceId?: string;
                              wsAcceptAt?: number | null;
                              startedAt?: number | null;
                              processingStartAt?: number | null;
                              frames?: number;
                              bytes?: number;
                              seqGaps?: number;
                              firstArrivalMs?: number | null;
                              lastArrivalMs?: number | null;
                              firstToLastArrivalMs?: number | null;
                              assembleMs?: number | null;
                              stt?: {
                                provider?: string | null;
                                startAt?: number | null;
                                headersAt?: number | null;
                                bodyDoneAt?: number | null;
                                ttfbMs?: number | null;
                                bodyMs?: number | null;
                                totalMs?: number | null;
                              } | null;
                              groq?: {
                                provider?: string | null;
                                startAt?: number | null;
                                headersAt?: number | null;
                                bodyDoneAt?: number | null;
                                ttfbMs?: number | null;
                                bodyMs?: number | null;
                                totalMs?: number | null;
                              } | null;
                              llm?: {
                                provider?: string | null;
                                startAt?: number | null;
                                headersAt?: number | null;
                                firstDeltaAt?: number | null;
                                bodyDoneAt?: number | null;
                                ttfbMs?: number | null;
                                bodyMs?: number | null;
                                totalMs?: number | null;
                              } | null;
                              finalSentAt?: number | null;
                            }
                          | null;

                        const endSent = client.endSentMs ?? null;
                        const statusRecv = client.statusRecvMs ?? null;
                        const finalRecv = client.finalRecvMs ?? null;
                        const pasteDone = client.pasteDoneMs ?? null;

                        const wsOpenDeltaMs =
                          client.wsOpenMs != null
                            ? Math.round(client.wsOpenMs - client.pttDownMs)
                            : null;
                        const endSendToStatusMs =
                          endSent != null && statusRecv != null
                            ? Math.round(statusRecv - endSent)
                            : null;
                        const statusToFinalRecvMs =
                          statusRecv != null && finalRecv != null
                            ? Math.round(finalRecv - statusRecv)
                            : null;
                        const finalToPasteDoneMs =
                          pasteDone != null && finalRecv != null
                            ? Math.round(pasteDone - finalRecv)
                            : null;
                        const totalPttDownToPasteMs =
                          pasteDone != null
                            ? Math.round(pasteDone - client.pttDownMs)
                            : finalRecv != null
                              ? Math.round(finalRecv - client.pttDownMs)
                              : null;

                        // New metrics split
                        const dictationMs =
                          m.stopInvokedMs != null
                            ? Math.max(0, Math.round(m.stopInvokedMs - m.pttDownMs))
                            : null;
                        const postDictationE2eMs = (() => {
                          const anchor = m.stopInvokedMs ?? null; // hotkey up / user ends dictation
                          if (anchor == null) return null;
                          if (pasteDone != null) return Math.max(0, Math.round(pasteDone - anchor));
                          if (finalRecv != null) return Math.max(0, Math.round(finalRecv - anchor));
                          return null;
                        })();

                        const captureMs = (() => {
                          const pr =
                            (m.postRollEndMs ?? 0) - (m.postRollStartMs ?? 0);
                          const drain =
                            (m.drainDoneMs ?? 0) - (m.lastFrameOutMs ?? 0);
                          const sum = (pr > 0 ? pr : 0) + (drain > 0 ? drain : 0);
                          return sum > 0 ? Math.round(sum) : null;
                        })();
                        const sttMs = (() => {
                          const total =
                            worker?.stt?.totalMs ?? worker?.groq?.totalMs ?? null;
                          return total != null ? Math.round(total) : statusToFinalRecvMs;
                        })();
                        // Compute deliver latency without relying on cross-host clock sync:
                        // estimate = (finalRecv - statusRecv) - sttMs
                        const deliverMs =
                          statusRecv != null && finalRecv != null && sttMs != null
                            ? Math.max(0, Math.round(finalRecv - statusRecv - (sttMs || 0)))
                            : null;

                        // Compact single-line breakdown
                        const breakdown = {
                          traceId:
                            (msg?.traceId as string | undefined) || m.sessionId,
                          // Redefine e2eMs to mean post-dictation latency (stop -> paste)
                          e2eMs: postDictationE2eMs,
                          dictationMs,
                          totalMs: totalPttDownToPasteMs,
                          wsOpenMs: wsOpenDeltaMs,
                          captureMs,
                          endToStatusMs: endSendToStatusMs,
                          sttMs,
                          deliverMs,
                          pasteMs: finalToPasteDoneMs,
                          frames: m.framesProduced,
                          bytesKB: Number((m.bytesProduced / 1024).toFixed(1)),
                          seqGaps: (msg?.metrics?.worker?.seqGaps as number) ?? 0,
                        };

                        console.log("[SF] E2E", breakdown);
                        // Post client metrics to the API for a unified summary
                        try {
                          const payload = {
                            traceId: breakdown.traceId,
                            client: {
                              sessionId: m.sessionId,
                              pttDownMs: m.pttDownMs,
                              stopInvokedMs: m.stopInvokedMs ?? null,
                              wsOpenMs: m.wsOpenMs ?? null,
                              firstFrameOutMs: m.firstFrameOutMs ?? null,
                              lastFrameOutMs: m.lastFrameOutMs ?? null,
                              endSentMs: m.endSentMs ?? m.wsEndMs ?? null,
                              statusRecvMs: m.sttStartMs ?? null,
                              finalRecvMs: m.sttEndMs ?? null,
                              pasteStartMs: m.pasteStartMs ?? null,
                              pasteDoneMs: m.pasteDoneMs ?? null,
                              framesProduced: m.framesProduced,
                              bytesProduced: m.bytesProduced,
                            },
                            worker: msg?.metrics?.worker ?? null,
                            // New: forward dataset texts from server so /metrics/session can log them
                            dataset: (msg?.dataset as { sttText?: string | null; llmText?: string | null } | undefined) ?? null,
                            derived: {
                              // e2eMs now represents post-dictation latency
                              e2eMs: breakdown.e2eMs,
                              dictationMs: breakdown.dictationMs,
                              totalMs: breakdown.totalMs,
                              captureMs: breakdown.captureMs,
                              deliverMs: breakdown.deliverMs,
                              pasteMs: breakdown.pasteMs,
                            },
                            meta: {
                              appVersion:
                                (
                                  (window as unknown as {
                                    electronAppVersion?: string;
                                  }).electronAppVersion || undefined
                                ),
                              platform: navigator.userAgent,
                            },
                          };
                          const url = getMetricsUrl();
                          fetch(url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                          }).catch(() => undefined);
                        } catch {}
                      } catch {}
                    }
                  } catch {}
                  // Close per-session to avoid stale sockets
                  try {
                    ws.close(1000, "session_complete");
                  } catch {}
                  cleanup();
                  resolve();
                }
              } else if (msg.type === "error") {
                if (!settled) {
                  settled = true;
                  // Close after receiving error response
                  try {
                    ws.close(1011, "server error");
                  } catch {}
                  cleanup();
                  reject(
                    new Error(`Server error: ${msg.body || "Unknown error"}`),
                  );
                }
              }
            } catch {}
          };

          const onError = () => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error("WebSocket connection error"));
            }
          };
          const onClose = () => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error("WebSocket closed before final"));
            }
          };

          ws.addEventListener("message", onMessage as EventListener);
          ws.addEventListener("error", onError as EventListener);
          ws.addEventListener("close", onClose as EventListener);

          // Final safety timeout in case server never replies
          const timeoutMs = 15000;
          const timeoutId = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error("Timed out waiting for transcription result"));
            }
          }, timeoutMs);

          // Tail capture, then final flush and 'end'
          (async () => {
            try {
              // Capture a short post-roll tail to avoid clipping the last syllable
              if (POST_ROLL_MS > 0) {
                if (metricsRef.current && !metricsRef.current.postRollStartMs)
                  metricsRef.current.postRollStartMs =
                    typeof performance !== "undefined"
                      ? performance.now()
                      : Date.now();
                await new Promise((r) => setTimeout(r, POST_ROLL_MS));
                if (metricsRef.current && !metricsRef.current.postRollEndMs)
                  metricsRef.current.postRollEndMs =
                    typeof performance !== "undefined"
                      ? performance.now()
                      : Date.now();
              }

              // Ask the worklet to flush any partial frame before tearing down
              try {
                workletNodeRef.current?.port.postMessage({ type: "flush" });
              } catch {}
              // Record last-frame-out time right after requesting flush
              if (metricsRef.current && !metricsRef.current.lastFrameOutMs)
                metricsRef.current.lastFrameOutMs =
                  typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();

              // Flush any VAD post-roll (gate-only currently returns empty)
              try {
                if (VAD_ENABLED && vadStreamGateRef.current) {
                  const tail = vadStreamGateRef.current.flushPostRoll();
                  for (const chunk of tail) streamFrame(chunk.buffer);
                }
              } catch {}

              await waitForAllFramesSent();
              if (metricsRef.current && !metricsRef.current.drainDoneMs)
                metricsRef.current.drainDoneMs =
                  typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();

              // Send 'end' immediately after drain completes to minimize latency.
              try {
                if (metricsRef.current)
                  metricsRef.current.wsEndMs =
                    typeof performance !== "undefined"
                      ? performance.now()
                      : Date.now();
                if (metricsRef.current)
                  metricsRef.current.endSentMs = metricsRef.current.wsEndMs;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "end" }));
                } else if (ws.readyState === WebSocket.CONNECTING) {
                  // If still connecting, send on open
                  const sendOnOpen = () => {
                    try {
                      ws.send(JSON.stringify({ type: "end" }));
                    } catch {}
                    ws.removeEventListener("open", sendOnOpen as EventListener);
                  };
                  ws.addEventListener("open", sendOnOpen as EventListener, {
                    once: true,
                  } as AddEventListenerOptions);
                } else {
                  // Socket closed: request a fresh one for next session and fail fast
                  try {
                    ws.close();
                  } catch {}
                }
              } catch {}

              // Disconnect nodes after signaling end (do not block end send on audio teardown)
              try {
                sourceNodeRef.current?.disconnect();
              } catch {}
              try {
                workletNodeRef.current?.port.postMessage({ type: "reset" });
              } catch {}
              try {
                workletNodeRef.current?.disconnect();
              } catch {}
              if (audioContextRef.current) {
                try {
                  await audioContextRef.current.close();
                } catch {}
                audioContextRef.current = null;
              }
              if (streamRef.current) {
                try {
                  streamRef.current.getTracks().forEach((track) => track.stop());
                } catch {}
                streamRef.current = null;
                setReady(false);
              }
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
          console.error("[SF] Transcribe exception", {
            error: (err as Error)?.message,
          });
        }
        setError((err as Error).message);
      }
    } finally {
      setProcessing(false);
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      abortControllerRef.current = null;
      // Dispose VAD
      try { vadStreamGateRef.current?.dispose(); } catch {}
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch {}
      vadEngineRef.current = null;
      vadReadyRef.current = false;
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }
      // Reset metrics
      metricsRef.current = null;
      // Reset client-side queue/backoff
      sendQueueRef.current = [];
      sendQueueBytesRef.current = 0;
      resetReconnectBackoff();
    }
  }, [recording]);

  const cancel = useCallback(async () => {
    // Cancel discards current capture, does not send audio, and does not close WS
    // Also abort any in-flight processing if present
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
      abortControllerRef.current = null;
    }

    // Pause audio worklet when canceling to prevent buffer buildup
    pauseAudioWorklet();
    // Stop health monitoring when canceling
    stopWebSocketHealthCheck();

    try {
      // Disconnect nodes and clean up (discard captured audio)
      try {
        sourceNodeRef.current?.disconnect();
      } catch {}
      try {
        workletNodeRef.current?.disconnect();
      } catch {}
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
        streamRef.current = null;
        setReady(false);
      }
      // Reset streaming state and proactively close the socket
      sendQueueRef.current = [];
      sendQueueBytesRef.current = 0;
      seqRef.current = 0;
      // Dispose VAD
      try { vadStreamGateRef.current?.dispose(); } catch {}
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch {}
      vadEngineRef.current = null;
      vadReadyRef.current = false;
      if (wsRef.current) {
        try {
          if (wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: "cancel" }));
        } catch {}
        try {
          wsRef.current.close(1000, "cancel");
        } catch {}
        wsRef.current = null;
        wsReadyRef.current = false;
      }
    } finally {
      setRecording(false);
      setProcessing(false);
      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }
      // Clear metrics for a fresh next session
      metricsRef.current = null;
      resetReconnectBackoff();
    }
  }, [recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop health monitoring
      stopWebSocketHealthCheck();

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
        try {
          audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }

      // Dispose VAD
      try { vadStreamGateRef.current?.dispose(); } catch {}
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch {}
      vadEngineRef.current = null;
      vadReadyRef.current = false;

      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
        streamRef.current = null;
      }

      // Clear any pending timers
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Abort any pending operations
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {}
        abortControllerRef.current = null;
      }
    };
  }, [stopWebSocketHealthCheck]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    mode,
    selection,
    start,
    stop,
    cancel,
  };
}
