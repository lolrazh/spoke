/**
 * Transcription Hook
 *
 * Manages audio recording and transcription using provider-backed adapters.
 * Uses MediaRecorder for audio capture and delegates transport to providers.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { SelectionInspectSnapshot } from "../types/shared";
import type {
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
import { POST_ROLL_MS } from "../config/audio";

export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  text: string;
  error: string | null;
  mode: TranscriptionMode;
  selection: SelectionInspectSnapshot | null;
  audioLevel: number;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  preConnect: () => Promise<void>;
}

export interface UseTranscriptionOptions {
  autoEnumerateDevices?: boolean;
  autoInitStream?: boolean;
  requestLabelPermissionForEnumeration?: boolean;
  suppressNativePaste?: boolean;
}

export function useTranscription(
  options: UseTranscriptionOptions = {},
): UseTranscriptionReturn {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode] = useState<TranscriptionMode>("dictation");
  const [selection] = useState<SelectionInspectSnapshot | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const stopInFlightRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ocrWordsRef = useRef<string[]>([]);
  const ocrPromiseRef = useRef<Promise<void> | null>(null);
  const activeProviderIdRef = useRef<string | null>(null);
  const preferredProviderIdRef = useRef<PreferredTranscriptionProviderId>(
    LOCAL_STT_PROVIDER_ID,
  );

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
      console.error("[Transcription] Failed to get microphone:", err);
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
    return {
      mode,
      language: "en",
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
      console.warn("[Context] Screenshot capture failed:", err);
    }

    return undefined;
  }, []);

  // Start recording
  const start = useCallback(async () => {
    if (recording || processing || stopInFlightRef.current) return;

    const providerId = await resolveActiveProviderId();
    defaultTranscriptionSessionOrchestrator.resolveProvider(providerId);

    try {
      setText("");
      setError(null);
      setRecording(true);
      activeProviderIdRef.current = providerId;

      // Get stream if not already initialized
      let stream = streamRef.current;
      if (!stream) {
        stream = await initStream();
      }

      // Start both recording and OCR extraction in parallel
      const recorderPromise = (async () => {
        const recorder = new AudioRecorder({
          onAudioLevel: setAudioLevel,
          onError: (err) => {
            console.error("[Transcription] Recorder error:", err);
            setError(err.message);
            setRecording(false);
          },
        });
        await recorder.start(stream);
        return recorder;
      })();

      const ocrPromise = (async () => {
        try {
          const imageBase64 = await captureScreenshotBase64();
          if (imageBase64 && window.stt?.extractOcr) {
            const result = await window.stt.extractOcr(imageBase64);
            ocrWordsRef.current = result.words ?? [];
            if (result.words?.length) {
              console.log(
                `[OCR] Extracted ${result.words.length} vocabulary words`,
              );
            }
          }
        } catch (err) {
          console.warn("[OCR] Extraction failed:", err);
          // Non-critical — continue without OCR vocabulary
        }
      })();

      // Wait for recorder to be ready, but OCR continues in background
      const recorder = await recorderPromise;
      recorderRef.current = recorder;
      ocrPromiseRef.current = ocrPromise;
    } catch (err) {
      console.error("[Transcription] Start failed:", err);
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

  // Stop recording and transcribe
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
      fetchStarted: 0,
      fetchDone: 0,
    };

    try {
      setProcessing(true);
      setRecording(false);
      playToggleOff();

      // Add post-roll delay to capture end of speech
      await new Promise((resolve) => setTimeout(resolve, POST_ROLL_MS));

      // Stop recording and get audio blob
      const audioBlob = await recorder.stop();

      console.log(`[Transcription] Audio recorded: ${audioBlob.size} bytes`);

      const context = buildTranscriptionContext();

      // ===== Local Whisper path =====
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

        // Wait for OCR to finish, then enhance
        if (ocrPromiseRef.current) {
          await ocrPromiseRef.current;
          ocrPromiseRef.current = null;
        }

        let finalText = result.text;
        if (window.stt?.enhance) {
          try {
            const enhanced = await window.stt.enhance({
              text: result.text,
              vocabulary: ocrWordsRef.current,
              mode,
              selectionText: selection?.selectedText ?? undefined,
            });
            finalText = enhanced.text;
            if (!enhanced.bypassed) {
              console.log(
                `[Local] Enhanced (${enhanced.tier}): "${finalText.slice(0, 50)}..."`,
              );
            }
          } catch (err) {
            console.warn(
              "[Local] Enhancement failed, using raw transcript:",
              err,
            );
          }
        }

        setText(finalText);

        // Add to history (fire-and-forget)
        addTranscription(finalText, mode).catch(console.warn);

        // Trigger native paste if not suppressed
        if (!options.suppressNativePaste) {
          const insertText = window.clipboard?.insertText;
          try {
            await insertText?.(finalText);
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
      // Wait for OCR to finish if still pending
      if (ocrPromiseRef.current) {
        console.log("[Cloud] Waiting for OCR to complete...");
        await ocrPromiseRef.current;
        ocrPromiseRef.current = null;
      }

      // Transcribe via cloud provider
      timing.fetchStarted = Date.now();
      const result = await defaultTranscriptionSessionOrchestrator.transcribe(
        providerId,
        {
          audioBlob,
          context,
        },
      );
      timing.fetchDone = Date.now();

      console.log(
        `[Cloud] STT complete in ${timing.fetchDone - timing.fetchStarted}ms: "${result.text.slice(0, 50)}..."`,
      );

      // Enhance with LLM if triggers detected
      let finalText = result.text;
      if (window.stt?.enhance) {
        try {
          const enhanced = await window.stt.enhance({
            text: result.text,
            vocabulary: ocrWordsRef.current,
            mode,
            selectionText: selection?.selectedText ?? undefined,
          });
          finalText = enhanced.text;
          if (!enhanced.bypassed) {
            console.log(
              `[Cloud] Enhanced (${enhanced.tier}): "${finalText.slice(0, 50)}..."`,
            );
          }
        } catch (err) {
          console.warn(
            "[Cloud] Enhancement failed, using raw transcript:",
            err,
          );
        }
      }

      setText(finalText);

      // Add to history (fire-and-forget)
      addTranscription(finalText, mode).catch(console.warn);

      // Trigger native paste if not suppressed
      if (!options.suppressNativePaste) {
        const insertText = window.clipboard?.insertText;
        const pasteStart = Date.now();
        insertText?.(finalText)
          ?.then(() => {
            console.log(
              `[Cloud] TOTAL E2E: ${Date.now() - timing.stopStarted}ms (paste: ${Date.now() - pasteStart}ms)`,
            );
          })
          ?.catch(console.warn);
      } else {
        console.log(
          `[Cloud] TOTAL E2E (no paste): ${Date.now() - timing.stopStarted}ms`,
        );
      }
    } catch (err) {
      console.error("[Transcription] Stop failed:", err);
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
      ocrWordsRef.current = [];
      ocrPromiseRef.current = null;
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
    ocrWordsRef.current = [];
    ocrPromiseRef.current = null;
  }, []);

  // Pre-connect is retained for callers that still warm up transcription.
  const preConnect = useCallback(async () => {
    await resolveActiveProviderId();
    console.log("[Transcription] Pre-connect called");
  }, [resolveActiveProviderId]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    mode,
    selection,
    audioLevel,
    start,
    stop,
    cancel,
    preConnect,
  };
}
