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

export function getLearnedWords(): { from: string; to: string; learnedAt: number }[] {
  const value = state.appPreferences.learnedWords;
  return Array.isArray(value) ? value.filter(word => word && typeof word.from === "string" &&
    typeof word.to === "string" && word.from.length <= 80 && word.to.length <= 80 &&
    typeof word.learnedAt === "number" && Number.isFinite(word.learnedAt)).slice(-256) : [];
}

export function getIgnoredLearnedWords(): string[] {
  const value = state.appPreferences.ignoredLearnedWords;
  return Array.isArray(value) ? value.filter(word => typeof word === "string").slice(-256) : [];
}

function commitDictionary(dictionary: string[], removed?: string): VocabularyMutationResult {
  const previous = state.appPreferences;
  const key = removed?.toLocaleLowerCase();
  state.appPreferences = { ...previous, vocabularyDictionary: dictionary };
  if (key) {
    state.appPreferences.learnedWords = getLearnedWords().filter(word => word.to.toLocaleLowerCase() !== key);
    state.appPreferences.ignoredLearnedWords = [...new Set([...getIgnoredLearnedWords(), key])].slice(-256);
  }
  if (saveAppPreferences(state.appPreferences)) {
    return { ok: true, dictionary: [...dictionary] };
  }

  state.appPreferences = previous;
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
  return commitDictionary(updated, current);
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
  return commitDictionary(updated, entry);
}
