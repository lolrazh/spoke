import Store from "electron-store";
import type { TranscriptionItem } from "../types/shared";

const MAX_ITEMS = 10000;

interface TranscriptionStoreSchema {
  transcriptions: TranscriptionItem[];
}

const store = new Store<TranscriptionStoreSchema>({
  name: "transcription-history",
  defaults: {
    transcriptions: [],
  },
});

/**
 * Get all transcriptions from storage (most recent first)
 */
export function getTranscriptions(): TranscriptionItem[] {
  return store.get("transcriptions", []);
}

/**
 * Save a new transcription to storage
 * Automatically prunes to MAX_ITEMS
 */
export function saveTranscription(item: Omit<TranscriptionItem, "id">): TranscriptionItem {
  const transcriptions = store.get("transcriptions", []);

  const newItem: TranscriptionItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };

  // Add new item at the beginning (most recent first)
  transcriptions.unshift(newItem);

  // Prune to max items
  if (transcriptions.length > MAX_ITEMS) {
    transcriptions.length = MAX_ITEMS;
  }

  store.set("transcriptions", transcriptions);

  return newItem;
}

/**
 * Delete a transcription by ID
 */
export function deleteTranscription(id: string): boolean {
  const transcriptions = store.get("transcriptions", []);
  const index = transcriptions.findIndex((t) => t.id === id);

  if (index === -1) {
    return false;
  }

  transcriptions.splice(index, 1);
  store.set("transcriptions", transcriptions);

  return true;
}

/**
 * Clear all transcriptions
 */
export function clearTranscriptions(): void {
  store.set("transcriptions", []);
}
