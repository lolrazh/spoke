import { useState, useEffect, useCallback } from "react";

/**
 * Flat list of words/phrases the user wants Spoke to spell correctly. Mirrors
 * the shape of `useModels` (local state + persisting mutators), but there's no
 * install/status/active complexity — just a list the main process dedupes and
 * trims on write.
 */
export function useVocabulary() {
  const [dictionary, setDictionary] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const result = await window.electron?.getVocabularyDictionary?.();
        if (isMounted && Array.isArray(result?.dictionary)) {
          setDictionary(result.dictionary);
        }
      } catch {
        if (isMounted) setDictionary([]);
      } finally {
        if (isMounted) setLoaded(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const persist = useCallback(async (next: string[], previous: string[]) => {
    setDictionary(next);
    try {
      await window.electron?.setVocabularyDictionary?.(next);
    } catch {
      // Roll back the optimistic update if the write failed.
      setDictionary(previous);
    }
  }, []);

  const addWord = useCallback(
    async (word: string) => {
      const trimmed = word.trim();
      if (!trimmed) return;
      const previous = dictionary;
      if (
        previous.some((w) => w.toLowerCase() === trimmed.toLowerCase())
      ) {
        return;
      }
      await persist([...previous, trimmed], previous);
    },
    [dictionary, persist],
  );

  const removeWord = useCallback(
    async (word: string) => {
      const previous = dictionary;
      const next = previous.filter(
        (w) => w.toLowerCase() !== word.toLowerCase(),
      );
      if (next.length === previous.length) return;
      await persist(next, previous);
    },
    [dictionary, persist],
  );

  return { dictionary, addWord, removeWord, loaded };
}
