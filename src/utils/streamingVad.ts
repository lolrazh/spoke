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
 * The worker owns both onnxruntime-web and its WASM heap. Each session owns
 * one worker and terminates it when the session finishes or is cancelled, so
 * no worker state or model memory is shared between recordings.
 */
import type { CapturedAudio } from "../core/transcription/capturedAudio";
import {
  trimCapturedAudioToSpeech,
  type VadAudioResult,
  type VadSpeechSegment,
} from "../core/transcription/vadTrim";
import {
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
} from "../config/vad";
import { createVadWorkerClient } from "./vadWorkerClient";
import type { VadWorkerEvent } from "./vadWorkerProtocol";
import { createLogger } from "./logger";

const log = createLogger("StreamingVAD");

// The Silero legacy model (see @ricky0123/vad-web's NonRealTimeVAD.new)
// requires fixed 1536-sample windows at 16kHz (96ms). Our capture frames are
// 30ms (480 samples @ 16kHz, see PCM_CAPTURE_FRAME_SAMPLES in config/audio.ts)
// and don't divide evenly into that, so we re-chunk here.
const MODEL_FRAME_SAMPLES = 1536;
const MODEL_SAMPLES_PER_MS = 16; // 16,000 Hz / 1000 ms
const PCM16_TO_FLOAT_GAIN = 1 / 32768;
const QUIET_POLL_INTERVAL_MS = 20;
// Keep a slow VAD worker from retaining an unbounded chain of transferred
// windows. At the normal 96ms model window size this is about 6 seconds of
// backlog, after which the existing post-hoc VAD path is safer.
const MAX_PENDING_VAD_WINDOWS = 64;

type SessionStatus = "pending" | "ready" | "failed";

type PendingVadWindow = {
  frame: Float32Array;
  frameIndex: number;
};

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
  try {
    return new StreamingVadSession(
      undefined,
      undefined,
      options.onSpeechStart,
      options.onSpeechEnd,
    );
  } catch (error) {
    // VAD only improves trimming and post-roll latency. A browser that cannot
    // construct the worker must still be able to record and transcribe.
    log.warn("Worker creation failed, streaming VAD unavailable:", error);
    return UNAVAILABLE_STREAMING_VAD_SESSION;
  }
}

const UNAVAILABLE_STREAMING_VAD_SESSION: StreamingVadSessionHandle = {
  isUsable: () => false,
  pushFrame: () => undefined,
  waitForQuiet: async () => 0,
  finish: async () => null,
  dispose: () => undefined,
};

class StreamingVadSession implements StreamingVadSessionHandle {
  private status: SessionStatus = "pending";
  private readonly worker = createVadWorkerClient();
  private processingPumpPromise: Promise<void> | null = null;
  private disposed = false;
  private workerReleased = false;

  // Persistent scratch for samples that don't yet fill a model window. Sized
  // for a full window (leftover is always < MODEL_FRAME_SAMPLES), so it's
  // allocated once and reused rather than re-sliced every 30ms frame.
  private readonly carryBuf = new Float32Array(MODEL_FRAME_SAMPLES);
  private carryLen = 0;
  private readonly pendingWindows: PendingVadWindow[] = [];
  private pendingWindowStart = 0;
  private queueDepth = 0;
  private recycledWindow: Float32Array | null = null;

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
      if (this.cancelled || this.status === "failed") {
        this.clearPendingWindows();
        this.queueDepth = 0;
        return;
      }
      this.status = "ready";
      this.drainPendingWindows();
    } catch (error) {
      this.status = "failed";
      this.clearPendingWindows();
      this.queueDepth = 0;
      this.disposeWorker();
      log.warn("Model init failed, streaming VAD unavailable:", error);
    }
  }

  isUsable(): boolean {
    return !this.cancelled && this.status !== "failed";
  }

  pushFrame(pcm16: Int16Array): void {
    if (this.disposed || this.status === "failed" || pcm16.length === 0) {
      return;
    }
    this.totalCapturedMs += pcm16.length / MODEL_SAMPLES_PER_MS;
    this.appendSamples(pcm16);
  }

  private appendSamples(pcm16: Int16Array): void {
    // Emit as many full MODEL_FRAME_SAMPLES windows as carry + this frame can
    // fill, without materializing a Float32Array for every 30ms capture frame.
    // Each window is still its own Float32Array because it is transferred to
    // the worker; the PCM conversion writes directly into those windows.
    let inputOffset = 0;
    while (this.carryLen + (pcm16.length - inputOffset) >= MODEL_FRAME_SAMPLES) {
      const window =
        this.recycledWindow ?? new Float32Array(MODEL_FRAME_SAMPLES);
      this.recycledWindow = null;
      if (this.carryLen > 0) {
        window.set(this.carryBuf.subarray(0, this.carryLen), 0);
      }
      const needed = MODEL_FRAME_SAMPLES - this.carryLen;
      copyPcm16ToFloat32(pcm16, inputOffset, window, this.carryLen, needed);
      inputOffset += needed;
      this.carryLen = 0;
      this.enqueueWindow(window);
    }

    // Stash the remaining (sub-window) samples back into the reusable carry.
    const remaining = pcm16.length - inputOffset;
    if (remaining > 0) {
      copyPcm16ToFloat32(
        pcm16,
        inputOffset,
        this.carryBuf,
        this.carryLen,
        remaining,
      );
      this.carryLen += remaining;
    }
  }

  private enqueueWindow(window: Float32Array): void {
    if (this.queueDepth >= MAX_PENDING_VAD_WINDOWS) {
      this.status = "failed";
      this.clearPendingWindows();
      this.queueDepth = 0;
      this.disposeWorker();
      log.warn(
        "Streaming VAD fell behind; falling back to post-hoc VAD:",
        `queue exceeded ${MAX_PENDING_VAD_WINDOWS} model windows`,
      );
      return;
    }
    this.queueDepth++;
    this.pendingWindows.push({
      frame: window,
      frameIndex: this.frameIndex++,
    });
    if (this.status === "ready") this.startProcessingPump();
  }

  private drainPendingWindows(): void {
    this.startProcessingPump();
  }

  private startProcessingPump(): void {
    if (
      this.processingPumpPromise ||
      this.pendingWindowStart >= this.pendingWindows.length
    ) {
      return;
    }

    this.processingPumpPromise = this.processPendingWindows().finally(() => {
      this.processingPumpPromise = null;
      if (!this.cancelled && this.status === "ready") {
        this.startProcessingPump();
      }
    });
  }

  private async processPendingWindows(): Promise<void> {
    while (
      this.pendingWindowStart < this.pendingWindows.length &&
      !this.cancelled &&
      this.status === "ready"
    ) {
      const pending = this.pendingWindows[this.pendingWindowStart];
      this.pendingWindowStart += 1;
      try {
        const result = await this.worker.processFrame(
          pending.frame,
          pending.frameIndex,
        );
        // Keep one spare only. A backlog can finish several windows before
        // capture produces another one; retaining all of them would leave
        // the queue bound resident after the worker catches up.
        this.recycledWindow = result.frame;
        if (this.cancelled || this.status !== "ready") return;
        for (const event of result.events) this.handleEvent(event);
      } catch (error) {
        if (!this.cancelled) {
          this.status = "failed";
          this.clearPendingWindows();
          this.queueDepth = 0;
          this.disposeWorker();
          log.warn("Streaming VAD frame processing failed:", error);
        }
        return;
      } finally {
        this.queueDepth = Math.max(0, this.queueDepth - 1);
      }
    }

    this.clearPendingWindows();
  }

  private clearPendingWindows(): void {
    this.pendingWindows.length = 0;
    this.pendingWindowStart = 0;
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
    if (this.cancelled) return true;
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
      if (this.cancelled || this.status !== "ready") {
        return null;
      }

      this.drainPendingWindows();
      const finalFrameIndex = this.frameIndex;
      await this.processingPumpPromise;
      if (this.cancelled || this.status !== "ready") return null;
      const events = await this.worker.finish(Math.max(0, finalFrameIndex - 1));
      if (this.cancelled) return null;
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
      if (!this.cancelled) {
        log.warn(
          "Streaming VAD finish failed, falling back to post-hoc VAD:",
          error,
        );
      }
      this.status = "failed";
      return null;
    } finally {
      this.disposeWorker();
    }
  }

  dispose(): void {
    if (this.cancelled || this.workerReleased) return;
    this.disposed = true;
    this.cancelled = true;
    this.clearPendingWindows();
    this.queueDepth = 0;
    this.disposeWorker();
  }

  private disposeWorker(): void {
    if (this.workerReleased) return;
    this.workerReleased = true;
    this.worker.dispose();
  }
}

function copyPcm16ToFloat32(
  source: Int16Array,
  sourceOffset: number,
  target: Float32Array,
  targetOffset: number,
  length: number,
): void {
  for (let index = 0; index < length; index += 1) {
    target[targetOffset + index] =
      source[sourceOffset + index] * PCM16_TO_FLOAT_GAIN;
  }
}
