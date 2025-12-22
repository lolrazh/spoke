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
import { getTranscribeWsUrl } from "../config/api";
import { AUDIO_PROCESSING_TRACK_CONSTRAINTS } from "../config/audioConstraints";
import { encodeFrameHeader } from "../utils/pcm";
import { VAD_ENABLED } from "../config/vad";
import { SileroVadEngine, EnergyVadEngine } from "../utils/vadEngine";
import { VadStreamGate } from "../utils/vadStreamGate";
import { buildSTTPrompt, type SttPromptIdentity } from "../../shared/sttPrompt";
import {
  getUserIdentity,
  initUserIdentity,
  subscribeUserIdentity,
} from "../state/userIdentity";
import { addTranscription } from "../state/transcriptionHistory";
import { ErrorCode } from "../types/errors";
import {
  createAppError,
  parseServerError,
  detectNetworkError,
  parseMediaError,
  parseWebSocketError,
  getUserMessage,
  logError,
} from "../utils/errorHandler";
import type { ServerErrorResponse } from "../types/errors";

// Auth-related WebSocket close codes from the Worker
const WS_CLOSE_UNAUTHORIZED = 4010;
const WS_CLOSE_PAYMENT_REQUIRED = 4020;
const WS_CLOSE_QUOTA_EXCEEDED = 4021;
const WS_CLOSE_AUTH_TIMEOUT = 4011;

// Auth error types for UI handling
export type AuthErrorType = "not_signed_in" | "payment_required" | "auth_failed" | null;

// Define the hook's return type
export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  /** Auth-specific error type for UI to show appropriate prompts */
  authError: AuthErrorType;
  mode: ClientSessionMode;
  selection: SelectionInspectSnapshot | null;
  audioLevel: number; // 0-1 range representing current audio input level
  start: () => void;
  stop: () => void;
  cancel: () => void;
  /** Clear auth error (e.g., after user dismisses upgrade prompt) */
  clearAuthError: () => void;
  /** Pre-connect to Worker to avoid first-dictation latency */
  preConnect: () => Promise<void>;
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
  /**
   * When true, transcription text may be forwarded to metrics/session for telemetry.
   */
  shareTranscriptionsEnabled?: boolean;
}

export function useTranscription(
  options?: UseTranscriptionOptions,
): UseTranscriptionReturn {
  const {
    autoEnumerateDevices = true,
    autoInitStream = true,
    requestLabelPermissionForEnumeration = false,
    suppressNativePaste = false,
    shareTranscriptionsEnabled = false,
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
  // Singleflight: Track in-flight connection to prevent parallel WebSocket stampede
  // If this is non-null, a connection attempt is already in progress - return this promise instead of creating new connection
  const connectionPromiseRef = useRef<Promise<void> | null>(null);
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

  // OCR context (screenshot) - captured early, sent once WS is ready
  const pendingOcrImageBase64Ref = useRef<string | null>(null);

  const [recording, setRecording] = useState(false);
  // Track when start() is in-flight (between call and setRecording(true))
  // This prevents the race condition where double-tap stop() returns early because recording is still false
  const startingRef = useRef(false);
  // Cancellation token for in-flight start(): increment to invalidate any pending async continuation.
  // This is required because stop()/cancel() can run while start() awaits auth/worklet setup.
  const startTokenRef = useRef(0);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ClientSessionMode>("dictation");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const audioLevelRef = useRef<number>(0); // For smoothing
  const selectionRef = useRef<SelectionInspectSnapshot | null>(null);
  const [selection, setSelection] = useState<SelectionInspectSnapshot | null>(null);
  const sessionSelectionPayloadRef = useRef<SelectionSnapshotPayload | null>(null);
  const sessionModeRef = useRef<ClientSessionMode>("dictation");
  const startSentRef = useRef(false);
  const pendingSelectionPromiseRef = useRef<
    Promise<SelectionInspectSnapshot | null> | null
  >(null);
  const selectionGateDeadlineRef = useRef<number | null>(null);
  const selectionGateTimerRef = useRef<number | null>(null);
  const shareTranscriptionsRef = useRef<boolean>(shareTranscriptionsEnabled);
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [authError, setAuthError] = useState<AuthErrorType>(null);

  // Auth state for WebSocket authentication
  const wsAuthenticatedRef = useRef<boolean>(false);
  const wsAuthPendingRef = useRef<boolean>(false);
  const wsAuthFailedRef = useRef<boolean>(false); // Track auth failures to prevent reconnects

  const initialIdentity = getUserIdentity();
  const identityRef = useRef<SttPromptIdentity>({
    name: initialIdentity.name,
    email: initialIdentity.email,
  });
  const userIdRef = useRef<string | null>(null);
  const sttPromptRef = useRef<string>(
    buildSTTPrompt({ identity: identityRef.current })
  );
  const lastLoggedPromptRef = useRef<string | null>(null);

  const buildSelectionPayload = useCallback(
    (snapshot: SelectionInspectSnapshot | null): SelectionSnapshotPayload | null => {
      if (!snapshot) return null;
      const range: SelectionRange | null = snapshot.range ?? null;
      return {
        status: snapshot.status,
        hadSelection: snapshot.hadSelection,
        text: snapshot.selectedText ?? null,
        range,
        valueLength: snapshot.valueLength ?? null,
        source: snapshot.source,
      };
    },
    [],
  );

  const applySelectionSnapshot = useCallback(
    (snapshot: SelectionInspectSnapshot | null) => {
      const nextSnapshot = snapshot ?? null;
      selectionRef.current = nextSnapshot;
      setSelection(nextSnapshot);
      sessionSelectionPayloadRef.current = buildSelectionPayload(nextSnapshot);
      const nextMode: ClientSessionMode = nextSnapshot?.hadSelection
        ? "edit"
        : "dictation";
      sessionModeRef.current = nextMode;
      setMode(nextMode);
    },
    [buildSelectionPayload],
  );

  const clearSelectionGateTimer = useCallback(() => {
    if (selectionGateTimerRef.current != null) {
      clearTimeout(selectionGateTimerRef.current);
      selectionGateTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    shareTranscriptionsRef.current = !!shareTranscriptionsEnabled;
  }, [shareTranscriptionsEnabled]);

  // Fetch and cache user ID for metrics
  useEffect(() => {
    (async () => {
      try {
        const { getCurrentUser } = await import("../lib/supabaseClient");
        const user = await getCurrentUser();
        userIdRef.current = user?.id ?? null;
      } catch {
        userIdRef.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeUserIdentity((next) => {
      identityRef.current = {
        name: next.name,
        email: next.email,
      };
      const prompt = buildSTTPrompt({ identity: identityRef.current });
      sttPromptRef.current = prompt;
      if (lastLoggedPromptRef.current !== prompt) {
        lastLoggedPromptRef.current = prompt;
        try {
          console.info("[SF] STT prompt", prompt);
        } catch { }
      }
    });
    initUserIdentity().catch((): null => null);
    return () => {
      unsubscribe();
    };
  }, []);

  const trySendStartMessage = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || startSentRef.current) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    // CRITICAL: Don't send start until auth is complete!
    // This prevents a race condition where the selection gate timer or other
    // async code paths try to send 'start' before the auth handshake finishes.
    if (!wsAuthenticatedRef.current || !wsReadyRef.current) {
      // Auth not complete yet - start will be sent from auth_ok handler
      if (window.devFlags?.devConsoleLogs) {
        console.debug("[SF] trySendStartMessage: waiting for auth", {
          authenticated: wsAuthenticatedRef.current,
          ready: wsReadyRef.current,
        });
      }
      return;
    }
    const traceId = metricsRef.current?.sessionId;
    if (!traceId) return;

    const gateDeadline = selectionGateDeadlineRef.current;
    if (pendingSelectionPromiseRef.current && gateDeadline != null) {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now < gateDeadline) {
        return;
      }
      selectionGateDeadlineRef.current = null;
    }

    const startPayload: {
      type: "start";
      version: 2;
      format: "pcm16le";
      rate: number;
      language: string;
      traceId: string;
      mode?: ClientSessionMode;
      selection?: SelectionSnapshotPayload | null;
      shareTranscriptions: boolean;
      identity?: { name?: string; email?: string };
    } = {
      type: "start",
      version: 2,
      format: "pcm16le",
      rate: TARGET_SAMPLE_RATE,
      language: "en",
      traceId,
      shareTranscriptions: shareTranscriptionsRef.current,
    };

    if (sessionModeRef.current) {
      startPayload.mode = sessionModeRef.current;
    }

    if (sessionSelectionPayloadRef.current) {
      startPayload.selection = sessionSelectionPayloadRef.current;
    }

    const identity = identityRef.current;
    const name = typeof identity?.name === "string" ? identity.name.trim() : "";
    const email = typeof identity?.email === "string" ? identity.email.trim() : "";
    if (name || email) {
      startPayload.identity = {};
      if (name) startPayload.identity.name = name;
      if (email) startPayload.identity.email = email;
    }

    try {
      if (sttPromptRef.current) {
        console.info("[SF] Using STT prompt", sttPromptRef.current);
      }
    } catch { }

    try {
      ws.send(JSON.stringify(startPayload));
      startSentRef.current = true;
      clearSelectionGateTimer();
    } catch (err) {
      if (window.devFlags?.devConsoleLogs) {
        console.warn("[useTranscription] Failed to send start payload", err);
      }
    }
  }, [clearSelectionGateTimer]);

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

  // Calculate RMS (Root Mean Square) audio level from PCM16 samples with smoothing
  const calculateAudioLevel = (buffer: ArrayBuffer): number => {
    try {
      const samples = new Int16Array(buffer);
      if (samples.length === 0) return audioLevelRef.current;

      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const normalized = samples[i] / 32768; // Normalize to -1 to 1
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / samples.length);

      // Logarithmic response curve - natural audio perception
      // Expands quiet sounds, compresses loud sounds, prevents flat-topping
      const x = rms * 5; // Sensitivity multiplier
      const log = Math.log10(1 + x * 9) / Math.log10(10); // log10(1 to 10) normalized to 0-1
      const rawLevel = Math.min(1, log * 1.15); // Slight boost

      // Light smoothing for responsive but stable visualization
      const smoothingFactor = 0.3; // Balanced smoothing
      const smoothedLevel = audioLevelRef.current * smoothingFactor + rawLevel * (1 - smoothingFactor);
      audioLevelRef.current = smoothedLevel;

      return smoothedLevel;
    } catch {
      return audioLevelRef.current;
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
      const networkError = detectNetworkError();
      const error = networkError || createAppError(
        ErrorCode.WS_CONNECTION_FAILED,
        "Max reconnect attempts exceeded",
        { attempts: reconnectAttemptRef.current }
      );
      logError(error, "[useTranscription]");
      setError(getUserMessage(error));

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
      } catch { }
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

  const trySendOcrContext = useCallback(() => {
    const imageBase64 = pendingOcrImageBase64Ref.current;
    const ws = wsRef.current;
    if (!imageBase64) return;
    if (!ws || !wsReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "context_ocr", imageBase64 }));
      pendingOcrImageBase64Ref.current = null;
      console.log("[OCR] Screenshot sent to worker");
    } catch (err) {
      console.warn("[OCR] Failed to send screenshot to worker:", err);
    }
  }, []);

  const ensureStreamingSocket = useCallback(async (): Promise<void> => {
    // SINGLEFLIGHT: If a connection attempt is already in progress, return that promise
    // This prevents the "3 loadShed" stampede where multiple callers create parallel WebSockets
    if (connectionPromiseRef.current) {
      return connectionPromiseRef.current;
    }

    // If there's an existing socket that's authenticated, keep it
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if ((rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) && wsAuthenticatedRef.current) {
        return; // Already connected and authenticated
      }
      try {
        wsRef.current.close();
      } catch { }
      wsRef.current = null;
    }

    // Create the connection promise and store it for singleflight
    const connectionPromise = (async (): Promise<void> => {
      // Reset auth state for new connection
      wsAuthenticatedRef.current = false;
      wsAuthPendingRef.current = false;
      wsAuthFailedRef.current = false; // Clear previous auth failure state

      // Get access token for authentication
      let accessToken: string | null = null;
      try {
        const { getAccessToken } = await import("../lib/supabaseClient");
        accessToken = await getAccessToken();
      } catch (err) {
        console.warn("[useTranscription] Failed to get access token:", err);
      }

      // If no token, user is not signed in
      if (!accessToken) {
        console.warn("[useTranscription] No access token - user not signed in");
        setAuthError("not_signed_in");
        setError("Sign in to start dictating.");
        throw new Error("Not signed in");
      }

      const wsUrl = getTranscribeWsUrl();
      if (!wsEndpointLoggedRef.current) {
        try {
          console.info("[SF] WS endpoint", { url: wsUrl });
        } catch { }
        wsEndpointLoggedRef.current = true;
      }
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      wsReadyRef.current = false;
      wsErrorRef.current = null;

      // Create a Promise that resolves when auth succeeds or rejects when it fails
      return new Promise<void>((resolve, reject) => {
        // Timeout for the entire auth process (connection + auth)
        const authTimeout = setTimeout(() => {
          reject(new Error("Auth timeout"));
        }, 15000); // 15 seconds total (includes connection time)

        const cleanup = () => {
          clearTimeout(authTimeout);
        };

        ws.addEventListener("open", () => {
          wsLastActivityRef.current = Date.now(); // Track activity
          if (metricsRef.current && !metricsRef.current.wsOpenMs)
            metricsRef.current.wsOpenMs =
              typeof performance !== "undefined" ? performance.now() : Date.now();

          // Send auth message immediately on open
          wsAuthPendingRef.current = true;
          try {
            ws.send(
              JSON.stringify({
                type: "auth",
                token: accessToken,
                traceId: metricsRef.current?.sessionId,
              }),
            );
            console.info("[SF] Auth message sent");
          } catch (err) {
            console.error("[useTranscription] Failed to send auth message:", err);
            wsAuthPendingRef.current = false;
          }

          resetReconnectBackoff();
        });

        ws.addEventListener("message", (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data));

            // Handle auth response
            if (msg.type === "auth_ok") {
              console.info("[SF] Auth successful", { userId: msg.userId });
              wsAuthenticatedRef.current = true;
              wsAuthPendingRef.current = false;
              wsReadyRef.current = true;
              setAuthError(null); // Clear any previous auth error
              cleanup();
              resolve(); // Auth succeeded - resolve the Promise

              // Now we can send start message and flush queue
              trySendStartMessage();
              trySendOcrContext();
              flushQueue();
              // Start health monitoring when WebSocket is authenticated
              startWebSocketHealthCheck();
              return;
            }

            if (msg.type === "auth_error") {
              console.error("[SF] Auth failed:", msg.error, "code:", msg.code);
              wsAuthPendingRef.current = false;
              cleanup();
              reject(new Error(`Auth failed: ${msg.error}`));
              // The server will close the connection, onclose will handle cleanup
              return;
            }
          } catch {
            // Not a JSON message or parse error - ignore for auth handling
          }
        });

        ws.addEventListener("error", (event: Event) => {
          const error = parseWebSocketError(event, { readyState: ws.readyState });
          wsErrorRef.current = getUserMessage(error);
          logError(error, "[useTranscription] WebSocket");
          wsLastActivityRef.current = Date.now(); // Track error as activity
          wsAuthPendingRef.current = false;
          if (ws.readyState !== WebSocket.OPEN) {
            if (wsRef.current === ws) wsRef.current = null;
            // Don't reconnect if this is an auth failure (close handler will set the error)
            if (!wsAuthFailedRef.current) {
              scheduleReconnect();
            }
          }
        });

        ws.addEventListener("close", (event: CloseEvent) => {
          wsReadyRef.current = false;
          wsAuthenticatedRef.current = false;
          wsAuthPendingRef.current = false;
          wsLastActivityRef.current = Date.now(); // Track close as activity
          // Reset start flag on close to allow re-sending start message on reconnect
          startSentRef.current = false;

          // Handle auth-specific close codes
          if (event.code === WS_CLOSE_UNAUTHORIZED || event.code === WS_CLOSE_AUTH_TIMEOUT) {
            console.warn("[SF] Auth failed - unauthorized or timeout", { code: event.code, reason: event.reason });
            wsAuthFailedRef.current = true; // Mark as auth failure to prevent reconnects
            setAuthError("auth_failed");
            setError("Session expired. Please sign in again.");
            cleanup();
            reject(new Error("Auth failed"));
            // Don't auto-reconnect for auth failures
            if (wsRef.current === ws) {
              wsRef.current = null;
            }
            stopWebSocketHealthCheck();
            return;
          }

          if (event.code === WS_CLOSE_PAYMENT_REQUIRED) {
            console.warn("[SF] Payment required", { code: event.code, reason: event.reason });
            wsAuthFailedRef.current = true; // Mark as auth failure to prevent reconnects
            setAuthError("payment_required");
            setError("Upgrade to Pro for unlimited dictation.");
            cleanup();
            reject(new Error("Payment required"));
            // Don't auto-reconnect for payment required
            if (wsRef.current === ws) {
              wsRef.current = null;
            }
            stopWebSocketHealthCheck();
            return;
          }

          if (event.code === WS_CLOSE_QUOTA_EXCEEDED) {
            console.warn("[SF] Quota exceeded", { code: event.code, reason: event.reason });
            wsAuthFailedRef.current = true; // Mark as auth failure to prevent reconnects
            setAuthError("payment_required"); // Reuse payment_required UI (shows upgrade prompt)
            setError("You've used your free words this week. Upgrade for unlimited.");
            cleanup();
            reject(new Error("Quota exceeded"));
            // Don't auto-reconnect for quota exceeded
            if (wsRef.current === ws) {
              wsRef.current = null;
            }
            stopWebSocketHealthCheck();
            return;
          }

          // Handle unexpected close codes (like 1003 from Cloudflare edge rejection)
          // These are retryable - reject the Promise so ensureStreamingSocket can retry
          // Code 1000 (Normal Closure) is not an error, so only log true errors
          if (event.code !== 1000) {
            console.warn("[SF] WebSocket closed unexpectedly during auth", {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean
            });
          }

          // Clean up this connection attempt
          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          stopWebSocketHealthCheck();

          // Reject the Promise so the caller knows auth failed and can retry
          // For code 1000, this is a graceful close (likely session completed on another connection)
          cleanup();
          reject(new Error(`WebSocket closed during auth (code ${event.code}): ${event.reason || 'unknown'}`));
        });
      }); // Close the inner Promise (returned by the IIFE)
    })(); // Close the async IIFE

    // Store the promise for singleflight and clear it when done
    connectionPromiseRef.current = connectionPromise.finally(() => {
      connectionPromiseRef.current = null;
    });

    return connectionPromiseRef.current;
  }, [flushQueue, trySendOcrContext, trySendStartMessage]);

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
          const error = createAppError(
            ErrorCode.BUFFER_OVERFLOW,
            "Buffer limit exceeded",
            { bufferKB: Math.round(sendQueueBytesRef.current / 1024) }
          );
          logError(error, "[useTranscription]");
          setError(getUserMessage(error));
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

  const waitForConnection = useCallback(
    async (timeoutMs = 500): Promise<boolean> => {
      const start = Date.now();
      return new Promise<boolean>((resolve) => {
        const tick = () => {
          const ws = wsRef.current;
          // Connection ready
          if (ws && wsReadyRef.current && ws.readyState === WebSocket.OPEN) {
            return resolve(true);
          }
          // Timeout reached
          if (Date.now() - start > timeoutMs) {
            return resolve(false);
          }
          // Check again in 10ms
          setTimeout(tick, 10);
        };
        tick();
      });
    },
    [],
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

  // Monitor network connectivity
  useEffect(() => {
    const handleOnline = () => {
      console.log("[useTranscription] Network connection restored");
      // Clear any network-related errors when coming back online
      if (error && (error.includes("connection") || error.includes("internet"))) {
        setError(null);
      }
      // Try to reconnect if we have pending data
      if (sendQueueRef.current.length > 0) {
        ensureStreamingSocket();
      }
    };

    const handleOffline = () => {
      console.log("[useTranscription] Network connection lost");
      const networkError = detectNetworkError();
      if (networkError) {
        logError(networkError, "[useTranscription] Network");
        setError(getUserMessage(networkError));
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check initial state
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [error, ensureStreamingSocket]);

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
          } catch { }
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
        const error = parseMediaError(err);
        logError(error, "[useTranscription]");
        setError(getUserMessage(error));
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
    if (startingRef.current) return; // Prevent concurrent start attempts during auth

    startingRef.current = true; // Mark as starting (cleared on success or error)
    const startToken = ++startTokenRef.current;
    const isStale = () => startTokenRef.current !== startToken;
    // Start cue moved to PTT/button handlers for immediacy

    // Clear previous auth error so re-setting it triggers the useEffect in App.tsx
    // This ensures the notification shows EVERY time the user tries to dictate
    setAuthError(null);

    // LOCAL QUOTA GATING: Check if the local cache shows quota exceeded
    // This provides instant feedback without waiting for server round-trip
    // The server will still enforce this via JWT claims, but local check is faster
    try {
      const { isQuotaExceeded } = await import('../state/quotaCache');
      if (isQuotaExceeded()) {
        console.log('[useTranscription] Local quota check: exceeded');
        const errorMsg = "You've used your free words this week. Upgrade for unlimited.";
        setAuthError("payment_required");
        setError(errorMsg);
        // Send notification directly for immediate feedback
        // The useEffect in App.tsx will also fire since authError changed from null
        try {
          window.notifications?.send?.(errorMsg);
        } catch { }
        startingRef.current = false; // Clear starting flag before early return
        return;
      }
    } catch {
      // Quota check failed - continue anyway, server will enforce
    }
    if (isStale()) return;

    startSentRef.current = false;
    clearSelectionGateTimer();
    pendingSelectionPromiseRef.current = null;
    selectionGateDeadlineRef.current = null;
    applySelectionSnapshot(null);

    if (window.selection?.inspect) {
      try {
        const rawPromise = window.selection.inspect();
        const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
          if (typeof value !== "object" && typeof value !== "function") return false;
          if (value === null) return false;
          return typeof (value as { then?: unknown }).then === "function";
        };

        if (isPromiseLike(rawPromise)) {
          const handledPromise = rawPromise
            .then((snapshot) => {
              const normalized = snapshot ?? null;
              if (window.devFlags?.devConsoleLogs && normalized) {
                console.log("[useTranscription] Selection snapshot", normalized);
              }
              applySelectionSnapshot(normalized);
              return normalized;
            })
            .catch((err): null => {
              if (window.devFlags?.devConsoleLogs) {
                console.warn("[useTranscription] Selection inspect failed", err);
              }
              applySelectionSnapshot(null);
              return null;
            })
            .finally(() => {
              if (pendingSelectionPromiseRef.current === handledPromise) {
                pendingSelectionPromiseRef.current = null;
                selectionGateDeadlineRef.current = null;
                clearSelectionGateTimer();
                trySendStartMessage();
              }
            });

          pendingSelectionPromiseRef.current = handledPromise;
          const nowTs =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          selectionGateDeadlineRef.current = nowTs + 120;
          clearSelectionGateTimer();
          selectionGateTimerRef.current = window.setTimeout(() => {
            if (pendingSelectionPromiseRef.current === handledPromise) {
              pendingSelectionPromiseRef.current = null;
              selectionGateDeadlineRef.current = null;
              selectionGateTimerRef.current = null;
              trySendStartMessage();
            }
          }, 130);
        } else {
          const snapshot =
            (rawPromise as SelectionInspectSnapshot | null | undefined) ?? null;
          if (window.devFlags?.devConsoleLogs && snapshot) {
            console.log("[useTranscription] Selection snapshot", snapshot);
          }
          applySelectionSnapshot(snapshot);
        }
      } catch (err) {
        if (window.devFlags?.devConsoleLogs) {
          console.warn("[useTranscription] Selection inspect invocation failed", err);
        }
      }
    }

    if (!streamRef.current) {
      const ok = await openStreamForSelectedDevice();
      if (!ok) {
        pendingSelectionPromiseRef.current = null;
        selectionGateDeadlineRef.current = null;
        clearSelectionGateTimer();
        startingRef.current = false; // Clear starting flag before early return
        return;
      }
    }
    if (isStale()) return;
    // Only clear error if not an auth issue (auth errors should persist)
    if (!authError) {
      setError(null);
    }
    setText("");

    // Reset streaming state BEFORE auth check
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

    // Reset OCR context for new session
    pendingOcrImageBase64Ref.current = null;

    // Fire-and-forget screenshot capture for OCR context
    // Don't await - this runs in parallel with WebSocket connection
    (async () => {
      try {
        if (!window.electron?.takeScreenshot) return;

        const screenshotStartMs =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const result = await window.electron.takeScreenshot();
        const screenshotDurationMs =
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          screenshotStartMs;

        if (!result.success || !result.imageBase64) {
          console.warn("[OCR] Screenshot capture failed:", result.error);
          return;
        }

        console.log(
          `[OCR] Screenshot captured in ${result.captureTimeMs}ms (${result.sizeKb}KB) in ${Math.round(screenshotDurationMs)}ms client-side, queuing for worker...`,
        );

        // Queue screenshot for worker; it'll be sent once WS is ready.
        pendingOcrImageBase64Ref.current = result.imageBase64;
        trySendOcrContext();
      } catch (err) {
        console.warn("[OCR] Screenshot capture error:", err);
      }
    })();

    try {
      // Check if we already have an authenticated WebSocket from pre-connect
      const alreadyConnected = wsRef.current && wsAuthenticatedRef.current && wsReadyRef.current;
      if (alreadyConnected) {
        console.log('[SF] ✅ Using pre-connected WebSocket (zero auth latency)');
      } else {
        console.log('[SF] ⏳ WebSocket not pre-connected, establishing connection now...');
      }

      // Establish WebSocket connection and wait for auth
      // NOTE: Retry logic removed - singleflight prevents parallel connections,
      // and preConnect() handles background warm-up with retryWithBackoff.
      // If connection fails here, let it surface to the user for manual retry.
      await ensureStreamingSocket();
      if (isStale()) return;

      // Auth succeeded! Now we can start recording
      startingRef.current = false; // Clear starting flag - we're now recording
      setRecording(true);
      resumeAudioWorklet();

      // Send the start message
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
      if (isStale()) return;

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
          // VAD events (speech_start, speech_end)
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
        } catch { }
      } else {
        vadEngineRef.current = null;
        vadStreamGateRef.current = null;
        vadReadyRef.current = false;
      }

      const stream = streamRef.current;
      if (!stream) {
        if (window.devFlags?.devConsoleLogs) {
          console.warn("[useTranscription] Stream missing during start(); aborting");
        }
        setRecording(false);
        setProcessing(false);
        return;
      }
      sourceNodeRef.current =
        audioContextRef.current.createMediaStreamSource(stream);
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
      // When VAD is enabled, rely on pre-roll + gate instead of bypassing
      let initialBypassSamplesRemaining = VAD_ENABLED ? 0 : TARGET_SAMPLE_RATE * 0.3; // ~300ms at 16k
      workletNodeRef.current.port.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as unknown as { type?: string; samples?: ArrayBuffer };
        if (msg?.type !== "audio" || !msg?.samples) return;
        const buf: ArrayBuffer = msg.samples as ArrayBuffer;

        // Calculate and update audio level for visualization
        const level = calculateAudioLevel(buf);
        setAudioLevel(level);

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
              for (const c of chunks) streamFrame(c.buffer as ArrayBuffer);
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
            streamFrame(chunk.buffer as ArrayBuffer);
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
      startingRef.current = false; // Clear starting flag on error
      // If this is an auth error, the error and authError state are already set
      // Don't overwrite them with a generic "audio processing failed" message
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (
        errorMessage.includes("Not signed in") ||
        errorMessage.includes("Auth") ||
        errorMessage.includes("Payment") ||
        errorMessage.includes("Quota")
      ) {
        // Auth/quota error already handled - don't overwrite the error message
        setRecording(false);
        return;
      }

      const error = createAppError(
        ErrorCode.AUDIO_PROCESSING_FAILED,
        errorMessage
      );
      logError(error, "[useTranscription]");
      setError(getUserMessage(error));
      setRecording(false);
    }
  }, [
    recording,
    processing,
    openStreamForSelectedDevice,
    streamFrame,
    ensureStreamingSocket,
    resumeAudioWorklet,
    trySendStartMessage,
    applySelectionSnapshot,
    clearSelectionGateTimer,
  ]);

  const stop = useCallback(async () => {
    // Handle case where stop() is called while start() is in-flight (auth pending)
    // This happens when user double-taps quickly during cold start
    if (startingRef.current) {
      console.log('[SF] Cancelling in-flight start attempt');
      startingRef.current = false;
      startTokenRef.current += 1; // invalidate any pending async start continuation
      // Best-effort cleanup so we don't leave a worker session started or mic active.
      startSentRef.current = false;
      pendingSelectionPromiseRef.current = null;
      selectionGateDeadlineRef.current = null;
      clearSelectionGateTimer();
      try { sourceNodeRef.current?.disconnect(); } catch { }
      try { workletNodeRef.current?.disconnect(); } catch { }
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch { }
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { }
        streamRef.current = null;
        setReady(false);
      }
      // Reset streaming state and close WS (mirrors cancel(), but scoped to in-flight start)
      sendQueueRef.current = [];
      sendQueueBytesRef.current = 0;
      seqRef.current = 0;
      try { vadStreamGateRef.current?.dispose(); } catch { }
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch { }
      vadEngineRef.current = null;
      vadReadyRef.current = false;
      if (wsRef.current) {
        try {
          if (wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "cancel" }));
          }
        } catch { }
        try { wsRef.current.close(1000, "cancel"); } catch { }
        wsRef.current = null;
        wsReadyRef.current = false;
        wsAuthenticatedRef.current = false;
        wsAuthPendingRef.current = false;
      }
      metricsRef.current = null;
      setRecording(false);
      setProcessing(false);
      return;
    }

    if (!recording) return;

    playToggleOff();
    setRecording(false);
    setAudioLevel(0); // Reset audio level visualization
    audioLevelRef.current = 0; // Reset smoothing ref

    // Pause audio worklet when stopping to prevent buffer buildup
    pauseAudioWorklet();
    // Stop health monitoring when not recording
    stopWebSocketHealthCheck();

    setProcessing(true);
    if (metricsRef.current && !metricsRef.current.stopInvokedMs) {
      metricsRef.current.stopInvokedMs =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }

    // Wait briefly for connection if it's still establishing
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING && !wsErrorRef.current) {
      if (window.devFlags?.devConsoleLogs) {
        console.info("[SF] WebSocket still connecting, waiting for readiness...");
      }
      await waitForConnection(500);
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
            try { ws.removeEventListener("message", onMessage as EventListener); } catch { }
            try { ws.removeEventListener("error", onError as EventListener); } catch { }
            try { ws.removeEventListener("close", onClose as EventListener); } catch { }
            try {
              abortControllerRef.current?.signal.removeEventListener(
                "abort",
                onAbort,
              );
            } catch { }
            try {
              if (!abortOnly && timeoutId) clearTimeout(timeoutId);
            } catch { }
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
              } catch { }
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
                  try { window.transcript?.update(next); } catch { }
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
                        } catch { }
                      }
                      // Save transcription to history
                      try {
                        await addTranscription(msg.text, sessionModeRef.current);
                      } catch { }

                      // Update local quota cache for UI (worker handles DB writes)
                      // Worker sends wordCount in the response - we use it for instant UI feedback
                      if (msg.wordCount && msg.wordCount > 0) {
                        try {
                          const { incrementQuotaLocal } = await import('../state/quotaCache');
                          incrementQuotaLocal(msg.wordCount); // UI update only
                        } catch (err) {
                          console.warn('[useTranscription] Quota UI update failed:', err);
                        }
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
                              model?: string | null;
                              startAt?: number | null;
                              headersAt?: number | null;
                              firstDeltaAt?: number | null;
                              bodyDoneAt?: number | null;
                              ttfbMs?: number | null;
                              bodyMs?: number | null;
                              totalMs?: number | null;
                              routeRules?: string[] | null;
                            } | null;
                            finalSentAt?: number | null;
                            chunkCount?: number | null;
                            chunkSttMs?: string | null;
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
                        const chunkCount = (worker?.chunkCount as number | null) ?? null;
                        const chunkSttMs = (worker?.chunkSttMs as string | null) ?? null;

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
                          // Chunk metrics (if chunked session)
                          ...(chunkCount ? { chunkCount, chunkSttMs } : {}),
                        };

                        console.log("[SF] E2E", breakdown);
                      } catch { }
                    }
                  } catch { }
                  // Close per-session to avoid stale sockets
                  try {
                    ws.close(1000, "session_complete");
                  } catch { }
                  cleanup();
                  resolve();
                }
              } else if (msg.type === "error") {
                if (!settled) {
                  settled = true;
                  // Parse structured server error
                  const serverError = msg as ServerErrorResponse;
                  const appError = parseServerError(serverError);
                  logError(appError, "[useTranscription] Server");
                  // Close after receiving error response
                  try {
                    ws.close(1011, "server error");
                  } catch { }
                  cleanup();
                  reject(
                    new Error(getUserMessage(appError)),
                  );
                }
              }
            } catch { }
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
              } catch { }
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
                  for (const chunk of tail) streamFrame(chunk.buffer as ArrayBuffer);
                }
              } catch { }

              await waitForAllFramesSent();
              if (metricsRef.current && !metricsRef.current.drainDoneMs)
                metricsRef.current.drainDoneMs =
                  typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();

              // If VAD is enabled and absolutely no speech was forwarded, do not send 'end'.
              const noSpeechForwarded = VAD_ENABLED && ((metricsRef.current?.framesForwarded ?? 0) <= 0);
              if (noSpeechForwarded) {
                try {
                  // Inform server to drop the logical session; keep socket for reuse
                  if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(JSON.stringify({ type: "cancel" })); } catch { }
                  } else if (ws.readyState === WebSocket.CONNECTING) {
                    const sendOnOpen = () => {
                      try { ws.send(JSON.stringify({ type: "cancel" })); } catch { }
                      ws.removeEventListener("open", sendOnOpen as EventListener);
                    };
                    ws.addEventListener("open", sendOnOpen as EventListener, { once: true } as AddEventListenerOptions);
                  }
                  // Remove the per-call listeners/timers now that cancel was sent
                  cleanup();
                } catch { }

                // Teardown audio nodes locally; leave WS lifecycle to existing client logic
                try { sourceNodeRef.current?.disconnect(); } catch { }
                try { workletNodeRef.current?.port.postMessage({ type: "reset" }); } catch { }
                try { workletNodeRef.current?.disconnect(); } catch { }
                if (audioContextRef.current) {
                  try { await audioContextRef.current.close(); } catch { }
                  audioContextRef.current = null;
                }
                if (streamRef.current) {
                  try { streamRef.current.getTracks().forEach((track) => track.stop()); } catch { }
                  streamRef.current = null;
                  setReady(false);
                }

                // Resolve the stop() promise without waiting for any server response
                settled = true;
                resolve();
                return;
              }

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
                    } catch { }
                    ws.removeEventListener("open", sendOnOpen as EventListener);
                  };
                  ws.addEventListener("open", sendOnOpen as EventListener, {
                    once: true,
                  } as AddEventListenerOptions);
                } else {
                  // Socket closed: request a fresh one for next session and fail fast
                  try {
                    ws.close();
                  } catch { }
                }
              } catch { }

              // Disconnect nodes after signaling end (do not block end send on audio teardown)
              try {
                sourceNodeRef.current?.disconnect();
              } catch { }
              try {
                workletNodeRef.current?.port.postMessage({ type: "reset" });
              } catch { }
              try {
                workletNodeRef.current?.disconnect();
              } catch { }
              if (audioContextRef.current) {
                try {
                  await audioContextRef.current.close();
                } catch { }
                audioContextRef.current = null;
              }
              if (streamRef.current) {
                try {
                  streamRef.current.getTracks().forEach((track) => track.stop());
                } catch { }
                streamRef.current = null;
                setReady(false);
              }
            } catch { }
          })();
        });
      } else {
        const error = createAppError(
          ErrorCode.WS_CONNECTION_FAILED,
          "WebSocket connection not available for transcription",
          {
            wsExists: !!wsRef.current,
            wsError: wsErrorRef.current,
            reconnectAttempts: reconnectAttemptRef.current
          }
        );
        logError(error, "[useTranscription] stop()");
        throw new Error(getUserMessage(error));
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
      try { vadStreamGateRef.current?.dispose(); } catch { }
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch { }
      vadEngineRef.current = null;
      vadReadyRef.current = false;
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch { }
        audioContextRef.current = null;
      }
      // Reset metrics
      metricsRef.current = null;
      // Reset client-side queue/backoff
      sendQueueRef.current = [];
      sendQueueBytesRef.current = 0;
      resetReconnectBackoff();
    }
  }, [recording, waitForConnection]);

  const cancel = useCallback(async () => {
    // Cancel discards current capture, does not send audio, and does not close WS
    // Also abort any in-flight processing if present

    // Clear in-flight start if any
    startingRef.current = false;
    startTokenRef.current += 1; // invalidate any pending async start continuation

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch { }
      abortControllerRef.current = null;
    }

    setAudioLevel(0); // Reset audio level visualization
    audioLevelRef.current = 0; // Reset smoothing ref

    // Pause audio worklet when canceling to prevent buffer buildup
    pauseAudioWorklet();
    // Stop health monitoring when canceling
    stopWebSocketHealthCheck();

    try {
      // Disconnect nodes and clean up (discard captured audio)
      try {
        sourceNodeRef.current?.disconnect();
      } catch { }
      try {
        workletNodeRef.current?.disconnect();
      } catch { }
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch { }
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch { }
        streamRef.current = null;
        setReady(false);
      }
      // Reset streaming state and proactively close the socket
      sendQueueRef.current = [];
      sendQueueBytesRef.current = 0;
      seqRef.current = 0;
      // Dispose VAD
      try { vadStreamGateRef.current?.dispose(); } catch { }
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch { }
      vadEngineRef.current = null;
      vadReadyRef.current = false;
      if (wsRef.current) {
        try {
          if (wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: "cancel" }));
        } catch { }
        try {
          wsRef.current.close(1000, "cancel");
        } catch { }
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
        } catch { }
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
        } catch { }
        wsRef.current = null;
        wsReadyRef.current = false;
      }

      // Clean up audio resources
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch { }
        audioContextRef.current = null;
      }

      // Dispose VAD
      try { vadStreamGateRef.current?.dispose(); } catch { }
      vadStreamGateRef.current = null;
      try { vadEngineRef.current?.dispose(); } catch { }
      vadEngineRef.current = null;
      vadReadyRef.current = false;

      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch { }
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
        } catch { }
        abortControllerRef.current = null;
      }
    };
  }, [stopWebSocketHealthCheck]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const preConnect = useCallback(async () => {
    // Establish WebSocket connection and authenticate in background
    // Throws error for retry logic in App.tsx
    await ensureStreamingSocket();
    console.info("[SF] Pre-connected to Worker successfully");
  }, [ensureStreamingSocket]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    authError,
    mode,
    selection,
    audioLevel,
    start,
    stop,
    cancel,
    clearAuthError,
    preConnect,
  };
}
