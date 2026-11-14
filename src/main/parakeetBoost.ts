/** Trial controls. Screen extraction remains unchanged; these are decoder hints. */
export interface ParakeetBoost {
  terms: readonly string[];
  strength: number;
}

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
  // Keep current-window names ahead of a large saved dictionary. This is the
  // existing 24-term screen budget, not a claim that 24 boosts are always safe.
  for (const raw of [...screenTerms, ...savedTerms]) {
    const term = (canonical.get(raw.toLowerCase()) ?? raw).trim();
    const key = term.toLowerCase();
    if (seen.has(key) || term.length < 2 || term.length > 80 ||
        !/\p{L}/u.test(term) || !/^[\p{L}\p{M}\p{N} ._'’+-]+$/u.test(term)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === 24) break;
  }
  return { terms, strength: 4 };
}
