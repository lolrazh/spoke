import {
  WINDOW_MS,
  SAMPLE_RATE_HZ,
  PRE_ROLL_MS,
  POST_ROLL_MS_VAD,
  CHUNK_DETECTION_ENABLED,
  SPEECH_PROB_END,
} from "../config/vad";
import type { VadEngine, VadEvent } from "../types/vad";
import { VadGate } from "./vadGate";
import { ChunkDetector, type ChunkEvent } from "./chunkDetector";

/**
 * Streaming gate: accepts Int16 PCM16LE@16k frames, slices into 30ms Float32
 * windows for the engine, maintains pre/post-roll buffers, and returns the
 * Int16 frames that should be forwarded to the network.
 */
export class VadStreamGate {
  private engine: VadEngine;
  private gate: VadGate;
  private chunkDetector: ChunkDetector | null = null;
  private windowSamples: number;
  private preRollSamples: number;
  private postRollSamples: number;
  private preRollBuf: Int16Array;
  private preRollHead = 0; // ring buffer idx
  private preRollCount = 0;
  private tailRemainingSamples = 0; // forward a small tail after speech_end
  private carryFloat: Float32Array | null = null; // leftover window slice
  private timeMs = 0; // approximate timeline in ms, step by WINDOW_MS
  private currentFrameHasSpeech = false; // track if current frame contains speech

  constructor(
    engine: VadEngine,
    onEvent?: (ev: VadEvent) => void,
    onChunkEvent?: (ev: ChunkEvent) => void,
  ) {
    this.engine = engine;
    this.gate = new VadGate();
    this.onEvent = onEvent;
    this.onChunkEvent = onChunkEvent;
    this.windowSamples = Math.round((SAMPLE_RATE_HZ * WINDOW_MS) / 1000);
    this.preRollSamples = Math.round((SAMPLE_RATE_HZ * PRE_ROLL_MS) / 1000);
    this.postRollSamples = Math.round((SAMPLE_RATE_HZ * POST_ROLL_MS_VAD) / 1000);
    this.preRollBuf = new Int16Array(this.preRollSamples);

    // Initialize chunk detector if enabled
    if (CHUNK_DETECTION_ENABLED) {
      this.chunkDetector = new ChunkDetector();
    }
  }

  private onEvent?: (ev: VadEvent) => void;
  private onChunkEvent?: (ev: ChunkEvent) => void;

  reset(): void {
    this.gate.reset();
    this.chunkDetector?.reset();
    this.preRollHead = 0;
    this.preRollCount = 0;
    this.tailRemainingSamples = 0;
    this.carryFloat = null;
    this.timeMs = 0;
    this.currentFrameHasSpeech = false;
  }

  dispose(): void {
    // no-op, engine is owned by caller
    this.reset();
  }

  /** Get chunk detector state for debugging */
  getChunkState() {
    return this.chunkDetector?.getState() ?? null;
  }

  /** Get remaining unchunked audio info (for final send) */
  getRemainingChunk() {
    return this.chunkDetector?.getRemainingChunk() ?? null;
  }

  /** Push a full Int16 frame; returns zero or more Int16 chunks to forward */
  pushFrame(frameBuf: ArrayBuffer | Int16Array): Int16Array[] {
    const int16 = frameBuf instanceof Int16Array ? frameBuf : new Int16Array(frameBuf);
    // Convert to Float32 in [-1,1]
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

    // Slice to fixed windows with carry
    const windows: Float32Array[] = [];
    let cursor = 0;
    if (this.carryFloat && this.carryFloat.length > 0) {
      const need = this.windowSamples - this.carryFloat.length;
      if (f32.length >= need) {
        const filled = new Float32Array(this.windowSamples);
        filled.set(this.carryFloat, 0);
        filled.set(f32.subarray(0, need), this.carryFloat.length);
        windows.push(filled);
        cursor += need;
        this.carryFloat = null;
      } else {
        const merged = new Float32Array(this.carryFloat.length + f32.length);
        merged.set(this.carryFloat, 0);
        merged.set(f32, this.carryFloat.length);
        this.carryFloat = merged;
        return [];
      }
    }
    while (cursor + this.windowSamples <= f32.length) {
      windows.push(f32.subarray(cursor, cursor + this.windowSamples));
      cursor += this.windowSamples;
    }
    if (cursor < f32.length) {
      const rem = f32.subarray(cursor);
      const carry = new Float32Array(rem.length);
      carry.set(rem, 0);
      this.carryFloat = carry;
    }

    // Process decisions and produce output chunks
    const out: Int16Array[] = [];

    // Track if THIS frame contains speech (any window with speech)
    this.currentFrameHasSpeech = false;

    for (let w = 0; w < windows.length; w++) {
      const d = this.engine.process(windows[w]);
      this.gate.push(d, this.timeMs);

      // Check if this window contains speech
      const prob = d.probability ?? (d.isSpeech ? 1.0 : 0.0);
      const windowHasSpeech = prob > SPEECH_PROB_END; // Use same threshold as gate
      if (windowHasSpeech) {
        this.currentFrameHasSpeech = true;
      }

      // Feed chunk detector with same VAD decision
      if (this.chunkDetector) {
        this.chunkDetector.push(d, this.timeMs);
        // Drain and emit chunk events
        const chunkEvents = this.chunkDetector.drainEvents();
        for (const cev of chunkEvents) {
          try {
            this.onChunkEvent?.(cev);
          } catch {}
        }
      }

      this.timeMs += WINDOW_MS;

      const events = this.gate.drainEvents();
      for (const ev of events) {
        try { this.onEvent?.(ev); } catch {}
        if (ev.type === "speech_start") {
          // On start, flush pre-roll first as a single contiguous chunk
          if (this.preRollCount > 0) {
            const n = this.preRollCount;
            const chunk = new Int16Array(n);
            // Reconstruct contiguous order from ring buffer
            const start = (this.preRollHead - n + this.preRollBuf.length) % this.preRollBuf.length;
            const first = Math.min(n, this.preRollBuf.length - start);
            chunk.set(this.preRollBuf.subarray(start, start + first), 0);
            if (n > first) {
              chunk.set(this.preRollBuf.subarray(0, n - first), first);
            }
            out.push(chunk);
          }
        }
        if (ev.type === "speech_end") {
          // Begin forwarding a small tail regardless of VAD to avoid clipping endings
          this.tailRemainingSamples = this.postRollSamples;
        }
      }
    }

    // Gate forwarding: forward frame ONLY if it contains speech OR we're in post-roll tail
    // This cuts silence DURING recording, sending only dense speech audio to the server
    if (this.currentFrameHasSpeech || this.tailRemainingSamples > 0) {
      out.push(int16);
      if (this.tailRemainingSamples > 0) {
        this.tailRemainingSamples = Math.max(0, this.tailRemainingSamples - int16.length);
      }
    } else {
      // This frame is silence - buffer it to pre-roll
      // If speech resumes while we're in a recording session, this provides context
      const src = int16;
      for (let i = 0; i < src.length; i++) {
        if (this.preRollSamples === 0) break;
        this.preRollBuf[this.preRollHead] = src[i];
        this.preRollHead = (this.preRollHead + 1) % this.preRollBuf.length;
        this.preRollCount = Math.min(this.preRollCount + 1, this.preRollBuf.length);
      }
    }

    return out;
  }

  /**
   * On final stop, allow a small tail by emitting a last slice from pre-roll
   * if the speaker was active recently; in gate-only mode we simply clear.
   */
  flushPostRoll(): Int16Array[] {
    // In gate-only v1, we do not actively craft a tail beyond what is already streamed
    // because timing is managed by the caller's capture POST_ROLL_MS. Clear the ring.
    this.preRollHead = 0;
    this.preRollCount = 0;
    return [];
  }
}

