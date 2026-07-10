import Store from "electron-store";
import {
  MAX_TRANSCRIPTION_HISTORY,
  type TranscriptionItem,
} from "../types/shared";

interface TranscriptionStoreSchema {
  transcriptions: TranscriptionItem[];
}

const store = new Store<TranscriptionStoreSchema>({
  name: "transcription-history",
  defaults: {
    transcriptions: [],
  },
});

// Cleaned, capped mirror of the persisted list. Validated once on first access
// and kept in sync on every write, so reads never re-validate the whole file.
let cache: TranscriptionItem[] | null = null;

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
 * Load, validate, cap, and cache the persisted list on first access.
 * Persists once if validation dropped corrupted items or the stored file
 * exceeded the current cap (migration for users with pre-cap history files).
 */
function ensureCache(): TranscriptionItem[] {
  if (cache) return cache;

  const raw = store.get("transcriptions", []);
  const validated = raw
    .map(validateItem)
    .filter((item): item is TranscriptionItem => item !== null);

  const droppedCount = raw.length - validated.length;
  if (droppedCount > 0) {
    console.warn(
      `[TranscriptionStorage] Cleaned ${droppedCount} corrupted items`,
    );
  }

  // Truncate legacy oversized history down to the current cap.
  const cleaned =
    validated.length > MAX_TRANSCRIPTION_HISTORY
      ? validated.slice(0, MAX_TRANSCRIPTION_HISTORY)
      : validated;

  // Persist once if either cleaning or capping changed the list.
  if (cleaned.length !== raw.length) {
    store.set("transcriptions", cleaned);
  }

  cache = cleaned;
  return cache;
}

/**
 * Get all transcriptions from storage (most recent first)
 * Served from the validated in-memory cache.
 */
export function getTranscriptions(): TranscriptionItem[] {
  return ensureCache();
}

/**
 * Save a new transcription to storage
 * Automatically prunes to MAX_TRANSCRIPTION_HISTORY
 */
export function saveTranscription(
  item: Omit<TranscriptionItem, "id">,
): TranscriptionItem {
  const transcriptions = ensureCache();

  const newItem: TranscriptionItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };

  // Add new item at the beginning (most recent first)
  transcriptions.unshift(newItem);

  // Prune to max items
  if (transcriptions.length > MAX_TRANSCRIPTION_HISTORY) {
    transcriptions.length = MAX_TRANSCRIPTION_HISTORY;
  }

  store.set("transcriptions", transcriptions);

  return newItem;
}

/**
 * Delete a transcription by ID
 */
export function deleteTranscription(id: string): boolean {
  const transcriptions = ensureCache();
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
  cache = [];
  store.set("transcriptions", []);
}
