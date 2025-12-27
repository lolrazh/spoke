import type { TranscriptionItem } from "../types/shared";

const listeners = new Set<(items: TranscriptionItem[]) => void>();
let items: TranscriptionItem[] = [];
let initialized = false;
let initPromise: Promise<TranscriptionItem[]> | null = null;

function emit() {
  for (const listener of listeners) {
    try {
      listener(items);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Initialize transcription history by loading from storage.
 * Safe to call multiple times - will return cached promise.
 */
export async function initTranscriptionHistory(): Promise<TranscriptionItem[]> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      items = await window.transcriptions.getAll();
      initialized = true;
      // Loaded successfully
    } catch (error) {
      console.error("[TranscriptionHistory] Failed to load:", error);
      items = [];
      initialized = true;
    }
    return items;
  })();

  return initPromise;
}

/**
 * Get current transcription history (synchronous, in-memory).
 */
export function getTranscriptionHistory(): TranscriptionItem[] {
  return items;
}

/**
 * Check if history has been initialized.
 */
export function isTranscriptionHistoryInitialized(): boolean {
  return initialized;
}

/**
 * Subscribe to transcription history changes.
 * Callback is called immediately with current state, then on each change.
 */
export function subscribeTranscriptionHistory(
  listener: (items: TranscriptionItem[]) => void,
): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Add a new transcription to history.
 * Updates in-memory state immediately, then persists to storage.
 */
export async function addTranscription(
  text: string,
  mode: "dictation" | "edit",
): Promise<TranscriptionItem> {
  const newItem = await window.transcriptions.save({
    text,
    timestamp: Date.now(),
    mode,
  });

  // Add to beginning of in-memory list
  items = [newItem, ...items];

  // Keep in sync with storage cap (100000 items)
  if (items.length > 100000) {
    items = items.slice(0, 100000);
  }

  emit();
  return newItem;
}

/**
 * Delete a transcription by ID.
 */
export async function deleteTranscription(id: string): Promise<boolean> {
  const success = await window.transcriptions.delete(id);

  if (success) {
    items = items.filter((item) => item.id !== id);
    emit();
  }

  return success;
}

/**
 * Clear all transcription history.
 */
export async function clearTranscriptionHistory(): Promise<void> {
  await window.transcriptions.clear();
  items = [];
  emit();
}

/**
 * Reset state for tests.
 */
export function resetTranscriptionHistoryForTests(): void {
  items = [];
  initialized = false;
  initPromise = null;
  listeners.clear();
}
