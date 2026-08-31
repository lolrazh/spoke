import { useSyncExternalStore } from "react";

import { boundLiveTranscriptText } from "../utils/liveTranscriptText";

const listeners = new Set<() => void>();
const activeListeners = new Set<() => void>();
let liveTranscript = "";
let scheduledEmit: number | null = null;
let microtaskEmitScheduled = false;

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors so one UI consumer cannot block transcription.
    }
  }
}

function scheduleEmit(): void {
  if (scheduledEmit !== null || microtaskEmitScheduled) return;

  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    scheduledEmit = window.requestAnimationFrame(() => {
      scheduledEmit = null;
      emit();
    });
    return;
  }

  microtaskEmitScheduled = true;
  const flush = () => {
    microtaskEmitScheduled = false;
    emit();
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(flush);
  } else {
    void Promise.resolve().then(flush);
  }
}

function emitActive(): void {
  for (const listener of activeListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors so one UI consumer cannot block transcription.
    }
  }
}

/** Update the transient live hypothesis without re-rendering the app tree. */
export function setLiveTranscript(next: string): void {
  if (next === liveTranscript) return;
  const boundedNext = boundLiveTranscriptText(next);
  if (boundedNext === liveTranscript) return;
  const wasActive = liveTranscript.length > 0;
  liveTranscript = boundedNext;
  if (listeners.size > 0) scheduleEmit();
  if (wasActive !== (boundedNext.length > 0)) emitActive();
}

/** Read the current transient live hypothesis synchronously. */
export function getLiveTranscript(): string {
  return liveTranscript;
}

export function subscribeLiveTranscript(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getLiveTranscriptActive(): boolean {
  return liveTranscript.length > 0;
}

function subscribeActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

/** Subscribe to only the empty/non-empty transition used by the pill shell. */
export function useLiveTranscriptActive(): boolean {
  // Keep this small React subscription for the pill shell. The full text leaf
  // uses subscribeLiveTranscript imperatively because it updates every frame.
  return useSyncExternalStore(
    subscribeActive,
    getLiveTranscriptActive,
    getLiveTranscriptActive,
  );
}
