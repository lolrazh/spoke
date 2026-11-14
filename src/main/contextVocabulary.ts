import { screenContextSession } from "./screenContextSession";
import { state } from "./windowState";
import { prepareTranscriptPostprocessing } from "./transcriptPostprocessing";
import { getVocabularyDictionary } from "./vocabularyService";

let saved: readonly string[] | undefined;
let terms: readonly string[] | undefined;
let merged: readonly string[] = [];

export function clearContextVocabulary(): void {
  saved = undefined;
  terms = undefined;
  merged = [];
}

/** Build the small temporary index while the user speaks, not during paste. */
export function contextDictionary(id?: string): readonly string[] {
  const raw = state.appPreferences.vocabularyDictionary;
  const dictionary = Array.isArray(raw) && raw.every(word => typeof word === "string") ? raw : getVocabularyDictionary();
  const context = screenContextSession.read(id);
  if (!context.length) return dictionary;
  if (saved !== dictionary || terms !== context) {
    saved = dictionary;
    terms = context;
    const seen = new Set(dictionary.map(word => word.toLocaleLowerCase()));
    merged = [...dictionary, ...context.filter(word => !seen.has(word.toLocaleLowerCase()))];
    prepareTranscriptPostprocessing(merged);
  }
  return merged;
}
