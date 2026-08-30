import { useSyncExternalStore } from "react";

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
  const wasActive = liveTranscript.length > 0;
  liveTranscript = next;
  if (listeners.size > 0) scheduleEmit();
  if (wasActive !== (next.length > 0)) emitActive();
}

/** Read the current transient live hypothesis synchronously. */
export function getLiveTranscript(): string {
  return liveTranscript;
}

function subscribe(listener: () => void): () => void {
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

/** Subscribe a live-transcript leaf to each hypothesis update. */
export function useLiveTranscript(): string {
  return useSyncExternalStore(subscribe, getLiveTranscript, getLiveTranscript);
}

/** Subscribe to only the empty/non-empty transition used by the pill shell. */
export function useLiveTranscriptActive(): boolean {
  return useSyncExternalStore(
    subscribeActive,
    getLiveTranscriptActive,
    getLiveTranscriptActive,
  );
}
