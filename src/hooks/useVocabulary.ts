import { useState, useEffect, useCallback } from "react";

/**
 * Renderer projection of the main process's vocabulary service. Mutations are
 * atomic commands; the returned canonical dictionary is the only state applied
 * locally, so validation and persistence rules stay out of the renderer.
 */
export function useVocabulary() {
  const [dictionary, setDictionary] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const apply = useCallback((next: string[]) => {
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

  const addWord = useCallback(
    async (word: string) => {
      const result = await window.electron?.addVocabularyEntry?.(word);
      if (result?.ok) apply(result.dictionary);
    },
    [apply],
  );

  const removeWord = useCallback(
    async (word: string) => {
      const result = await window.electron?.removeVocabularyEntry?.(word);
      if (result?.ok) apply(result.dictionary);
    },
    [apply],
  );

  const editWord = useCallback(
    async (oldWord: string, newWord: string) => {
      const result = await window.electron?.updateVocabularyEntry?.(
        oldWord,
        newWord,
      );
      if (result?.ok) apply(result.dictionary);
    },
    [apply],
  );

  return { dictionary, addWord, removeWord, editWord, loaded };
}
