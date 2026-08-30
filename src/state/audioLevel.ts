/**
 * Live audio level store.
 *
 * During recording the PCM capture emits an audio level ~33x/sec (once per
 * 30ms frame). Holding that in React state re-renders every component that
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
 * Update the live audio level (0-1 range). No-ops when the value is unchanged
 * so identical frames don't wake subscribers.
 */
export function setAudioLevel(next: number): void {
  if (next === level) return;
  level = next;
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
