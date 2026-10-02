/**
 * Live audio level store.
 *
 * Capture publishes raw RMS separately from transcription PCM frames.
 * Holding that in React state re-renders every component that
 * consumes it. This tiny external store keeps the value outside React. The
 * visualizer subscribes imperatively and updates its existing DOM nodes, so
 * audio frames do not schedule React renders.
 */

const listeners = new Set<() => void>();
let level = 0;

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Publish raw RMS (0-1 range). Repeated readings keep the meter's timestamp
 * current, including sustained speech and silence.
 */
export function setAudioLevel(next: number): void {
  level = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0;
  emit();
}

/**
 * Read the current audio level synchronously (in-memory).
 */
export function getAudioLevel(): number {
  return level;
}

export function subscribeAudioLevel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
