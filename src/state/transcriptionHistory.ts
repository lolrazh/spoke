import {
  MAX_TRANSCRIPTION_HISTORY,
  type TranscriptionItem,
} from "../types/shared";

const listeners = new Set<(items: TranscriptionItem[]) => void>();
let items: TranscriptionItem[] = [];
let hasMore = false;
let initPromise: Promise<TranscriptionItem[]> | null = null;
let loadMorePromise: Promise<void> | null = null;
const PAGE_SIZE = 50;

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
      const page = await window.transcriptions.getPage(0, PAGE_SIZE);
      items = page.items;
      hasMore = page.hasMore;
    } catch (error) {
      console.error("[TranscriptionHistory] Failed to load:", error);
      items = [];
      hasMore = false;
    }
    emit();
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

export function hasMoreTranscriptionHistory(): boolean {
  return hasMore;
}

/** Load the next bounded page of history, sharing overlapping requests. */
export async function loadMoreTranscriptionHistory(): Promise<void> {
  if (!hasMore) return;
  if (loadMorePromise) return loadMorePromise;

  const promise = (async () => {
    try {
      const page = await window.transcriptions.getPage(items.length, PAGE_SIZE);
      const existingIds = new Set(items.map((item) => item.id));
      const nextItems = page.items.filter((item) => !existingIds.has(item.id));
      const changed = nextItems.length > 0 || hasMore !== page.hasMore;

      if (nextItems.length > 0) {
        items = [...items, ...nextItems];
      }
      hasMore = page.hasMore;
      if (changed) emit();
    } catch (error) {
      console.error("[TranscriptionHistory] Failed to load more:", error);
    } finally {
      loadMorePromise = null;
    }
  })();

  loadMorePromise = promise;
  return promise;
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
  void initTranscriptionHistory().catch(() => {
    // Keep the empty in-memory state if storage is unavailable.
  });
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
