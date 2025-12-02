/**
 * ChunkDetector - Detects natural sentence boundaries for incremental transcription.
 *
 * This detector watches VAD decisions and identifies when we've accumulated
 * enough audio AND hit a sentence-ending pause (600-800ms of silence).
 *
 * Phase 1: Simulation mode - logs when chunks would be created, doesn't actually send.
 */

import type { VadDecision } from "../types/vad";
import {
  WINDOW_MS,
  MIN_CHUNK_AUDIO_MS,
  SENTENCE_PAUSE_MS,
  CHUNK_SILENCE_PROB,
} from "../config/vad";

export interface ChunkEvent {
  type: "chunk_boundary";
  chunkIndex: number;
  audioMs: number; // Duration of this chunk
  silenceMs: number; // Silence duration that triggered the boundary
  totalAudioMs: number; // Total audio since session start
  atMs: number; // When this was detected
}

export class ChunkDetector {
  private chunkIndex = 0;
  private currentChunkAudioMs = 0; // Audio accumulated in current chunk
  private totalAudioMs = 0; // Total audio since session start
  private consecutiveSilenceMs = 0; // Current silence streak
  private inSpeech = false; // Whether we're currently in a speech segment
  private events: ChunkEvent[] = [];
  private sessionStartMs: number | null = null;

  /**
   * Process a VAD decision and check if we should chunk.
   * Call this for each VAD window (typically 30ms).
   */
  push(decision: VadDecision, atMs: number): void {
    if (this.sessionStartMs === null) {
      this.sessionStartMs = atMs;
    }

    const prob = decision.probability ?? (decision.isSpeech ? 1.0 : 0.0);
    const isSilence = prob < CHUNK_SILENCE_PROB;

    // Always accumulate audio time (we're recording regardless)
    this.currentChunkAudioMs += WINDOW_MS;
    this.totalAudioMs += WINDOW_MS;

    if (isSilence) {
      this.consecutiveSilenceMs += WINDOW_MS;

      // Check for chunk boundary:
      // 1. We have enough audio in this chunk (MIN_CHUNK_AUDIO_MS)
      // 2. We've hit a sentence-ending pause (SENTENCE_PAUSE_MS)
      // 3. We were previously speaking (not silence from the start)
      if (
        this.currentChunkAudioMs >= MIN_CHUNK_AUDIO_MS &&
        this.consecutiveSilenceMs >= SENTENCE_PAUSE_MS &&
        this.inSpeech
      ) {
        this.events.push({
          type: "chunk_boundary",
          chunkIndex: this.chunkIndex,
          audioMs: this.currentChunkAudioMs,
          silenceMs: this.consecutiveSilenceMs,
          totalAudioMs: this.totalAudioMs,
          atMs,
        });

        // Reset for next chunk
        this.chunkIndex += 1;
        this.currentChunkAudioMs = 0;
        this.consecutiveSilenceMs = 0;
        this.inSpeech = false;
      }
    } else {
      // Speech detected
      this.consecutiveSilenceMs = 0;
      this.inSpeech = true;
    }
  }

  /**
   * Drain all pending chunk events.
   */
  drainEvents(): ChunkEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Get current state for debugging.
   */
  getState(): {
    chunkIndex: number;
    currentChunkAudioMs: number;
    totalAudioMs: number;
    consecutiveSilenceMs: number;
    inSpeech: boolean;
  } {
    return {
      chunkIndex: this.chunkIndex,
      currentChunkAudioMs: this.currentChunkAudioMs,
      totalAudioMs: this.totalAudioMs,
      consecutiveSilenceMs: this.consecutiveSilenceMs,
      inSpeech: this.inSpeech,
    };
  }

  /**
   * Get info about remaining audio that wasn't chunked (for final send).
   */
  getRemainingChunk(): { audioMs: number; chunkIndex: number } | null {
    if (this.currentChunkAudioMs > 0) {
      return {
        audioMs: this.currentChunkAudioMs,
        chunkIndex: this.chunkIndex,
      };
    }
    return null;
  }

  /**
   * Reset all state for a new session.
   */
  reset(): void {
    this.chunkIndex = 0;
    this.currentChunkAudioMs = 0;
    this.totalAudioMs = 0;
    this.consecutiveSilenceMs = 0;
    this.inSpeech = false;
    this.events = [];
    this.sessionStartMs = null;
  }
}
