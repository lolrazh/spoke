/**
 * Live audio level store.
 *
 * During recording the PCM capture emits an audio level ~33x/sec (once per
 * 30ms frame). Holding that in React state re-renders every component that
 * consumes it. This tiny external store keeps the value outside React so only
 * the leaf that draws the level (the visualizer) subscribes and re-renders,
 * via `useSyncExternalStore`.
 */

import { useSyncExternalStore } from "react";

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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to the live audio level. Only the component that draws the level
 * should call this, so an audio frame re-renders that leaf alone.
 */
export function useAudioLevel(): number {
  return useSyncExternalStore(subscribe, getAudioLevel, getAudioLevel);
}

/**
 * Reset state for tests.
 */
export function resetAudioLevelForTests(): void {
  level = 0;
  listeners.clear();
}
