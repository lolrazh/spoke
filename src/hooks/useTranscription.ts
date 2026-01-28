/**
 * Transcription Hook
 *
 * Manages audio recording and transcription using HTTP endpoints.
 * Uses MediaRecorder for audio capture and uploads to /prepare and /transcribe.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { SelectionInspectSnapshot } from "../types/shared";
import type { ClientSessionMode } from "../types/protocol";
import { getPrepareUrl, getTranscribeUrl } from "../config/api";
import { AudioRecorder } from "../utils/audioRecorder";
import { playToggleOff } from "../utils/audioFeedback";
import { addTranscription } from "../state/transcriptionHistory";
import { getUserIdentity } from "../state/userIdentity";
import { POST_ROLL_MS } from "../config/audio";

export type AuthErrorType =
  | "not_signed_in"
  | "payment_required"
  | "auth_failed"
  | null;

export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  authError: AuthErrorType;
  mode: ClientSessionMode;
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
  const [mode, setMode] = useState<ClientSessionMode>("dictation");
  const [selection, setSelection] = useState<SelectionInspectSnapshot | null>(
    null,
  );
  const [audioLevel, setAudioLevel] = useState(0);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prepareDataRef = useRef<{
    prepareId?: string;
    ocrWords?: string[];
  } | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);

  // Get auth token from Supabase
  const getAuthToken = async (): Promise<string | null> => {
    try {
      const { getAccessToken } = await import("../lib/supabaseClient");
      return await getAccessToken();
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

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [initStream, options.autoInitStream]);

  // Start recording
  const start = useCallback(async () => {
    if (recording) return;

    const token = await getAuthToken();
    if (!token) {
      setAuthError("not_signed_in");
      setError("Not signed in");
      return;
    }

    try {
      setText("");
      setError(null);
      setAuthError(null);
      setRecording(true);

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
          const prepareUrl = getPrepareUrl();

          // Capture screenshot for OCR
          let screenshot: string | undefined;
          try {
            if ((window as any).electron?.takeScreenshot) {
              const result = await (window as any).electron.takeScreenshot();
              if (result.success && result.imageBase64) {
                screenshot = result.imageBase64;
              }
            }
          } catch (err) {
            console.warn("[HTTP] Screenshot capture failed:", err);
          }

          const prepareRes = await fetch(prepareUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              screenshot: screenshot || undefined,
            }),
          });

          if (!prepareRes.ok) {
            const errorData = await prepareRes.json().catch(() => ({}));

            if (prepareRes.status === 401) {
              setAuthError("auth_failed");
              console.error("[HTTP] Auth failed during prepare");
              // Don't stop recording yet, let user finish
            } else if (prepareRes.status === 402) {
              setAuthError("payment_required");
              console.error("[HTTP] Quota exceeded during prepare");
              // Don't stop recording yet, let user finish
            } else {
              console.warn("[HTTP] Prepare failed:", errorData.error);
            }
            return;
          }

          const prepareData = await prepareRes.json();
          prepareDataRef.current = prepareData;

          console.log("[HTTP] Prepare complete:", prepareData);
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
    }
  }, [recording, initStream]);

  // Stop recording and upload
  const stop = useCallback(async () => {
    if (!recording || !recorderRef.current) return;

    try {
      setProcessing(true);
      setRecording(false);
      playToggleOff();

      // Add post-roll delay to capture end of speech
      await new Promise((resolve) => setTimeout(resolve, POST_ROLL_MS));

      // Stop recording and get audio blob
      const audioBlob = await recorderRef.current.stop();
      recorderRef.current = null;

      console.log(`[HTTP] Audio recorded: ${audioBlob.size} bytes`);

      // Wait for /prepare to finish if still pending
      if (preparePromiseRef.current) {
        console.log("[HTTP] Waiting for /prepare to complete...");
        await preparePromiseRef.current;
        preparePromiseRef.current = null;
      }

      // Upload to /transcribe
      const token = await getAuthToken();
      if (!token) {
        throw new Error("No auth token");
      }

      const transcribeUrl = getTranscribeUrl();
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.webm");

      // Get user identity for STT prompt
      const identity = getUserIdentity();

      formData.append(
        "metadata",
        JSON.stringify({
          mode,
          ocrWords: prepareDataRef.current?.ocrWords || [],
          selection: selection?.text || undefined,
          identity: identity?.name || undefined,
          language: "en",
        }),
      );

      const transcribeRes = await fetch(transcribeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!transcribeRes.ok) {
        const errorData = await transcribeRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Transcription failed");
      }

      const result = await transcribeRes.json();
      console.log("[HTTP] Transcription complete:", result);

      setText(result.text);

      // Add to history
      addTranscription({
        id: result.traceId || Date.now().toString(),
        text: result.text,
        timestamp: Date.now(),
        mode,
      });

      // Trigger native paste if not suppressed
      if (!options.suppressNativePaste) {
        await (window as any).clipboard?.insertText?.(result.text);
      }
    } catch (err) {
      console.error("[HTTP] Stop failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      prepareDataRef.current = null;
      preparePromiseRef.current = null;
    }
  }, [recording, mode, selection, options.suppressNativePaste]);

  // Cancel recording
  const cancel = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    setRecording(false);
    setProcessing(false);
    setText("");
    setAudioLevel(0);
    prepareDataRef.current = null;
    preparePromiseRef.current = null;
  }, []);

  // Clear auth error
  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  // Pre-connect (no-op for HTTP, kept for interface compatibility)
  const preConnect = useCallback(async () => {
    // HTTP doesn't need pre-connection
    console.log("[HTTP] Pre-connect called (no-op for HTTP)");
  }, []);

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
