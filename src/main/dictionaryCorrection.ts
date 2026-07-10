import { doubleMetaphone } from "double-metaphone";
import { distance } from "fastest-levenshtein";
import subtlexWords from "subtlex-word-frequencies";
import { createLogger } from "../utils/logger";

const log = createLogger("DictCorrect");

const MIN_TOKEN_LENGTH = 4;
const COMMON_WORD_LIMIT = 30000;
const PHONETIC_THRESHOLD = 0.6;
const FUZZY_THRESHOLD = 0.85;
const TIE_MARGIN = 0.05;

// subtlex is pre-sorted by descending spoken-English frequency, so the head of
// the list is the highest-value skip-list of everyday words.
const COMMON_WORDS = new Set(
  subtlexWords
    .slice(0, COMMON_WORD_LIMIT)
    .map((entry) => entry.word.toLowerCase()),
);

const WORD_SPAN = /[\p{L}\p{N}']+/gu;

function expandEntries(dictionary: readonly string[]): string[] {
  const words: string[] = [];
  for (const entry of dictionary) {
    for (const part of entry.split(/\s+/)) {
      if (part) words.push(part);
    }
  }
  return words;
}

type Index = {
  canonical: Map<string, string>;
  phonetic: Map<string, string[]>;
  words: string[];
};

function buildIndex(dictionary: readonly string[]): Index {
  const canonical = new Map<string, string>();
  const phonetic = new Map<string, string[]>();
  for (const word of expandEntries(dictionary)) {
    const lower = word.toLowerCase();
    if (canonical.has(lower)) continue;
    canonical.set(lower, word);
    const [primary, secondary] = doubleMetaphone(word);
    for (const code of [primary, secondary]) {
      if (!code) continue;
      const bucket = phonetic.get(code);
      if (bucket) bucket.push(word);
      else phonetic.set(code, [word]);
    }
  }
  return { canonical, phonetic, words: [...canonical.values()] };
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - distance(a, b) / max;
}

type Scored = { word: string; sim: number };

function bestFrom(candidates: string[], lower: string, threshold: number): Scored[] {
  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const word of candidates) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sim = similarity(lower, key);
    if (sim >= threshold) scored.push({ word, sim });
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored;
}

// An entry with intentional casing (Sandheep, iPhone) always wins. An
// all-lowercase entry carries no casing signal, so inherit the token's leading
// capital rather than downcasing a sentence start or a proper noun the model
// already got right.
function matchCasing(entry: string, stem: string): string {
  if (entry !== entry.toLowerCase()) return entry;
  if (/^\p{Lu}/u.test(stem)) {
    return entry.charAt(0).toUpperCase() + entry.slice(1);
  }
  return entry;
}

type Match = { word: string; sim: number; path: "phonetic" | "fuzzy" };

function findMatch(stem: string, lower: string, index: Index): Match | null {
  const [primary, secondary] = doubleMetaphone(stem);
  const candidates: string[] = [];
  for (const code of [primary, secondary]) {
    if (!code) continue;
    const bucket = index.phonetic.get(code);
    if (bucket) candidates.push(...bucket);
  }

  let scored = bestFrom(candidates, lower, PHONETIC_THRESHOLD);
  let path: Match["path"] = "phonetic";
  if (scored.length === 0) {
    scored = bestFrom(index.words, lower, FUZZY_THRESHOLD);
    path = "fuzzy";
  }
  if (scored.length === 0) return null;
  // Fail safe on ambiguity: two near-equal candidates mean we can't be
  // confident which spelling was intended, so leave the token untouched.
  if (scored.length >= 2 && scored[0].sim - scored[1].sim < TIE_MARGIN) {
    return null;
  }
  return { word: scored[0].word, sim: scored[0].sim, path };
}

export function correctTranscript(
  text: string,
  dictionary: readonly string[],
): string {
  if (dictionary.length === 0) return text;
  const index = buildIndex(dictionary);

  return text.replace(WORD_SPAN, (token) => {
    // Strip a trailing possessive before matching so "Sandheap's" is compared
    // as "Sandheap", then reattach the possessive unchanged after correcting.
    let stem = token;
    let possessive = "";
    if (/'s$/i.test(stem)) {
      possessive = stem.slice(-2);
      stem = stem.slice(0, -2);
    } else if (stem.endsWith("'")) {
      possessive = stem.slice(-1);
      stem = stem.slice(0, -1);
    }

    if (stem.length < MIN_TOKEN_LENGTH) return token;
    const lower = stem.toLowerCase();
    if (COMMON_WORDS.has(lower)) return token;

    const exact = index.canonical.get(lower);
    if (exact !== undefined) {
      const cased = matchCasing(exact, stem);
      if (cased !== stem) {
        log.info(`"${stem}" -> "${cased}" (exact)`);
      }
      return `${cased}${possessive}`;
    }

    const match = findMatch(stem, lower, index);
    if (!match) return token;
    const cased = matchCasing(match.word, stem);
    log.info(
      `"${stem}" -> "${cased}" (${match.path}, similarity=${match.sim.toFixed(2)})`,
    );
    return `${cased}${possessive}`;
  });
}

export function isDictionaryWord(
  word: string,
  dictionary: readonly string[],
): boolean {
  const target = word.toLowerCase();
  return expandEntries(dictionary).some((part) => part.toLowerCase() === target);
}
