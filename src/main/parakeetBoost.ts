/** Trial controls. Screen extraction remains unchanged; these are decoder hints. */
export interface ParakeetBoost {
  terms: readonly string[];
  strength: number;
}

// Every boosted term competes with the audio, so the decoder gets only the
// first few current-window terms. The native extractor lists mixed-case and
// numbered identifiers first, then tagged names, then plain acronyms. Saved
// dictionary words and later screen terms use text replacement instead.
// Both limits come from the control sweep in
// docs/parakeet-word-boosting-2026-11-14.md. The short term M4 alone replaced
// an unrelated sentence. Without short terms, four terms changed at most one
// control word, and one six-term list replaced that sentence again.
export const MAX_BOOST_TERMS = 4;
export const MIN_BOOST_CHARACTERS = 5;

export function parakeetBoostEnabled(): boolean {
  return process.env.SPOKE_PARAKEET_WORD_BOOST === "1";
}

export function buildParakeetBoost(
  screenTerms: readonly string[],
  savedTerms: readonly string[],
): ParakeetBoost {
  const canonical = new Map(savedTerms.map(term => [term.toLowerCase(), term]));
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of screenTerms) {
    if (terms.length === MAX_BOOST_TERMS) break;
    // A saved spelling wins for a term that is also visible.
    const term = (canonical.get(raw.toLowerCase()) ?? raw).trim();
    const key = term.toLowerCase();
    if (seen.has(key) || term.length < MIN_BOOST_CHARACTERS || term.length > 80 ||
        !/\p{L}/u.test(term) || !/^[\p{L}\p{M}\p{N} ._'’+-]+$/u.test(term)) continue;
    seen.add(key);
    terms.push(term);
  }
  return { terms, strength: 4 };
}

/**
 * The correction dictionary must still hold every boosted term, so its casing
 * can be restored even when a later capture replaced the window's terms.
 * Returns the same array when nothing is missing, to keep its cached index.
 */
export function withBoostedTerms(
  dictionary: readonly string[],
  boosted: readonly string[],
): readonly string[] {
  const known = new Set(dictionary.map(term => term.toLowerCase()));
  const missing = boosted.filter(term => !known.has(term.toLowerCase()));
  return missing.length ? [...dictionary, ...missing] : dictionary;
}
