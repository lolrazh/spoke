import {
  MAX_TRANSCRIPTION_HISTORY,
  type TranscriptionItem,
} from "../types/shared";

const listeners = new Set<(items: TranscriptionItem[]) => void>();
let items: TranscriptionItem[] = [];
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
      // Loaded successfully
    } catch (error) {
      console.error("[TranscriptionHistory] Failed to load:", error);
      items = [];
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

  // Keep in sync with the storage cap
  if (items.length > MAX_TRANSCRIPTION_HISTORY) {
    items = items.slice(0, MAX_TRANSCRIPTION_HISTORY);
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
