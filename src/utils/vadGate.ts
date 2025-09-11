import type { VadDecision, VadEvent } from "../types/vad";
import {
  SPEECH_PROB_START,
  SPEECH_PROB_END,
  MIN_SPEECH_MS,
  MIN_SILENCE_MS,
  WINDOW_MS,
} from "../config/vad";

/**
 * Stateless-ish gate that applies hysteresis and timing constraints
 * over a stream of per-window VadDecision.
 */
export class VadGate {
  private speaking = false;
  private currentSpeechMs = 0;
  private currentSilenceMs = 0;
  private events: VadEvent[] = [];

  push(decision: VadDecision, atMs: number): void {
    const p = decision.probability;
    const isSpeech = typeof p === "number"
      ? (this.speaking ? p > SPEECH_PROB_END : p >= SPEECH_PROB_START)
      : decision.isSpeech;

    if (isSpeech) {
      this.currentSpeechMs += WINDOW_MS;
      this.currentSilenceMs = 0;
      if (!this.speaking && this.currentSpeechMs >= MIN_SPEECH_MS) {
        this.speaking = true;
        this.events.push({ type: "speech_start", atMs });
      }
    } else {
      this.currentSilenceMs += WINDOW_MS;
      this.currentSpeechMs = 0;
      if (this.speaking && this.currentSilenceMs >= MIN_SILENCE_MS) {
        this.speaking = false;
        this.events.push({ type: "speech_end", atMs });
      }
    }
  }

  drainEvents(): VadEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.currentSpeechMs = 0;
    this.currentSilenceMs = 0;
    this.events = [];
  }
}

