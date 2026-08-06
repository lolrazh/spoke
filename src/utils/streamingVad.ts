/**
 * Streaming VAD: feeds PCM16 frames into a session-owned Silero worker
 * incrementally, as they arrive during capture, instead of waiting for
 * recording to stop and re-scanning the whole clip (see vadTrimmer.ts for
 * that post-hoc path, kept as a fallback).
 *
 * This lets useTranscription.ts make an adaptive post-roll decision at
 * key-release: if the model already confirmed speech ended a redemption
 * window ago, the trailing audio is already captured and no extra wait is
 * needed. If speech is still active (or the model hasn't caught up yet), we
 * keep capturing until it settles, capped at POST_ROLL_MS.
 *
 * The worker owns both onnxruntime-web and its WASM heap. Finishing or
 * cancelling terminates that worker, which makes reclamation deterministic
 * and prevents inference work from blocking the renderer's UI thread.
 */
import { pcm16ToFloat32, type CapturedAudio } from "../core/transcription/capturedAudio";
import {
  trimCapturedAudioToSpeech,
  type VadAudioResult,
  type VadSpeechSegment,
} from "../core/transcription/vadTrim";
import {
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
} from "../config/vad";
import { createVadWorkerClient, type VadWorkerClient } from "./vadWorkerClient";
import type { VadWorkerEvent } from "./vadWorkerProtocol";
import { createLogger } from "./logger";

const log = createLogger("StreamingVAD");

// The Silero legacy model (see @ricky0123/vad-web's NonRealTimeVAD.new)
// requires fixed 1536-sample windows at 16kHz (96ms). Our capture frames are
// 30ms (480 samples @ 16kHz, see PCM_CAPTURE_FRAME_SAMPLES in config/audio.ts)
// and don't divide evenly into that, so we re-chunk here.
const MODEL_FRAME_SAMPLES = 1536;
const MODEL_SAMPLES_PER_MS = 16; // 16,000 Hz / 1000 ms
const QUIET_POLL_INTERVAL_MS = 20;

type SessionStatus = "pending" | "ready" | "failed";

export interface StreamingVadSessionHandle {
  /** False once the model has failed to load; callers should use the
   * post-hoc fallback (fixed post-roll + trimCapturedAudioWithVad) instead. */
  isUsable(): boolean;
  /** Feed a real-time PCM16 capture frame (any length) into the processor. */
  pushFrame(pcm16: Int16Array): void;
  /**
   * Resolves once speech has settled (confirmed ended at least a redemption
   * window ago) or `maxWaitMs` elapses, whichever comes first. Returns the
   * actual number of ms waited.
   */
  waitForQuiet(maxWaitMs: number): Promise<number>;
  /**
   * Flushes remaining buffered samples, finalizes any in-progress speech
   * segment, and produces the same trim result the post-hoc path would.
   * Returns null if the streaming processor never became usable (caller
   * should fall back to `trimCapturedAudioWithVad`).
   */
  finish(capturedAudio: CapturedAudio): Promise<VadAudioResult | null>;
  /** Releases the session without producing a result (used on cancel()). */
  dispose(): void;
}

export interface StreamingVadSessionOptions {
  /** Invoked when VAD detects speech resuming after a pause. */
  onSpeechStart?: () => void;
  /** Invoked after the VAD confirms a speech segment ended. */
  onSpeechEnd?: () => void;
}

export function createStreamingVadSession(
  options: StreamingVadSessionOptions = {},
): StreamingVadSessionHandle {
  return new StreamingVadSession(
    undefined,
    undefined,
    options.onSpeechStart,
    options.onSpeechEnd,
  );
}

class StreamingVadSession implements StreamingVadSessionHandle {
  private status: SessionStatus = "pending";
  private readonly worker: VadWorkerClient = createVadWorkerClient();
  private processingQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private workerDisposed = false;

  // Persistent scratch for samples that don't yet fill a model window. Sized
  // for a full window (leftover is always < MODEL_FRAME_SAMPLES), so it's
  // allocated once and reused rather than re-sliced every 30ms frame.
  private readonly carryBuf = new Float32Array(MODEL_FRAME_SAMPLES);
  private carryLen = 0;
  private pendingWindows: Float32Array[] = [];
  private queueDepth = 0;

  private segments: VadSpeechSegment[] = [];
  private speaking = false;
  private everSpoke = false;
  private speechStartFrameIndex = 0;
  private speechEndAtMs: number | null = null;

  private totalCapturedMs = 0;
  private frameIndex = 0;

  // Set only by dispose() (the cancel() path). Distinct from `disposed`
  // (set by both dispose() and finish()) so an init that's still in flight
  // when finish() runs can complete normally and hand off buffered windows,
  // while an init that's still in flight when dispose() runs discards them.
  private cancelled = false;

  private readonly initializePromise: Promise<void>;

  constructor(
    private readonly preSpeechPadMs = VAD_PRE_SPEECH_PAD_MS,
    private readonly redemptionMs = VAD_REDEMPTION_MS,
    private readonly onSpeechStart?: () => void,
    private readonly onSpeechEnd?: () => void,
  ) {
    this.initializePromise = this.initialize();
  }

  // Note: `disposed` intentionally isn't checked here. It only means "stop
  // accepting new frames" (see pushFrame/finish); an in-flight init must
  // still be allowed to complete so finish() can await it and drain
  // whatever was buffered before the session was disposed.
  private async initialize(): Promise<void> {
    try {
      await this.worker.ready();
      if (this.cancelled) {
        this.pendingWindows = [];
        this.queueDepth = 0;
        return;
      }
      this.status = "ready";
      this.drainPendingWindows();
    } catch (error) {
      this.status = "failed";
      this.pendingWindows = [];
      this.queueDepth = 0;
      this.disposeWorker();
      log.warn("Model init failed, streaming VAD unavailable:", error);
    }
  }

  isUsable(): boolean {
    return this.status !== "failed";
  }

  pushFrame(pcm16: Int16Array): void {
    if (this.disposed || this.status === "failed" || pcm16.length === 0) {
      return;
    }
    this.totalCapturedMs += pcm16.length / MODEL_SAMPLES_PER_MS;
    this.appendSamples(pcm16ToFloat32(pcm16));
  }

  private appendSamples(float32: Float32Array): void {
    // Emit as many full MODEL_FRAME_SAMPLES windows as carry + this frame can
    // fill, without materializing a `combined` buffer per frame. Each window is
    // still its own Float32Array because it is transferred to the worker; only
    // the transient per-frame `combined`/carry slices are gone.
    let inputOffset = 0;
    while (this.carryLen + (float32.length - inputOffset) >= MODEL_FRAME_SAMPLES) {
      const window = new Float32Array(MODEL_FRAME_SAMPLES);
      if (this.carryLen > 0) {
        window.set(this.carryBuf.subarray(0, this.carryLen), 0);
      }
      const needed = MODEL_FRAME_SAMPLES - this.carryLen;
      window.set(float32.subarray(inputOffset, inputOffset + needed), this.carryLen);
      inputOffset += needed;
      this.carryLen = 0;
      this.enqueueWindow(window);
    }

    // Stash the remaining (sub-window) samples back into the reusable carry.
    const remaining = float32.length - inputOffset;
    if (remaining > 0) {
      this.carryBuf.set(
        float32.subarray(inputOffset, inputOffset + remaining),
        this.carryLen,
      );
      this.carryLen += remaining;
    }
  }

  private enqueueWindow(window: Float32Array): void {
    this.queueDepth++;
    if (this.status === "ready") {
      this.submitWindow(window);
    } else {
      this.pendingWindows.push(window);
    }
  }

  private drainPendingWindows(): void {
    const pending = this.pendingWindows;
    this.pendingWindows = [];
    for (const window of pending) {
      this.submitWindow(window);
    }
  }

  private submitWindow(window: Float32Array): void {
    const indexForWindow = this.frameIndex;
    this.frameIndex += 1;
    const processWindow = async () => {
      try {
        const events = await this.worker.processFrame(window, indexForWindow);
        for (const event of events) this.handleEvent(event);
      } catch (error) {
        this.status = "failed";
        this.disposeWorker();
        log.warn("Streaming VAD frame processing failed:", error);
      } finally {
        this.queueDepth = Math.max(0, this.queueDepth - 1);
      }
    };
    this.processingQueue = this.processingQueue.then(processWindow, processWindow);
  }

  private handleEvent(event: VadWorkerEvent): void {
    switch (event.type) {
      case "speech-start":
        this.speaking = true;
        this.everSpoke = true;
        this.speechStartFrameIndex = event.frameIndex;
        this.onSpeechStart?.();
        break;
      case "speech-end": {
        const startMs = (this.speechStartFrameIndex * MODEL_FRAME_SAMPLES) /
          MODEL_SAMPLES_PER_MS;
        const endMs = ((event.frameIndex + 1) * MODEL_FRAME_SAMPLES) /
          MODEL_SAMPLES_PER_MS;
        this.segments.push({ startMs, endMs });
        this.speaking = false;
        this.speechEndAtMs = endMs;
        this.onSpeechEnd?.();
        break;
      }
      case "misfire":
        this.speaking = false;
        this.speechEndAtMs = ((event.frameIndex + 1) * MODEL_FRAME_SAMPLES) /
          MODEL_SAMPLES_PER_MS;
        break;
      default:
        break;
    }
  }

  private isQuietEnough(): boolean {
    if (this.status !== "ready") return false;
    if (this.queueDepth > 0) return false;
    if (this.speaking) return false;
    if (!this.everSpoke) return true;
    const elapsedSinceEnd =
      this.totalCapturedMs - (this.speechEndAtMs ?? this.totalCapturedMs);
    return elapsedSinceEnd >= this.redemptionMs;
  }

  async waitForQuiet(maxWaitMs: number): Promise<number> {
    if (this.isQuietEnough()) return 0;

    const startedAt = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const elapsed = performance.now() - startedAt;
        if (this.isQuietEnough() || elapsed >= maxWaitMs) {
          resolve(Math.min(Math.round(elapsed), maxWaitMs));
          return;
        }
        setTimeout(check, QUIET_POLL_INTERVAL_MS);
      };
      setTimeout(check, QUIET_POLL_INTERVAL_MS);
    });
  }

  async finish(capturedAudio: CapturedAudio): Promise<VadAudioResult | null> {
    if (this.disposed) return null;
    this.disposed = true;
    const startedAt = performance.now();

    try {
      // Await the single init attempt kicked off in the constructor. The
      // worker client bounds initialization and terminates itself on timeout.
      await this.initializePromise;
      if (this.status !== "ready") {
        return null;
      }

      this.drainPendingWindows();
      const finalFrameIndex = this.frameIndex;
      await this.processingQueue;
      const events = await this.worker.finish(Math.max(0, finalFrameIndex - 1));
      for (const event of events) this.handleEvent(event);

      const result = trimCapturedAudioToSpeech(capturedAudio, this.segments, {
        preSpeechPadMs: this.preSpeechPadMs,
        redemptionMs: this.redemptionMs,
      });

      return {
        ...result,
        vadMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      log.warn("Streaming VAD finish failed, falling back to post-hoc VAD:", error);
      this.status = "failed";
      return null;
    } finally {
      this.disposeWorker();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelled = true;
    this.pendingWindows = [];
    this.queueDepth = 0;
    this.disposeWorker();
  }

  private disposeWorker(): void {
    if (this.workerDisposed) return;
    this.workerDisposed = true;
    this.worker.dispose();
  }
}
