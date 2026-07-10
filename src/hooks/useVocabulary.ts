import { useState, useEffect, useCallback, useRef } from "react";

// A word typed all-lowercase gets prettified to title case — vocabulary is
// overwhelmingly proper nouns. Any uppercase in the input means the casing is
// intentional (iPhone, RapidFuzz), so it's kept verbatim. Applied on add only;
// editing an entry stores exactly what was typed, so an edit is the escape
// hatch for a deliberately lowercase word.
export function titleCaseIfLower(entry: string): string {
  if (entry !== entry.toLowerCase()) return entry;
  return entry
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Flat list of words/phrases the user wants Spoke to spell correctly. Mirrors
 * the shape of `useModels` (local state + persisting mutators), but there's no
 * install/status/active complexity — just a list the main process dedupes and
 * trims on write.
 */
export function useVocabulary() {
  const [dictionary, setDictionary] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Mutators read the current list through this ref so their identities stay
  // stable — a memoized row that captured an old callback must still operate
  // on the latest list, not the one from when it last rendered.
  const dictionaryRef = useRef<string[]>([]);

  const apply = useCallback((next: string[]) => {
    dictionaryRef.current = next;
    setDictionary(next);
  }, []);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const result = await window.electron?.getVocabularyDictionary?.();
        if (isMounted && Array.isArray(result?.dictionary)) {
          apply(result.dictionary);
        }
      } catch {
        if (isMounted) apply([]);
      } finally {
        if (isMounted) setLoaded(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [apply]);

  const persist = useCallback(
    async (next: string[], previous: string[]) => {
      apply(next);
      try {
        const result = await window.electron?.setVocabularyDictionary?.(next);
        // Roll back the optimistic update if the write failed — the handler
        // reports failure as { ok: false } rather than throwing.
        if (result && !result.ok) apply(previous);
      } catch {
        apply(previous);
      }
    },
    [apply],
  );

  const addWord = useCallback(
    async (word: string) => {
      const trimmed = titleCaseIfLower(word.trim());
      if (!trimmed) return;
      const previous = dictionaryRef.current;
      if (
        previous.some((w) => w.toLowerCase() === trimmed.toLowerCase())
      ) {
        return;
      }
      await persist([...previous, trimmed], previous);
    },
    [persist],
  );

  const removeWord = useCallback(
    async (word: string) => {
      const previous = dictionaryRef.current;
      const next = previous.filter(
        (w) => w.toLowerCase() !== word.toLowerCase(),
      );
      if (next.length === previous.length) return;
      await persist(next, previous);
    },
    [persist],
  );

  const editWord = useCallback(
    async (oldWord: string, newWord: string) => {
      const trimmed = newWord.trim();
      // Editing to blank is a no-op, not a delete — that's what the trash is for.
      if (!trimmed) return;
      const previous = dictionaryRef.current;
      const index = previous.findIndex(
        (w) => w.toLowerCase() === oldWord.toLowerCase(),
      );
      if (index === -1) return;
      // Collides with a *different* entry — same duplicate-prevention as addWord.
      if (
        previous.some(
          (w, i) => i !== index && w.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return;
      }
      const next = [...previous];
      next[index] = trimmed;
      await persist(next, previous);
    },
    [persist],
  );

  return { dictionary, addWord, removeWord, editWord, loaded };
}
