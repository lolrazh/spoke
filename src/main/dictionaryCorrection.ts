import { doubleMetaphone } from "double-metaphone";
import { distance } from "fastest-levenshtein";
import subtlexWords from "subtlex-word-frequencies";
import { createLogger } from "../utils/logger";

const log = createLogger("DictCorrect");

const MIN_TOKEN_LENGTH = 4;
const COMMON_WORD_LIMIT = 30000;
const PHONETIC_THRESHOLD = 0.6;
const FUZZY_THRESHOLD = 0.85;
const PHRASE_FUZZY_THRESHOLD = 0.95;
const TIE_MARGIN = 0.05;
const MAX_PHRASE_TOKENS = 4;
const EMPTY_KEYS: readonly string[] = [];

// subtlex is pre-sorted by descending spoken-English frequency, so the head of
// the list is the highest-value skip-list of everyday words.
const COMMON_WORDS = new Set(
  subtlexWords
    .slice(0, COMMON_WORD_LIMIT)
    .map((entry) => entry.word.toLowerCase()),
);
// The correction path only needs the common-word skip list. Drop the imported
// frequency table so all entry objects can be reclaimed after initialization.
subtlexWords.length = 0;

const WORD_SPAN = /[\p{L}\p{N}']+/gu;
const PHRASE_GAP = /^[\p{Zs}\t&+/-]*$/u;

type PhraseKey = { entry: string; key: string };

type Index = {
  canonical: Map<string, string>;
  phonetic: Map<string, string[]>;
  phraseCanonical: Map<string, PhraseKey[]>;
  phrasePhonetic: Map<string, PhraseKey[]>;
  phraseKeys: PhraseKey[];
};

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function phraseKeys(entry: string): string[] {
  const keys = new Set<string>();
  const direct = normalizePhrase(entry);
  if (direct) keys.add(direct);
  if (entry.includes("&")) {
    const expanded = normalizePhrase(entry.replaceAll("&", " and "));
    if (expanded) keys.add(expanded);
  }
  return [...keys];
}

function isPhraseAwareEntry(entry: string): boolean {
  // Only entries that visibly express phrase/compound intent participate in
  // cross-token matching. A plain title-cased name such as "Karin" stays on
  // the single-token path, preventing ordinary prose like "car in" from being
  // merged merely because it has similar phonetics.
  return (
    /\s/u.test(entry) ||
    /[^\p{L}\p{N}']/u.test(entry) ||
    /\p{Lu}/u.test(entry.slice(1))
  );
}

function addPhraseBucket(
  index: Map<string, PhraseKey[]>,
  key: string,
  candidate: PhraseKey,
): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(candidate);
  else index.set(key, [candidate]);
}

function buildIndex(dictionary: readonly string[]): Index {
  const canonical = new Map<string, string>();
  const phonetic = new Map<string, string[]>();
  const phraseCanonical = new Map<string, PhraseKey[]>();
  const phrasePhonetic = new Map<string, PhraseKey[]>();
  const indexedPhraseKeys: PhraseKey[] = [];
  // The dictionary comes from a JSON prefs file that is loaded without shape
  // validation, so junk here must degrade to "no correction", not break
  // transcription. Expand one raw entry at a time so index construction does
  // not retain a second full word array while the maps are being built.
  if (Array.isArray(dictionary)) {
    for (const rawEntry of dictionary) {
      if (typeof rawEntry !== "string") continue;
      for (const word of rawEntry.split(/\s+/)) {
        if (!word) continue;
        const lower = word.toLowerCase();
        if (canonical.has(lower)) continue;
        canonical.set(lower, word);
        const [primary, secondary] = doubleMetaphone(word);
        if (primary) {
          const bucket = phonetic.get(primary);
          if (bucket) bucket.push(lower);
          else phonetic.set(primary, [lower]);
        }
        if (secondary && secondary !== primary) {
          const bucket = phonetic.get(secondary);
          if (bucket) bucket.push(lower);
          else phonetic.set(secondary, [lower]);
        }
      }
    }
  }

  if (Array.isArray(dictionary)) {
    const seen = new Set<string>();
    for (const rawEntry of dictionary) {
      if (typeof rawEntry !== "string") continue;
      const entry = rawEntry.trim();
      if (!entry || !isPhraseAwareEntry(entry)) continue;
      for (const key of phraseKeys(entry)) {
        const dedupeKey = `${entry.toLowerCase()}\0${key}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const candidate = { entry, key };
        indexedPhraseKeys.push(candidate);
        addPhraseBucket(phraseCanonical, key, candidate);
        const [primary, secondary] = doubleMetaphone(key);
        for (const code of new Set([primary, secondary])) {
          if (code) addPhraseBucket(phrasePhonetic, code, candidate);
        }
      }
    }
  }

  return {
    canonical,
    phonetic,
    phraseCanonical,
    phrasePhonetic,
    phraseKeys: indexedPhraseKeys,
  };
}

// The vocabulary service replaces the dictionary array on every mutation and
// the prefs loader parses a fresh one. Neither mutates it in place, so reference
// identity is a correct invalidation signal: one slot, rebuilt only when the
// dictionary actually changes.
let cachedDictionary: readonly string[] | null = null;
let cachedIndex: Index | null = null;

function getIndex(dictionary: readonly string[]): Index {
  if (dictionary !== cachedDictionary || cachedIndex === null) {
    cachedIndex = buildIndex(dictionary);
    cachedDictionary = dictionary;
  }
  return cachedIndex;
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - distance(a, b) / max;
}

type Scored = { key: string; sim: number };

function bestFrom(
  candidates: Iterable<string>,
  lower: string,
  threshold: number,
  additionalCandidates?: Iterable<string>,
): Scored[] {
  const minLength = Math.ceil(lower.length * threshold);
  const maxLength = Math.floor(lower.length / threshold);
  let best: Scored | null = null;
  let secondBest: Scored | null = null;

  const scan = (keys: Iterable<string>) => {
    for (const key of keys) {
      if (key.length < minLength || key.length > maxLength) continue;
      const sim = similarity(lower, key);
      if (sim < threshold) continue;
      const scored = { key, sim };
      if (!best || sim > best.sim) {
        secondBest = best;
        best = scored;
      } else if (!secondBest || sim > secondBest.sim) {
        secondBest = scored;
      }
    }
  };

  scan(candidates);
  if (additionalCandidates) scan(additionalCandidates);
  return best ? (secondBest ? [best, secondBest] : [best]) : [];
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

type PhraseMatch = {
  entry: string;
  sim: number;
  path: "exact-phrase" | "phonetic-phrase" | "fuzzy-phrase";
};

type ScoredPhrase = { candidate: PhraseKey; sim: number };

function scorePhraseCandidates(
  candidates: PhraseKey[],
  key: string,
  threshold: number,
): ScoredPhrase[] {
  const bestByEntry = new Map<string, ScoredPhrase>();
  for (const candidate of candidates) {
    const sim = similarity(key, candidate.key);
    if (sim < threshold) continue;
    const entryKey = candidate.entry.toLowerCase();
    const previous = bestByEntry.get(entryKey);
    if (!previous || sim > previous.sim) {
      bestByEntry.set(entryKey, { candidate, sim });
    }
  }

  // Callers only need the winner and runner-up to reject near ties. Avoid
  // materializing and sorting every unique entry in the candidate bucket.
  let best: ScoredPhrase | null = null;
  let secondBest: ScoredPhrase | null = null;
  for (const scored of bestByEntry.values()) {
    if (!best || scored.sim > best.sim) {
      secondBest = best;
      best = scored;
    } else if (!secondBest || scored.sim > secondBest.sim) {
      secondBest = scored;
    }
  }

  return best ? (secondBest ? [best, secondBest] : [best]) : [];
}

function unambiguousPhrase(
  scored: ScoredPhrase[],
  path: PhraseMatch["path"],
): PhraseMatch | null {
  if (scored.length === 0) return null;
  if (scored.length >= 2 && scored[0].sim - scored[1].sim < TIE_MARGIN) {
    return null;
  }
  return { entry: scored[0].candidate.entry, sim: scored[0].sim, path };
}

function findPhraseMatch(key: string, index: Index): PhraseMatch | null {
  const exact = index.phraseCanonical.get(key) ?? [];
  const exactMatch = unambiguousPhrase(
    scorePhraseCandidates(exact, key, 1),
    "exact-phrase",
  );
  if (exactMatch) return exactMatch;
  if (exact.length > 1) return null;

  const phoneticCandidates: PhraseKey[] = [];
  const [primary, secondary] = doubleMetaphone(key);
  for (const code of new Set([primary, secondary])) {
    if (!code) continue;
    const bucket = index.phrasePhonetic.get(code);
    if (bucket) phoneticCandidates.push(...bucket);
  }
  const scoredPhonetic = scorePhraseCandidates(
    phoneticCandidates,
    key,
    PHONETIC_THRESHOLD,
  );
  // A near-tie is a terminal ambiguity, not a signal to try another matching
  // path. Falling through could let the stricter fuzzy threshold discard the
  // runner-up and incorrectly turn the same ambiguous set into a winner.
  if (scoredPhonetic.length > 0) {
    return unambiguousPhrase(scoredPhonetic, "phonetic-phrase");
  }

  return unambiguousPhrase(
    scorePhraseCandidates(index.phraseKeys, key, PHRASE_FUZZY_THRESHOLD),
    "fuzzy-phrase",
  );
}

function findMatch(stem: string, lower: string, index: Index): Match | null {
  const [primary, secondary] = doubleMetaphone(stem);
  const primaryCandidates = primary
    ? index.phonetic.get(primary)
    : undefined;
  const secondaryCandidates =
    secondary && secondary !== primary
      ? index.phonetic.get(secondary)
      : undefined;

  let scored = bestFrom(
    primaryCandidates ?? EMPTY_KEYS,
    lower,
    PHONETIC_THRESHOLD,
    secondaryCandidates,
  );
  let path: Match["path"] = "phonetic";
  if (scored.length === 0) {
    // Canonical keys are unique and already lowercase, so the fuzzy fallback
    // can iterate them directly without another array or de-duplication Set.
    scored = bestFrom(index.canonical.keys(), lower, FUZZY_THRESHOLD);
    path = "fuzzy";
  }
  if (scored.length === 0) return null;
  // Fail safe on ambiguity: two near-equal candidates mean we can't be
  // confident which spelling was intended, so leave the token untouched.
  if (scored.length >= 2 && scored[0].sim - scored[1].sim < TIE_MARGIN) {
    return null;
  }
  const word = index.canonical.get(scored[0].key);
  if (word === undefined) return null;
  return { word, sim: scored[0].sim, path };
}

export function correctTranscript(
  text: string,
  dictionary: readonly string[],
): string {
  if (dictionary.length === 0) return text;
  const index = getIndex(dictionary);
  const tokens = [...text.matchAll(WORD_SPAN)];
  if (tokens.length === 0) return text;

  const correctToken = (token: string): string => {
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
  };

  let output = "";
  let cursor = 0;
  let tokenIndex = 0;
  while (tokenIndex < tokens.length) {
    const first = tokens[tokenIndex];
    const firstStart = first.index;
    let phrase:
      | { count: number; end: number; match: PhraseMatch; source: string }
      | undefined;

    const maxCount = index.phraseKeys.length
      ? Math.min(MAX_PHRASE_TOKENS, tokens.length - tokenIndex)
      : 1;
    for (let count = maxCount; count >= 2; count--) {
      const span = tokens.slice(tokenIndex, tokenIndex + count);
      let gapsAllowed = true;
      for (let offset = 1; offset < span.length; offset++) {
        const previous = span[offset - 1];
        const previousEnd = previous.index + previous[0].length;
        const gap = text.slice(previousEnd, span[offset].index);
        if (!PHRASE_GAP.test(gap)) {
          gapsAllowed = false;
          break;
        }
      }
      if (!gapsAllowed) continue;

      const source = text.slice(
        span[0].index,
        span[span.length - 1].index + span[span.length - 1][0].length,
      );
      const key = normalizePhrase(source);
      if (key.length < MIN_TOKEN_LENGTH) continue;
      const match = findPhraseMatch(key, index);
      if (!match) continue;
      phrase = {
        count,
        end: span[span.length - 1].index + span[span.length - 1][0].length,
        match,
        source,
      };
      break;
    }

    output += text.slice(cursor, firstStart);
    if (phrase) {
      const replacement = matchCasing(phrase.match.entry, first[0]);
      log.info(
        `"${phrase.source}" -> "${replacement}" (${phrase.match.path}, similarity=${phrase.match.sim.toFixed(2)})`,
      );
      output += replacement;
      cursor = phrase.end;
      tokenIndex += phrase.count;
    } else {
      output += correctToken(first[0]);
      cursor = firstStart + first[0].length;
      tokenIndex++;
    }
  }

  return output + text.slice(cursor);
}
