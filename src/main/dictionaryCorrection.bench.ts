import { bench, describe } from "vitest";
import subtlexWords from "subtlex-word-frequencies";
import { correctTranscript } from "./dictionaryCorrection";

// correctTranscript logs every correction via console; under a benchmark that
// fires thousands of iterations the I/O would dominate and drown the results,
// so silence it to measure the algorithm rather than terminal throughput.
// eslint-disable-next-line no-console
console.info = () => {};

// Same skip-list correctTranscript uses internally, so generated adversarial
// tokens can be filtered to guarantee they are NOT common words.
const COMMON_WORDS = new Set(
  subtlexWords.slice(0, 30000).map((e) => e.word.toLowerCase()),
);

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONS = "bcdfghjklmnpqrstvwxz";
const VOW = "aeiou";

function pronounceable(rng: () => number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const set = i % 2 === 0 ? CONS : VOW;
    s += set[Math.floor(rng() * set.length)];
  }
  return s;
}

function genDictionary(count: number, seed: number, min = 5, max = 10): string[] {
  const rng = makeRng(seed);
  const words: string[] = [];
  while (words.length < count) {
    const len = min + Math.floor(rng() * (max - min + 1));
    words.push(pronounceable(rng, len));
  }
  return words;
}

function genTokens(count: number, seed: number, min: number, max: number): string[] {
  const rng = makeRng(seed);
  const tokens: string[] = [];
  while (tokens.length < count) {
    const len = min + Math.floor(rng() * (max - min + 1));
    const w = pronounceable(rng, len);
    if (w.length >= 4 && !COMMON_WORDS.has(w)) tokens.push(w);
  }
  return tokens;
}

// Case 1: single 3-char common word falls below MIN_TOKEN_LENGTH and returns
// immediately, so ~all cost is buildIndex — the per-call rebuild floor.
const MINIMAL_TRANSCRIPT = "the";
const dict10 = genDictionary(10, 1);
const dict100 = genDictionary(100, 2);
const dict1000 = genDictionary(1000, 3);
const dict10000 = genDictionary(10000, 4);

describe("index-rebuild floor (minimal transcript)", () => {
  bench("dictionary 10", () => {
    correctTranscript(MINIMAL_TRANSCRIPT, dict10);
  });
  bench("dictionary 100", () => {
    correctTranscript(MINIMAL_TRANSCRIPT, dict100);
  });
  bench("dictionary 1,000", () => {
    correctTranscript(MINIMAL_TRANSCRIPT, dict1000);
  });
  bench("dictionary 10,000", () => {
    correctTranscript(MINIMAL_TRANSCRIPT, dict10000);
  });
});

// Case 2 & 3: realistic prose where exact/phonetic paths actually fire
// (misspellings phonetically close to real dictionary entries).
const realisticDict = [
  "Sandheep", "RapidFuzz", "Kubernetes", "PostgreSQL", "Anthropic",
  "TypeScript", "Levenshtein", "metaphone", "Electron", "Whisper",
  "onnxruntime", "Redis", "GraphQL", "Tailwind", "Vite",
  "async", "webhook", "middleware", "namespace", "throughput",
];

const prose30 =
  "Yesterday Sandheap deployed the new service onto kubernetis and the whole " +
  "team watched the throughput climb steadily while the redis cache warmed up " +
  "and every request finished under budget without any noticeable errors today";

const prose100 =
  prose30 +
  " Later the middleware layer rejected a malformed webhook so the namespace " +
  "was reset and the async worker retried the failing job several times before " +
  "the postgres connection recovered and the metrics dashboard finally turned " +
  "green again just moments before the standup began this bright and quiet " +
  "morning while everyone sipped coffee and traded stories about the incident " +
  "that had kept the on call engineer awake for most of the previous long night";

const dict100realistic = [...realisticDict, ...genDictionary(80, 5)];

describe("realistic prose", () => {
  bench("20-word dict, 30-word transcript", () => {
    correctTranscript(prose30, realisticDict);
  });
  bench("100-word dict, 100-word transcript", () => {
    correctTranscript(prose100, dict100realistic);
  });
});

// Case 4 & 5: every token is long, non-common, and phonetically unrelated to
// the 10k-word dictionary, so each falls through to the Levenshtein scan over
// the whole dictionary — the true O(dict x transcript) corner. Different seeds
// + character construction keep dict and tokens from colliding phonetically.
const advDict = genDictionary(10000, 100, 5, 10);
const advTokens = genTokens(200, 200, 7, 9).join(" ");
const advDictLong = genDictionary(10000, 300, 15, 20);
const advTokensLong = genTokens(200, 400, 15, 20).join(" ");

describe("adversarial fallback (full Levenshtein scan)", () => {
  bench("10k dict, 200 short tokens", () => {
    correctTranscript(advTokens, advDict);
  });
  bench("10k dict, 200 long tokens (15-20 chars)", () => {
    correctTranscript(advTokensLong, advDictLong);
  });
});
