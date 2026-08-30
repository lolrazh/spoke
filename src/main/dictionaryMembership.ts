/**
 * Lightweight exact membership checks for the user vocabulary.
 *
 * Keep this separate from dictionaryCorrection: that module also loads the
 * large frequency list used by fuzzy correction, while insertion formatting
 * only needs to know whether a token is explicitly in the user's dictionary.
 */
export function isDictionaryWord(
  word: string,
  dictionary: readonly string[],
): boolean {
  if (!Array.isArray(dictionary) || dictionary.length === 0) return false;

  const lowerWord = word.toLowerCase();
  for (const entry of dictionary) {
    if (typeof entry !== "string") continue;
    for (const part of entry.split(/\s+/)) {
      if (part && part.toLowerCase() === lowerWord) return true;
    }
  }
  return false;
}
