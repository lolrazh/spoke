import Store from "electron-store";
import type { TranscriptionItem } from "../types/shared";

const MAX_ITEMS = 100000;

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
 * Validate and fix corrupted transcription items
 * Handles cases where text field might be an object instead of string
 */
function validateItem(item: unknown): TranscriptionItem | null {
  if (!item || typeof item !== "object") return null;

  const obj = item as Record<string, unknown>;

  // Extract text - handle case where text is nested object
  let text = obj.text;
  if (typeof text === "object" && text !== null) {
    // Corrupted: text contains the full item, try to extract actual text
    const nested = text as Record<string, unknown>;
    text = nested.text;
    console.warn(
      "[TranscriptionStorage] Fixed corrupted item with nested text",
    );
  }

  if (typeof text !== "string" || !text.trim()) {
    console.warn("[TranscriptionStorage] Skipping invalid item:", obj.id);
    return null;
  }

  return {
    id: String(obj.id || `recovered-${Date.now()}`),
    text: text,
    timestamp: typeof obj.timestamp === "number" ? obj.timestamp : Date.now(),
    mode: obj.mode === "edit" ? "edit" : "dictation",
  };
}

/**
 * Get all transcriptions from storage (most recent first)
 * Validates and filters out corrupted entries
 */
export function getTranscriptions(): TranscriptionItem[] {
  const raw = store.get("transcriptions", []);
  const validated = raw
    .map(validateItem)
    .filter((item): item is TranscriptionItem => item !== null);

  // If we filtered out items, save the cleaned data
  if (validated.length !== raw.length) {
    console.warn(
      `[TranscriptionStorage] Cleaned ${raw.length - validated.length} corrupted items`,
    );
    store.set("transcriptions", validated);
  }

  return validated;
}

/**
 * Save a new transcription to storage
 * Automatically prunes to MAX_ITEMS
 */
export function saveTranscription(
  item: Omit<TranscriptionItem, "id">,
): TranscriptionItem {
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
