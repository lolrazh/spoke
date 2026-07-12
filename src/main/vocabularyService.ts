import { saveAppPreferences } from "./preferences";
import { state } from "./windowState";

export type VocabularyMutationResult =
  | { ok: true; dictionary: string[] }
  | { ok: false; dictionary: string[]; error: string };

function sanitizeDictionary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const dictionary: string[] = [];
  for (const entry of value) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dictionary.push(trimmed);
  }
  return dictionary;
}

export function getVocabularyDictionary(): string[] {
  return sanitizeDictionary(state.appPreferences.vocabularyDictionary);
}

function commitDictionary(dictionary: string[]): VocabularyMutationResult {
  const previous = state.appPreferences.vocabularyDictionary;
  state.appPreferences.vocabularyDictionary = dictionary;
  if (saveAppPreferences(state.appPreferences)) {
    return { ok: true, dictionary: [...dictionary] };
  }

  state.appPreferences.vocabularyDictionary = previous;
  return {
    ok: false,
    dictionary: getVocabularyDictionary(),
    error: "Failed to save vocabulary preferences",
  };
}

export function addVocabularyEntry(value: unknown): VocabularyMutationResult {
  const dictionary = getVocabularyDictionary();
  const entry = typeof value === "string" ? value.trim() : "";
  if (!entry) return { ok: true, dictionary };
  if (dictionary.some((word) => word.toLowerCase() === entry.toLowerCase())) {
    return { ok: true, dictionary };
  }
  return commitDictionary([...dictionary, entry]);
}

export function updateVocabularyEntry(
  currentValue: unknown,
  nextValue: unknown,
): VocabularyMutationResult {
  const dictionary = getVocabularyDictionary();
  const current = typeof currentValue === "string" ? currentValue : "";
  const next = typeof nextValue === "string" ? nextValue.trim() : "";
  if (!current || !next) return { ok: true, dictionary };

  const index = dictionary.findIndex(
    (word) => word.toLowerCase() === current.toLowerCase(),
  );
  if (index === -1) return { ok: true, dictionary };
  if (
    dictionary.some(
      (word, candidateIndex) =>
        candidateIndex !== index && word.toLowerCase() === next.toLowerCase(),
    )
  ) {
    return { ok: true, dictionary };
  }

  const updated = [...dictionary];
  updated[index] = next;
  return commitDictionary(updated);
}

export function removeVocabularyEntry(
  value: unknown,
): VocabularyMutationResult {
  const dictionary = getVocabularyDictionary();
  const entry = typeof value === "string" ? value : "";
  const updated = dictionary.filter(
    (word) => word.toLowerCase() !== entry.toLowerCase(),
  );
  if (updated.length === dictionary.length) return { ok: true, dictionary };
  return commitDictionary(updated);
}
