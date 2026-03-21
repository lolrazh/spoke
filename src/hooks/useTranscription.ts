/**
 * Transcription Hook
 *
 * Manages audio recording and transcription using provider-backed adapters.
 * Uses MediaRecorder for audio capture and delegates transport to providers.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { SelectionInspectSnapshot } from "../types/shared";
import type {
  AuthErrorType as SessionAuthErrorType,
  PrepareTranscriptionResult,
  TranscriptionContext,
  TranscriptionMode,
} from "../core/transcription/sessionTypes";
import {
  defaultTranscriptionSessionOrchestrator,
  resolvePreferredTranscriptionProviderId,
  LOCAL_STT_PROVIDER_ID,
} from "../core/transcription/defaultSessionOrchestrator";
import type { PreferredTranscriptionProviderId } from "../core/transcription/providerPreferences";
import { AudioRecorder } from "../utils/audioRecorder";
import { decodeToPcm16 } from "../utils/audioDecoder";
import { playToggleOff } from "../utils/audioFeedback";
import { addTranscription } from "../state/transcriptionHistory";
import { getUserIdentity } from "../state/userIdentity";
import { POST_ROLL_MS } from "../config/audio";

// Token cache with 50-minute TTL (tokens typically expire in 1 hour)
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;
let cachedToken: { value: string; expiresAt: number } | null = null;

// Cached reference to the supabase module to avoid repeated dynamic imports
let supabaseModule: { getAccessToken: () => Promise<string | null> } | null =
  null;

/** Clear the auth token cache (call on sign-out or auth failure) */
export function clearAuthTokenCache(): void {
  cachedToken = null;
}

export type AuthErrorType = SessionAuthErrorType;

export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  authError: AuthErrorType;
  mode: TranscriptionMode;
  selection: SelectionInspectSnapshot | null;
  audioLevel: number;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  clearAuthError: () => void;
  preConnect: () => Promise<void>;
}

export interface UseTranscriptionOptions {
  autoEnumerateDevices?: boolean;
  autoInitStream?: boolean;
  requestLabelPermissionForEnumeration?: boolean;
  suppressNativePaste?: boolean;
  shareTranscriptionsInMetrics?: boolean;
  shareTranscriptionsEnabled?: boolean;
}

export function useTranscription(
  options: UseTranscriptionOptions = {},
): UseTranscriptionReturn {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<AuthErrorType>(null);
  const [mode] = useState<TranscriptionMode>("dictation");
  const [selection] = useState<SelectionInspectSnapshot | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const stopInFlightRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const prepareDataRef = useRef<PrepareTranscriptionResult | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);
  const activeProviderIdRef = useRef<string | null>(null);
  const preferredProviderIdRef = useRef<PreferredTranscriptionProviderId>(
    LOCAL_STT_PROVIDER_ID,
  );

  // Get auth token from Supabase (with caching)
  const getAuthToken = async (): Promise<string | null> => {
    try {
      // Return cached token if still valid
      if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.value;
      }

      // Cache the module import to avoid repeated dynamic imports
      if (!supabaseModule) {
        supabaseModule = await import("../lib/supabaseClient");
      }

      const token = await supabaseModule.getAccessToken();
      if (token) {
        cachedToken = {
          value: token,
          expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
        };
      }
      return token;
    } catch (err) {
      console.error("[HTTP] Failed to get access token:", err);
      return null;
    }
  };

  // Initialize microphone stream
  const initStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;
      setReady(true);
      return stream;
    } catch (err) {
      console.error("[HTTP] Failed to get microphone:", err);
      setError("Failed to access microphone");
      setReady(false);
      throw err;
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    if (options.autoInitStream !== false) {
      initStream().catch(console.error);
    } else {
      setReady(true);
    }

    // Load provider preference
    window.stt?.getPreferredProvider?.().then((providerId) => {
      preferredProviderIdRef.current =
        resolvePreferredTranscriptionProviderId(providerId);
    });

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [initStream, options.autoInitStream]);

  const resolveActiveProviderId = useCallback(async () => {
    const storedProviderId = await window.stt?.getPreferredProvider?.();
    const resolvedProviderId = resolvePreferredTranscriptionProviderId(
      storedProviderId ?? preferredProviderIdRef.current,
    );
    preferredProviderIdRef.current = resolvedProviderId;
    return resolvedProviderId;
  }, []);

  const buildTranscriptionContext = useCallback((): TranscriptionContext => {
    const identity = getUserIdentity();
    return {
      mode,
      language: "en",
      identityName: identity?.name || undefined,
      selectionText: selection?.selectedText || undefined,
    };
  }, [mode, selection]);

  const captureScreenshotBase64 = useCallback(async () => {
    try {
      const takeScreenshot = window.electron?.takeScreenshot;
      if (!takeScreenshot) {
        return undefined;
      }

      const result = await takeScreenshot();
      if (result.success && result.imageBase64) {
        return result.imageBase64;
      }
    } catch (err) {
      console.warn("[HTTP] Screenshot capture failed:", err);
    }

    return undefined;
  }, []);

  // Start recording
  const start = useCallback(async () => {
    if (recording || processing || stopInFlightRef.current) return;

    const providerId = await resolveActiveProviderId();
    const provider =
      defaultTranscriptionSessionOrchestrator.resolveProvider(providerId);

    try {
      setText("");
      setError(null);
      setAuthError(null);
      setRecording(true);
      activeProviderIdRef.current = providerId;

      // Get stream if not already initialized
      let stream = streamRef.current;
      if (!stream) {
        stream = await initStream();
      }

      // Start BOTH recording and /prepare at the EXACT same time (true parallelization)
      const recorderPromise = (async () => {
        const recorder = new AudioRecorder({
          onAudioLevel: setAudioLevel,
          onError: (err) => {
            console.error("[HTTP] Recorder error:", err);
            setError(err.message);
            setRecording(false);
          },
        });
        await recorder.start(stream);
        return recorder;
      })();

      const preparePromise = (async () => {
        try {
          const prepareResult =
            await defaultTranscriptionSessionOrchestrator.prepare(providerId, {
              screenshotBase64: provider.prepare
                ? await captureScreenshotBase64()
                : undefined,
              context: buildTranscriptionContext(),
            });

          prepareDataRef.current = prepareResult;

          if (prepareResult?.authError === "auth_failed") {
            clearAuthTokenCache();
            setAuthError("auth_failed");
            console.error("[HTTP] Auth failed during prepare");
            return;
          }

          if (prepareResult?.authError === "payment_required") {
            setAuthError("payment_required");
            console.error("[HTTP] Quota exceeded during prepare");
            return;
          }

          if (prepareResult) {
            console.log("[HTTP] Prepare complete:", prepareResult);
          }

          // Sync quota from /prepare response (server validation)
          if (prepareResult?.quotaInfo) {
            const { updateQuotaFromServer } = await import(
              "../state/quotaCache"
            );
            updateQuotaFromServer({
              wordsUsed: prepareResult.quotaInfo.wordsUsed ?? 0,
              resetDate: null, // Not provided in /prepare
              isPro: prepareResult.quotaInfo.subscriptionActive ?? false,
            });
            console.log(
              "[HTTP] Quota synced from /prepare:",
              prepareResult.quotaInfo,
            );
          }
        } catch (err) {
          console.error("[HTTP] Prepare failed:", err);
          // Don't stop recording, continue without OCR
        }
      })();

      // Wait for recorder to be ready, but /prepare continues in background
      const recorder = await recorderPromise;
      recorderRef.current = recorder;
      preparePromiseRef.current = preparePromise;
    } catch (err) {
      console.error("[HTTP] Start failed:", err);
      setError(err instanceof Error ? err.message : String(err));
      setRecording(false);
      activeProviderIdRef.current = null;
      // Release microphone stream on failure so the mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [
    buildTranscriptionContext,
    captureScreenshotBase64,
    initStream,
    processing,
    recording,
    resolveActiveProviderId,
  ]);

  // Stop recording and upload
  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recording || !recorder || stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    // Clear immediately so duplicate stop calls (same tick / gesture race) no-op.
    recorderRef.current = null;

    const providerId =
      activeProviderIdRef.current ?? (await resolveActiveProviderId());
    const provider =
      defaultTranscriptionSessionOrchestrator.resolveProvider(providerId);

    // Comprehensive timing for debugging latency
    const timing = {
      stopStarted: Date.now(),
      postRollDone: 0,
      recorderStopped: 0,
      prepareDone: 0,
      authTokenDone: 0,
      fetchStarted: 0,
      fetchDone: 0,
      responseParsed: 0,
      historyDone: 0,
      pasteDone: 0,
    };

    try {
      setProcessing(true);
      setRecording(false);
      playToggleOff();

      // Add post-roll delay to capture end of speech
      await new Promise((resolve) => setTimeout(resolve, POST_ROLL_MS));
      timing.postRollDone = Date.now();

      // Stop recording and get audio blob
      const audioBlob = await recorder.stop();
      timing.recorderStopped = Date.now();

      console.log(`[HTTP] Audio recorded: ${audioBlob.size} bytes`);

      const context = buildTranscriptionContext();

      // ===== Local STT path =====
      if (provider.descriptor.kind === "local") {
        console.log("[Local] Decoding audio to PCM16...");
        const pcm16 = await decodeToPcm16(audioBlob);
        console.log(`[Local] PCM16: ${pcm16.length} samples`);

        const result = await defaultTranscriptionSessionOrchestrator.transcribe(
          providerId,
          {
            pcm16,
            context,
          },
        );
        console.log(
          `[Local] Transcription complete: "${result.text.slice(0, 50)}..."`,
        );
        if (result.metrics) {
          const m = result.metrics as Record<string, unknown>;
          console.log(
            `[Local] Metrics: inference=${m.inference_ms}ms, ttft=${m.ttft_ms}ms`,
          );
        }

        setText(result.text);

        // Add to history (fire-and-forget)
        addTranscription(result.text, mode).catch(console.warn);

        // Trigger native paste if not suppressed
        if (!options.suppressNativePaste) {
          const insertText = window.clipboard?.insertText;
          // Await local paste completion so a previous helper invocation cannot
          // finish during the next dictation and re-insert stale text.
          try {
            await insertText?.(result.text);
          } catch (err) {
            console.warn(err);
          }
          console.log(
            `[Local] TOTAL E2E: ${Date.now() - timing.stopStarted}ms`,
          );
        } else {
          console.log(
            `[Local] TOTAL E2E (no paste): ${Date.now() - timing.stopStarted}ms`,
          );
        }
        return; // Skip cloud path
      }

      // ===== Cloud STT path =====
      // Wait for /prepare to finish if still pending
      if (preparePromiseRef.current) {
        console.log("[HTTP] Waiting for /prepare to complete...");
        await preparePromiseRef.current;
        preparePromiseRef.current = null;
      }
      timing.prepareDone = Date.now();

      // Upload to /transcribe
      const token = await getAuthToken();
      timing.authTokenDone = Date.now();
      if (!token) {
        throw new Error("No auth token");
      }

      // Measure upload and response timing
      timing.fetchStarted = Date.now();
      const result = await defaultTranscriptionSessionOrchestrator.transcribe(
        providerId,
        {
          authToken: token,
          audioBlob,
          context,
          prepareResult: prepareDataRef.current,
        },
      );
      timing.fetchDone = Date.now();
      timing.responseParsed = Date.now();

      // Log comprehensive timing breakdown
      const breakdown = {
        postRoll: timing.postRollDone - timing.stopStarted,
        recorderStop: timing.recorderStopped - timing.postRollDone,
        prepareWait: timing.prepareDone - timing.recorderStopped,
        authToken: timing.authTokenDone - timing.prepareDone,
        formDataBuild: timing.fetchStarted - timing.authTokenDone,
        fetch: timing.fetchDone - timing.fetchStarted,
        responseParse: timing.responseParsed - timing.fetchDone,
      };

      console.log(
        `[HTTP] ⏱️ TIMING BREAKDOWN:\n` +
          `  postRoll: ${breakdown.postRoll}ms\n` +
          `  recorderStop: ${breakdown.recorderStop}ms\n` +
          `  prepareWait: ${breakdown.prepareWait}ms\n` +
          `  authToken: ${breakdown.authToken}ms\n` +
          `  formDataBuild: ${breakdown.formDataBuild}ms\n` +
          `  fetch (upload+server): ${breakdown.fetch}ms\n` +
          `  responseParse: ${breakdown.responseParse}ms`,
      );

      setText(result.text);

      // Update local quota cache with word count from server (instant UI update)
      if (result.wordCount && result.wordCount > 0) {
        const { incrementQuotaLocal } = await import("../state/quotaCache");
        incrementQuotaLocal(result.wordCount);
        console.log(
          `[HTTP] Quota incremented locally: +${result.wordCount} words`,
        );
      }

      // Add to history (fire-and-forget to not block UI)
      const historyStart = Date.now();
      addTranscription(result.text, mode)
        .then(() => {
          console.log(`[HTTP] History saved in ${Date.now() - historyStart}ms`);
        })
        .catch(console.warn);

      // Trigger native paste if not suppressed (fire-and-forget to not block UI)
      if (!options.suppressNativePaste) {
        const insertText = window.clipboard?.insertText;
        const pasteStart = Date.now();
        insertText?.(result.text)
          ?.then(() => {
            console.log(
              `[HTTP] Paste completed in ${Date.now() - pasteStart}ms`,
            );
            console.log(
              `[HTTP] 🏁 TOTAL E2E: ${Date.now() - timing.stopStarted}ms`,
            );
          })
          ?.catch(console.warn);
      } else {
        console.log(
          `[HTTP] 🏁 TOTAL E2E (no paste): ${Date.now() - timing.stopStarted}ms`,
        );
      }
    } catch (err) {
      console.error("[HTTP] Stop failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      stopInFlightRef.current = false;
      activeProviderIdRef.current = null;
      // Release microphone stream so the OS mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setProcessing(false);
      prepareDataRef.current = null;
      preparePromiseRef.current = null;
    }
  }, [
    buildTranscriptionContext,
    options.suppressNativePaste,
    recording,
    resolveActiveProviderId,
  ]);

  // Cancel recording
  const cancel = useCallback(() => {
    stopInFlightRef.current = false;
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    // Release microphone stream so the OS mic indicator turns off
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setRecording(false);
    setProcessing(false);
    setText("");
    setAudioLevel(0);
    activeProviderIdRef.current = null;
    prepareDataRef.current = null;
    preparePromiseRef.current = null;
  }, []);

  // Clear auth error
  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  // Pre-connect (no-op for HTTP, kept for interface compatibility)
  const preConnect = useCallback(async () => {
    await resolveActiveProviderId();
    // HTTP doesn't need pre-connection
    console.log("[HTTP] Pre-connect called (no-op for HTTP)");
  }, [resolveActiveProviderId]);

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
