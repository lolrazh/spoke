/**
 * Transcription Hook
 *
 * Manages audio recording and transcription using provider-backed adapters.
 * Captures PCM16 audio and delegates transcription to providers.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type {
  PrepareTranscriptionResult,
  TranscriptionContext,
  TranscriptionMode,
  TranscriptionProviderKind,
  TranscriptionResult,
} from "../core/transcription/sessionTypes";
import type { CapturedAudio } from "../core/transcription/capturedAudio";
import {
  defaultTranscriptionSessionOrchestrator,
  resolvePreferredTranscriptionProviderId,
  LOCAL_STT_PROVIDER_ID,
} from "../core/transcription/defaultSessionOrchestrator";
import { isTranscriptionSessionError } from "../core/transcription/sessionErrors";
import type { PreferredTranscriptionProviderId } from "../core/transcription/providerPreferences";
import { buildSTTPrompt } from "../../shared/sttPrompt";
import { PcmCaptureSession } from "../utils/pcmCaptureSession";
import type { AudioCaptureSession } from "../utils/audioCaptureSession";
import { NativePcmCaptureSession } from "../utils/nativePcmCaptureSession";
import type { VadAudioResult } from "../utils/vadTrimmer";
import type {
  StreamingVadSessionHandle,
  StreamingVadSessionOptions,
} from "../utils/streamingVad";
import { playToggleOff } from "../utils/audioFeedback";
import { invokedBloodyMary } from "../utils/easterEggs";
import { addTranscription } from "../state/transcriptionHistory";
import { setAudioLevel } from "../state/audioLevel";
import { setLiveTranscript } from "../state/liveTranscript";
import {
  POST_ROLL_MS,
  LOCAL_DICTATION_MAX_DURATION_MS,
  LOCAL_STT_CHUNK_NATURAL_START_MS,
  LOCAL_STT_CHUNK_FORCED_MS,
  LOCAL_STT_CHUNK_MIN_NATURAL_MS,
  LOCAL_STT_CHUNK_OVERLAP_MS,
  LOCAL_STT_CHUNK_NATURAL_BOUNDARY_DELAY_MS,
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";
import type {
  LocalChunkedDictation,
  LocalChunkedDictationOptions,
} from "../core/transcription/localChunkedDictation";
import {
  LocalStreamingDictation,
} from "../core/transcription/localStreamingDictation";
import {
  ENABLE_SCREEN_CONTEXT,
  ENABLE_TRANSCRIPT_ENHANCEMENT,
} from "../config/featureFlags";
import { createLogger } from "../utils/logger";

const PASTE_TIMEOUT_MS = 2_000;

// The hook currently only supports dictation; edit mode plumbing was removed.
const DICTATION_MODE: TranscriptionMode = "dictation";

const log = createLogger("Transcription");
const vadLog = createLogger("VAD");
const ocrLog = createLogger("OCR");
const latencyLog = createLogger("Latency");

async function loadStreamingVadSession(
  options: StreamingVadSessionOptions,
): Promise<StreamingVadSessionHandle> {
  const { createStreamingVadSession } = await import("../utils/streamingVad");
  return createStreamingVadSession(options);
}

async function createLocalChunkedDictation(
  options: LocalChunkedDictationOptions,
): Promise<LocalChunkedDictation> {
  const { LocalChunkedDictation } = await import(
    "../core/transcription/localChunkedDictation"
  );
  return new LocalChunkedDictation(options);
}

export interface UseTranscriptionReturn {
  recording: boolean;
  processing: boolean;
  ready: boolean;
  /** Final text that is eligible for history and native insertion. */
  text: string;
  error: string | null;
  errorId: number;
  mode: TranscriptionMode;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export interface UseTranscriptionOptions {
  autoInitStream?: boolean;
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
  const [errorId, setErrorId] = useState(0);

  const recorderRef = useRef<AudioCaptureSession | null>(null);
  const recorderStartPromiseRef = useRef<Promise<AudioCaptureSession> | null>(
    null,
  );
  const streamingVadRef = useRef<StreamingVadSessionHandle | null>(null);
  const localChunkedDictationRef = useRef<LocalChunkedDictation | null>(null);
  const localStreamingDictationRef = useRef<LocalStreamingDictation | null>(
    null,
  );
  const requestStopRef = useRef<() => void>(() => undefined);
  const requestCancelRef = useRef<() => void>(() => undefined);
  const stopInFlightRef = useRef(false);
  // A start attempt keeps this generation until it either commits recording
  // state or exits. Cancel invalidates the generation before touching any
  // pending resource so delayed startup work cannot revive the session.
  const startGenerationRef = useRef(0);
  const pendingStartGenerationRef = useRef<number | null>(null);
  // Incremented by cancel(); an in-flight stop() pipeline compares against the
  // value it captured at entry and bails out once they differ.
  const stopGenerationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCaptureAvailableRef = useRef(false);
  const ocrWordsRef = useRef<string[]>([]);
  const ocrPromiseRef = useRef<Promise<void> | null>(null);
  const activeProviderIdRef = useRef<string | null>(null);
  const prepareResultRef = useRef<PrepareTranscriptionResult | null>(null);
  const preferredProviderIdRef = useRef<PreferredTranscriptionProviderId>(
    LOCAL_STT_PROVIDER_ID,
  );

  const reportTranscriptionError = useCallback((message: string) => {
    setError(message);
    setErrorId((value) => value + 1);
  }, []);

  // Initialize the native capture capability when available. The browser
  // stream remains a development/non-macOS fallback only.
  const initStream = useCallback(async () => {
    try {
      if (window.audioCapture) {
        const nativeAvailable = await window.audioCapture.isAvailable();
        nativeCaptureAvailableRef.current = nativeAvailable;
        if (nativeAvailable) {
          setReady(true);
          return null;
        }
      }

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
      log.error("Failed to get microphone:", err);
      reportTranscriptionError("Failed to access microphone");
      setReady(false);
      throw err;
    }
  }, [reportTranscriptionError]);

  // Initialize on mount
  useEffect(() => {
    setLiveTranscript("");
    window.electron?.bootMark?.("transcription-hook:init");
    if (options.autoInitStream !== false) {
      initStream().catch(console.error);
    } else {
      setReady(true);
    }

    // Load provider preference
    window.electron?.bootMark?.("transcription-hook:get-provider:start");
    window.stt?.getPreferredProvider?.().then((providerId) => {
      preferredProviderIdRef.current =
        resolvePreferredTranscriptionProviderId(providerId);
      window.electron?.bootMark?.("transcription-hook:get-provider:done");
    });

    // No boot-time VAD prewarm: each dictation owns a short-lived worker, so
    // the ONNX/WASM heap never becomes permanent renderer state.
    return () => {
      startGenerationRef.current += 1;
      pendingStartGenerationRef.current = null;
      const stream = streamRef.current;
      streamRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());

      const pendingRecorder = recorderStartPromiseRef.current;
      recorderStartPromiseRef.current = null;
      void pendingRecorder
        ?.then((pending) => pending.cancel())
        .catch(() => undefined);
      recorderRef.current?.cancel();
      recorderRef.current = null;

      localChunkedDictationRef.current?.discardPendingAudio();
      localChunkedDictationRef.current = null;
      const localStreamingDictation = localStreamingDictationRef.current;
      localStreamingDictationRef.current = null;
      void localStreamingDictation?.cancel().catch(() => undefined);
      streamingVadRef.current?.dispose();
      streamingVadRef.current = null;
      activeProviderIdRef.current = null;
      ocrWordsRef.current = [];
      ocrPromiseRef.current = null;
      setLiveTranscript("");
      prepareResultRef.current = null;
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
      mode: DICTATION_MODE,
      language: "en",
      // Opportunistic: OCR words are gathered in the background starting at
      // start(), so by the time stop() rebuilds the context they're often
      // already populated (for local transcription we never block on OCR to
      // avoid adding latency; whatever's already there just rides along).
      // With no OCR words yet, buildSTTPrompt still returns its default
      // vocabulary hint (the product name), which is a free win on its own.
      sttPrompt: buildSTTPrompt({ extraVocab: ocrWordsRef.current }),
    };
  }, []);

  const captureScreenshotBase64 = useCallback(async () => {
    if (!ENABLE_SCREEN_CONTEXT) {
      return undefined;
    }

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
      log.warn("Screenshot capture failed:", err);
    }

    return undefined;
  }, []);

  // Start recording
  const start = useCallback(async () => {
    if (
      recording ||
      processing ||
      stopInFlightRef.current ||
      pendingStartGenerationRef.current !== null
    ) {
      return;
    }

    const startGeneration = startGenerationRef.current + 1;
    startGenerationRef.current = startGeneration;
    pendingStartGenerationRef.current = startGeneration;
    const isCurrentStart = () =>
      startGenerationRef.current === startGeneration;

    let localChunkedDictation: LocalChunkedDictation | null = null;
    let localStreamingDictation: LocalStreamingDictation | null = null;

    // A live hypothesis belongs to exactly one capture. Clear the previous
    // session before any async preparation so a failed start cannot leave old
    // words visible in the pill.
    setLiveTranscript("");
    setText("");
    setError(null);

    try {
      const providerId = await resolveActiveProviderId();
      if (!isCurrentStart()) return;
      const provider =
        defaultTranscriptionSessionOrchestrator.resolveProvider(providerId);

      const prepareResult = await defaultTranscriptionSessionOrchestrator.prepare(
        providerId,
        { context: buildTranscriptionContext() },
      );
      if (!isCurrentStart()) return;
      prepareResultRef.current = prepareResult;

      if (
        provider.descriptor.kind === "local" &&
        prepareResult?.localModel?.streaming
      ) {
        localStreamingDictation = new LocalStreamingDictation({
          modelId: prepareResult.localModel.modelId,
          sampleRateHz: TARGET_SAMPLE_RATE_HZ,
          batchMs: prepareResult.localModel.streamingChunkMs ?? 320,
          maxDurationMs: LOCAL_DICTATION_MAX_DURATION_MS,
          onPartial: setLiveTranscript,
          onLimitReached: () => {
            window.notifications?.send(
              "Sorry — Spoke has a five-minute recording limit. Finishing your transcription now…",
            );
            requestStopRef.current();
          },
        });
        // Publish the adapter before startup. It buffers bounded PCM batches
        // until the main process finishes loading the pinned model.
        localStreamingDictationRef.current = localStreamingDictation;
        localStreamingDictation.start();
      }
      if (provider.descriptor.kind === "local" && !localStreamingDictation) {
        localChunkedDictation = await createLocalChunkedDictation({
          sampleRateHz: TARGET_SAMPLE_RATE_HZ,
          naturalChunkingStartMs: LOCAL_STT_CHUNK_NATURAL_START_MS,
          minNaturalChunkMs: LOCAL_STT_CHUNK_MIN_NATURAL_MS,
          forcedChunkMs: LOCAL_STT_CHUNK_FORCED_MS,
          overlapMs: LOCAL_STT_CHUNK_OVERLAP_MS,
          naturalBoundaryDelayMs:
            LOCAL_STT_CHUNK_NATURAL_BOUNDARY_DELAY_MS,
          maxDurationMs: LOCAL_DICTATION_MAX_DURATION_MS,
          transcribe: (audio) => {
            // Until this first chunk, PcmCaptureSession keeps the legacy
            // short-recording fallback intact. Once a bounded request is
            // safely sealed, release its duplicate capture copy.
            recorderRef.current?.discardBufferedPcm();
            return defaultTranscriptionSessionOrchestrator.transcribe(
              providerId,
              {
                audio,
                context: buildTranscriptionContext(),
                prepareResult,
              },
            );
          },
          onLimitReached: () => {
            window.notifications?.send(
              "Sorry — Spoke has a five-minute recording limit. Finishing your transcription now…",
            );
            requestStopRef.current();
          },
        });
        localChunkedDictationRef.current = localChunkedDictation;
      }

      // A live streaming model owns endpoint padding during finalization, so
      // a second VAD worker would only duplicate PCM conversion and inference.
      // Keep VAD for batch/chunked paths, where it still trims audio and
      // drives natural chunk boundaries.
      const streamingVadSession = localStreamingDictation
        ? null
        : await loadStreamingVadSession({
            onSpeechStart: () => localChunkedDictation?.cancelNaturalBoundary(),
            onSpeechEnd: () => localChunkedDictation?.requestNaturalBoundary(),
          });
      streamingVadRef.current = streamingVadSession;

      const recorderPromise = (async () => {
        let stream = streamRef.current;
        if (!nativeCaptureAvailableRef.current && !stream) {
          stream = await initStream();
        }

        const recorder: AudioCaptureSession = nativeCaptureAvailableRef.current
          ? new NativePcmCaptureSession({
              targetSampleRateHz: TARGET_SAMPLE_RATE_HZ,
              onAudioLevel: setAudioLevel,
              onError: (err) => {
                log.error("Native PCM capture error:", err);
                reportTranscriptionError(err.message);
                requestCancelRef.current();
              },
              onPcmFrame: (frame) => {
                streamingVadSession?.pushFrame(frame);
                localChunkedDictation?.pushFrame(frame);
                localStreamingDictation?.pushFrame(frame);
              },
              retainPcm: !localStreamingDictation,
            })
          : new PcmCaptureSession({
              onAudioLevel: setAudioLevel,
              onError: (err) => {
                log.error("PCM capture error:", err);
                reportTranscriptionError(err.message);
                requestCancelRef.current();
              },
              onPcmFrame: (frame) => {
                streamingVadSession?.pushFrame(frame);
                localChunkedDictation?.pushFrame(frame);
                localStreamingDictation?.pushFrame(frame);
              },
              retainPcm: !localStreamingDictation,
            });
        await recorder.start(stream ?? undefined);
        return recorder;
      })();
      recorderStartPromiseRef.current = recorderPromise;

      if (!isCurrentStart()) return;
      setRecording(true);
      activeProviderIdRef.current = providerId;

      // Start OCR extraction in parallel. It is non-critical and can finish
      // after capture has started.
      const ocrPromise = (async () => {
        try {
          const imageBase64 = await captureScreenshotBase64();
          if (imageBase64 && window.stt?.extractOcr) {
            const result = await window.stt.extractOcr(imageBase64);
            ocrWordsRef.current = result.words ?? [];
            if (result.words?.length) {
              ocrLog.info(`Extracted ${result.words.length} vocabulary words`);
            }
          }
        } catch (err) {
          ocrLog.warn("Extraction failed:", err);
          // Non-critical — continue without OCR vocabulary
        }
      })();

      // Wait for recorder to be ready, but OCR continues in background
      const recorder = await recorderPromise;
      if (!isCurrentStart()) {
        recorder.cancel();
        return;
      }
      if (stopInFlightRef.current) {
        return;
      }
      recorderRef.current = recorder;
      recorderStartPromiseRef.current = null;
      ocrPromiseRef.current = ocrPromise;
    } catch (err) {
      if (!isCurrentStart()) return;
      log.error("Start failed:", err);
      reportTranscriptionError(toUserFacingTranscriptionError(err));
      setRecording(false);
      activeProviderIdRef.current = null;
      prepareResultRef.current = null;
      recorderStartPromiseRef.current = null;
      streamingVadRef.current?.dispose();
      streamingVadRef.current = null;
      localChunkedDictationRef.current?.discardPendingAudio();
      localChunkedDictationRef.current = null;
      try {
        await localStreamingDictationRef.current?.cancel();
      } catch (cancelError) {
        log.warn("Failed to release local streaming session:", cancelError);
      }
      localStreamingDictationRef.current = null;
      // Release microphone stream on failure so the mic indicator turns off
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    } finally {
      if (pendingStartGenerationRef.current === startGeneration) {
        pendingStartGenerationRef.current = null;
      }
    }
  }, [
    buildTranscriptionContext,
    captureScreenshotBase64,
    initStream,
    processing,
    reportTranscriptionError,
    recording,
    resolveActiveProviderId,
  ]);

  const awaitPendingOcr = useCallback(async () => {
    if (!ocrPromiseRef.current) return;
    await ocrPromiseRef.current;
    ocrPromiseRef.current = null;
  }, []);

  // Shared tail of the stop() pipeline for local and cloud providers:
  // await OCR, enhance, publish text, record history, paste, log latency.
  const finishTranscription = useCallback(
    async ({
      result,
      timing,
      providerKind,
      capturedAudioMs,
      vadResult,
      isCancelled,
      reconcileLiveTranscript,
    }: {
      result: TranscriptionResult;
      timing: TranscriptionLatencyTiming;
      providerKind: TranscriptionProviderKind;
      capturedAudioMs: number;
      vadResult: VadAudioResult;
      isCancelled: () => boolean;
      reconcileLiveTranscript: boolean;
    }) => {
      // Wait for OCR to finish, then enhance (no-op when the cloud path
      // already awaited it before transcribing)
      await awaitPendingOcr();
      if (isCancelled()) return;

      let finalText = result.text;
      if (ENABLE_TRANSCRIPT_ENHANCEMENT && window.stt?.enhance) {
        try {
          const enhanced = await window.stt.enhance({
            text: result.text,
            vocabulary: ocrWordsRef.current,
            mode: DICTATION_MODE,
          });
          finalText = enhanced.text;
          if (!enhanced.bypassed) {
            log.info(`Enhanced (${enhanced.tier}): ${finalText.length} chars`);
          }
        } catch (err) {
          log.warn("Enhancement failed, using raw transcript:", err);
        }
        if (isCancelled()) return;
      }

      // Only a provider that emitted live hypotheses can reconcile one with
      // the authoritative result. Batch models publish the final result to
      // history/paste without imitating a late token stream in the pill.
      if (reconcileLiveTranscript) {
        setLiveTranscript(finalText);
      } else {
        setLiveTranscript("");
      }
      setText(finalText);

      if (invokedBloodyMary(finalText)) {
        window.notifications?.send?.("Boo");
      }

      // Add to history (fire-and-forget)
      addTranscription(finalText, DICTATION_MODE).catch((err) =>
        log.warn("Failed to record transcription history:", err),
      );

      // Trigger native paste if not suppressed
      if (!options.suppressNativePaste) {
        const insertText = window.clipboard?.insertText;
        timing.pasteStartedAt = performance.now();
        try {
          log.info("Starting native text insertion");
          await withTimeout(
            Promise.resolve(insertText?.(finalText)),
            PASTE_TIMEOUT_MS,
            "Native text insertion",
          );
        } catch (err) {
          log.warn(err);
        } finally {
          timing.pasteDoneAt = performance.now();
        }
      }
      logTranscriptionLatency({
        providerKind,
        status: "done",
        timing,
        capturedAudioMs,
        vadResult,
        metrics: result.metrics,
      });
    },
    [awaitPendingOcr, options.suppressNativePaste],
  );

  // Stop recording and transcribe
  const stop = useCallback(async () => {
    let recorder = recorderRef.current;
    const recorderStartPromise = recorderStartPromiseRef.current;
    if (
      !recording ||
      (!recorder && !recorderStartPromise) ||
      stopInFlightRef.current
    )
      return;
    stopInFlightRef.current = true;
    // cancel() bumps the generation; once it no longer matches, this pipeline
    // must not touch state, history, or the clipboard.
    const generation = stopGenerationRef.current;
    const isCancelled = () => stopGenerationRef.current !== generation;

    const providerId =
      activeProviderIdRef.current ?? (await resolveActiveProviderId());
    // cancel() already reset all state if it fired during the await above
    if (isCancelled()) return;
    const provider =
      defaultTranscriptionSessionOrchestrator.resolveProvider(providerId);
    const prepareResult = prepareResultRef.current;

    const timing = {
      stopStartedAt: performance.now(),
      postRollStartedAt: 0,
      postRollDoneAt: 0,
      pcmStopStartedAt: 0,
      pcmReadyAt: 0,
      vadStartedAt: 0,
      vadDoneAt: 0,
      sttStartedAt: 0,
      sttDoneAt: 0,
      pasteStartedAt: 0,
      pasteDoneAt: 0,
    };

    const streamingVadSession = streamingVadRef.current;
    const localStreamingDictation = localStreamingDictationRef.current;
    // Keep the shared reference until stop() finishes so cancel() can dispose
    // a session while its async finish() is still finalizing.

    try {
      setProcessing(true);
      setRecording(false);
      // Recording ended — drop the live level so the visualizer settles to idle.
      setAudioLevel(0);
      playToggleOff();

      // Batch paths need a short tail for VAD trimming. Live Nemotron adds
      // its own bounded final silence inside the sidecar, so do not start a
      // duplicate VAD worker or add another post-roll delay.
      timing.postRollStartedAt = performance.now();
      if (!localStreamingDictation) {
        if (streamingVadSession && streamingVadSession.isUsable()) {
          try {
            await streamingVadSession.waitForQuiet(POST_ROLL_MS);
          } catch (vadError) {
            // VAD is an optional latency optimization. Preserve the full tail
            // and continue if its worker fails while the key-up settles.
            vadLog.warn(
              "Streaming VAD post-roll failed; using fixed post-roll:",
              vadError,
            );
            const elapsedMs = performance.now() - timing.postRollStartedAt;
            const remainingMs = Math.max(0, POST_ROLL_MS - elapsedMs);
            await new Promise((resolve) => setTimeout(resolve, remainingMs));
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, POST_ROLL_MS));
        }
      }
      timing.postRollDoneAt = performance.now();
      if (isCancelled()) return;

      const context = buildTranscriptionContext();
      if (!recorder && recorderStartPromise) {
        recorder = await recorderStartPromise;
        if (isCancelled()) return;
      }
      if (!recorder) {
        throw new Error("Recording stopped before audio capture was ready.");
      }
      // Clear the pending start promise now, but keep recorderRef populated
      // until recorder.stop() flushes its final worklet frame. A chunk can be
      // sealed by that final frame, and the chunk callback may still need to
      // release the recorder's retained PCM copy.
      recorderStartPromiseRef.current = null;
      timing.pcmStopStartedAt = performance.now();

      const localChunkedDictation = localChunkedDictationRef.current;
      let capturedAudio: CapturedAudio | null = await recorder.stop();
      recorderRef.current = null;
      timing.pcmReadyAt = performance.now();
      if (isCancelled()) return;

      if (provider.descriptor.kind === "local" && localStreamingDictation) {
        capturedAudio = null;
        timing.vadStartedAt = performance.now();
        timing.vadDoneAt = timing.vadStartedAt;
        timing.sttStartedAt = timing.stopStartedAt;
        const result = await localStreamingDictation.finish();
        localStreamingDictationRef.current = null;
        timing.sttDoneAt = performance.now();
        if (isCancelled()) return;

        const capturedAudioMs = Math.round(localStreamingDictation.durationMs);
        const vadResult: VadAudioResult = {
          // The live model already consumed the PCM. Keep only telemetry here.
          audio: {
            format: "pcm16",
            sampleRateHz: TARGET_SAMPLE_RATE_HZ,
            channelCount: 1,
            pcm16: new Int16Array(),
            durationMs: 0,
          },
          speechDetected: result.text.length > 0,
          segments: [],
          trimRange: { startSample: 0, endSample: 0 },
          leadingTrimmedMs: 0,
          trailingTrimmedMs: 0,
          vadMs: 0,
        };
        if (!result.text) {
          log.info("Live local model returned no speech; skipping publish");
          logTranscriptionLatency({
            providerKind: provider.descriptor.kind,
            status: "no_speech",
            timing,
            capturedAudioMs,
            vadResult,
            metrics: result.metrics,
          });
          setLiveTranscript("");
          setText("");
          return;
        }
        await finishTranscription({
          result,
          timing,
          providerKind: provider.descriptor.kind,
          capturedAudioMs,
          vadResult,
          isCancelled,
          reconcileLiveTranscript: true,
        });
        return;
      }

      if (
        provider.descriptor.kind === "local" &&
        localChunkedDictation?.hasDispatchedChunks
      ) {
        // The completed chunk promises may already be running while the user
        // was still dictating. The CapturedAudio returned above is only a
        // transient tail (or an empty buffer after the chunker released the
        // recorder's retained PCM), so it is not used on this path.
        capturedAudio = null;
        localChunkedDictationRef.current = null;

        timing.vadStartedAt = performance.now();
        timing.vadDoneAt = timing.vadStartedAt;
        timing.sttStartedAt = timing.stopStartedAt;
        const chunkResults = await localChunkedDictation.finish();
        timing.sttDoneAt = performance.now();
        if (isCancelled()) return;

        const { mergeLocalChunkTexts } = await import(
          "../core/transcription/localChunkedDictation"
        );
        const finalText = mergeLocalChunkTexts(chunkResults);
        const capturedAudioMs = Math.round(localChunkedDictation.durationMs);
        const vadResult: VadAudioResult = {
          // The chunker never creates a whole-recording PCM buffer. This is
          // telemetry-only; the actual audio has already been sent and freed.
          audio: {
            format: "pcm16",
            sampleRateHz: TARGET_SAMPLE_RATE_HZ,
            channelCount: 1,
            pcm16: new Int16Array(),
            durationMs: 0,
          },
          speechDetected: finalText.length > 0,
          segments: [],
          trimRange: { startSample: 0, endSample: 0 },
          leadingTrimmedMs: 0,
          trailingTrimmedMs: 0,
          vadMs: 0,
        };

        if (!finalText) {
          log.info(
            "No speech detected across local dictation chunks; skipping publish",
          );
          logTranscriptionLatency({
            providerKind: provider.descriptor.kind,
            status: "no_speech",
            timing,
            capturedAudioMs,
            vadResult,
          });
          setLiveTranscript("");
          setText("");
          return;
        }

        const result: TranscriptionResult = {
          text: finalText,
          metrics: chunkResults.at(-1)?.metrics,
        };
        await finishTranscription({
          result,
          timing,
          providerKind: provider.descriptor.kind,
          capturedAudioMs,
          vadResult,
          isCancelled,
          reconcileLiveTranscript: false,
        });
        return;
      }

      // No bounded request was dispatched. Keep this recording on the
      // single-shot path and prevent a delayed natural-boundary callback from
      // dispatching the same audio after we begin VAD trimming.
      localChunkedDictation?.discardPendingAudio();
      localChunkedDictationRef.current = null;
      if (!capturedAudio) {
        throw new Error("PCM capture did not produce audio.");
      }
      const capturedAudioMs = Math.round(capturedAudio.durationMs);
      log.info(
        `PCM captured: ${capturedAudio.pcm16.length} samples, ${capturedAudioMs}ms`,
      );

      timing.vadStartedAt = performance.now();
      vadLog.info(`Starting trim for ${capturedAudioMs}ms audio`);
      let vadResult: VadAudioResult | null = null;
      if (streamingVadSession && streamingVadSession.isUsable()) {
        try {
          vadResult = await streamingVadSession.finish(capturedAudio);
        } catch (vadError) {
          // Keep the capture intact even if a session implementation rejects
          // instead of returning null after its worker fails.
          vadLog.warn(
            "Streaming VAD finish failed; falling back to post-hoc VAD:",
            vadError,
          );
        }
      }
      if (!vadResult) {
        if (isCancelled()) return;
        // Streaming VAD never became usable (model init failed, or it
        // failed mid-recording) — fall back to the post-hoc full-clip pass.
        vadLog.warn("Streaming VAD unavailable; falling back to post-hoc VAD");
        const fallbackStartedAt = performance.now();
        try {
          const { trimCapturedAudioWithVad } = await import(
            "../utils/vadTrimmer"
          );
          vadResult = await trimCapturedAudioWithVad(capturedAudio);
        } catch (vadError) {
          // Never discard a valid recording because the optional speech
          // detector failed. STT can consume the untrimmed PCM directly.
          vadLog.warn(
            "Post-hoc VAD failed; transcribing the full recording:",
            vadError,
          );
          vadResult = createUntrimmedVadResult(
            capturedAudio,
            Math.round(performance.now() - fallbackStartedAt),
          );
        }
      }
      timing.vadDoneAt = performance.now();
      if (isCancelled()) return;
      vadLog.info(
        `speech=${vadResult.speechDetected} segments=${vadResult.segments.length} leading=${Math.round(vadResult.leadingTrimmedMs)}ms trailing=${Math.round(vadResult.trailingTrimmedMs)}ms vad=${vadResult.vadMs}ms`,
      );

      // The trimmed clip (vadResult.audio) is all that feeds STT from here on;
      // drop the reference to the full untrimmed capture so its PCM can be
      // reclaimed while transcription/enhancement/paste run.
      capturedAudio = null;

      if (!vadResult.speechDetected) {
        log.info("No speech detected; skipping STT");
        logTranscriptionLatency({
          providerKind: provider.descriptor.kind,
          status: "no_speech",
          timing,
          capturedAudioMs,
          vadResult,
        });
        setLiveTranscript("");
        setText("");
        return;
      }

      const audio = vadResult.audio;
      const providerKind = provider.descriptor.kind;

      // Cloud STT waits for OCR before transcribing so vocabulary reaches the
      // provider; local Whisper transcribes immediately and folds OCR
      // vocabulary in during enhancement below.
      if (providerKind !== "local") {
        if (ocrPromiseRef.current) {
          log.info("Waiting for OCR to complete...");
        }
        await awaitPendingOcr();
        if (isCancelled()) return;
      }

      timing.sttStartedAt = performance.now();
      log.info(`Starting ${providerKind} transcription`);
      const result = await defaultTranscriptionSessionOrchestrator.transcribe(
        providerId,
        {
          audio,
          context,
          prepareResult,
        },
      );
      timing.sttDoneAt = performance.now();
      if (isCancelled()) return;
      log.info(
        `STT complete in ${elapsedMs(timing.sttStartedAt, timing.sttDoneAt)}ms (${result.text.length} chars)`,
      );
      if (providerKind === "local" && result.metrics) {
        const m = result.metrics as Record<string, unknown>;
        log.info(`Metrics: inference=${m.inference_ms}ms, ttft=${m.ttft_ms}ms`);
      }

      await finishTranscription({
        result,
        timing,
        providerKind,
        capturedAudioMs,
        vadResult,
        isCancelled,
        reconcileLiveTranscript: false,
      });
    } catch (err) {
      if (isCancelled()) return;
      log.error("Stop failed:", err);
      setLiveTranscript("");
      reportTranscriptionError(toUserFacingTranscriptionError(err));
    } finally {
      // stop() owns streamingVadSession once it's captured it above (the
      // shared ref was already nulled), regardless of how the pipeline
      // above exited — mirrors how `recorder.stop()` always runs. dispose()
      // is a no-op if finish() already completed it.
      streamingVadSession?.dispose();
      if (streamingVadRef.current === streamingVadSession) {
        streamingVadRef.current = null;
      }
      // If cancel() interrupted this pipeline it already performed the
      // cleanup below and a new session may have started since; leave it be.
      if (!isCancelled()) {
        if (
          localStreamingDictation &&
          localStreamingDictationRef.current === localStreamingDictation
        ) {
          localStreamingDictationRef.current = null;
          try {
            await localStreamingDictation.cancel();
          } catch (cancelError) {
            log.warn("Failed to release local streaming session:", cancelError);
          }
        }
        stopInFlightRef.current = false;
        activeProviderIdRef.current = null;
        prepareResultRef.current = null;
        recorderStartPromiseRef.current = null;
        // Release microphone stream so the OS mic indicator turns off
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        setProcessing(false);
        ocrWordsRef.current = [];
        ocrPromiseRef.current = null;
        localChunkedDictationRef.current = null;
        localStreamingDictationRef.current = null;
      }
    }
  }, [
    awaitPendingOcr,
    buildTranscriptionContext,
    finishTranscription,
    recording,
    reportTranscriptionError,
    resolveActiveProviderId,
  ]);

  // A chunker reaches the five-minute guard from the audio worklet callback.
  // Keep the stop action in a ref so that hot-path callback never depends on
  // React state or waits for a render before it can finalize the dictation.
  useEffect(() => {
    requestStopRef.current = () => {
      void stop();
    };
  }, [stop]);

  // Cancel recording
  const cancel = useCallback(() => {
    // Invalidate pending startup first. Any awaited continuation from the old
    // generation must observe this before it can publish recording state.
    startGenerationRef.current += 1;
    pendingStartGenerationRef.current = null;
    // Invalidate any in-flight stop() pipeline so it bails after its next
    // await instead of publishing text, adding history, or pasting.
    stopGenerationRef.current += 1;
    stopInFlightRef.current = false;
    const pendingRecorder = recorderStartPromiseRef.current;
    recorderStartPromiseRef.current = null;
    if (pendingRecorder) {
      pendingRecorder
        .then((recorder) => recorder.cancel())
        .catch((): undefined => undefined);
    }
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    localChunkedDictationRef.current?.discardPendingAudio();
    localChunkedDictationRef.current = null;
    const localStreamingDictation = localStreamingDictationRef.current;
    localStreamingDictationRef.current = null;
    void localStreamingDictation?.cancel().catch((cancelError) => {
      log.warn("Failed to release local streaming session:", cancelError);
    });
    if (
      activeProviderIdRef.current === LOCAL_STT_PROVIDER_ID &&
      !localStreamingDictation
    ) {
      void window.stt?.cancelLocalTranscription?.();
    }
    // Keep this reference reachable while stop() is finalizing VAD so cancel
    // can terminate the worker instead of letting finish() return it warm.
    if (streamingVadRef.current) {
      streamingVadRef.current.dispose();
      streamingVadRef.current = null;
    }
    // Release microphone stream so the OS mic indicator turns off
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setRecording(false);
    setProcessing(false);
    setLiveTranscript("");
    setText("");
    setAudioLevel(0);
    activeProviderIdRef.current = null;
    prepareResultRef.current = null;
    ocrWordsRef.current = [];
    ocrPromiseRef.current = null;
  }, []);

  useEffect(() => {
    requestCancelRef.current = cancel;
    return () => {
      if (requestCancelRef.current === cancel) {
        requestCancelRef.current = () => undefined;
      }
    };
  }, [cancel]);

  return {
    recording,
    processing,
    ready,
    text,
    error,
    errorId,
    mode: DICTATION_MODE,
    start,
    stop,
    cancel,
  };
}

function toUserFacingTranscriptionError(err: unknown) {
  if (isTranscriptionSessionError(err)) {
    return err.message;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("model") &&
    (lowerMessage.includes("missing") ||
      lowerMessage.includes("incomplete") ||
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("not installed") ||
      lowerMessage.includes("not downloaded") ||
      lowerMessage.includes("load failed"))
  ) {
    return "Model unavailable. Open Settings to install.";
  }

  return message;
}

function createUntrimmedVadResult(
  audio: CapturedAudio,
  vadMs: number,
): VadAudioResult {
  return {
    audio,
    // A non-empty capture is worth sending to STT when VAD is unavailable.
    // The provider remains the authority on whether it contains speech.
    speechDetected: audio.pcm16.length > 0,
    segments: [],
    trimRange: {
      startSample: 0,
      endSample: audio.pcm16.length,
    },
    leadingTrimmedMs: 0,
    trailingTrimmedMs: 0,
    vadMs,
  };
}

interface TranscriptionLatencyTiming {
  stopStartedAt: number;
  postRollStartedAt: number;
  postRollDoneAt: number;
  pcmStopStartedAt: number;
  pcmReadyAt: number;
  vadStartedAt: number;
  vadDoneAt: number;
  sttStartedAt: number;
  sttDoneAt: number;
  pasteStartedAt: number;
  pasteDoneAt: number;
}

function logTranscriptionLatency({
  providerKind,
  status,
  timing,
  capturedAudioMs,
  vadResult,
  metrics,
}: {
  providerKind: TranscriptionProviderKind;
  status: "done" | "no_speech";
  timing: TranscriptionLatencyTiming;
  capturedAudioMs: number;
  vadResult: VadAudioResult;
  metrics?: Record<string, unknown>;
}) {
  const totalDoneAt = performance.now();
  const trimmedMs = vadResult.leadingTrimmedMs + vadResult.trailingTrimmedMs;

  latencyLog.info("Transcription", {
    provider: providerKind,
    status,
    total_ms: elapsedMs(timing.stopStartedAt, totalDoneAt),
    post_roll_ms: elapsedMs(timing.postRollStartedAt, timing.postRollDoneAt),
    pcm_ready_ms: elapsedMs(timing.pcmStopStartedAt, timing.pcmReadyAt),
    vad_wall_ms: elapsedMs(timing.vadStartedAt, timing.vadDoneAt),
    vad_engine_ms: vadResult.vadMs,
    stt_wall_ms: elapsedMs(timing.sttStartedAt, timing.sttDoneAt),
    sidecar_inference_ms: numberMetric(metrics, "inference_ms"),
    paste_ms: elapsedMs(timing.pasteStartedAt, timing.pasteDoneAt),
    captured_audio_ms: capturedAudioMs,
    transcribed_audio_ms: Math.round(vadResult.audio.durationMs),
    trimmed_audio_ms: Math.round(trimmedMs),
  });
}

function elapsedMs(startAt: number, doneAt: number): number | null {
  if (startAt <= 0 || doneAt <= 0) {
    return null;
  }
  return Math.max(0, Math.round(doneAt - startAt));
}

function numberMetric(
  metrics: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = metrics?.[key];
  return typeof value === "number" ? Math.round(value) : null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
