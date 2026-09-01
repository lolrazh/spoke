/**
 * Conservative, deterministic cleanup for Parakeet transcripts.
 *
 * Parakeet is fast, but it can return spoken-form numbers, hesitation fillers,
 * and lowercase sentence starts. Keep this module deliberately narrow: every
 * transformation must have one clear written form. Vocabulary-specific
 * spelling remains the responsibility of dictionaryCorrection.
 */

const FILLER_PATTERN = /\b(?:um+|uh+|erm+|ah+)\b/giu;
const PROTECTED_FILLER_CONTEXT = new Set([
  "called",
  "literal",
  "means",
  "say",
  "says",
  "said",
  "spell",
  "spelled",
  "term",
  "token",
  "type",
  "use",
  "variable",
  "word",
  "write",
]);

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORDS = [
  ...Object.keys(SMALL_NUMBERS),
  ...Object.keys(TENS),
  "hundred",
  "thousand",
  "and",
];
const NUMBER_TOKEN = `(?:${NUMBER_WORDS.join("|")})`;
const CLOCK_WORDS_PATTERN = new RegExp(
  `\\b(${NUMBER_TOKEN}(?:[ -]+${NUMBER_TOKEN}){0,3})\\s+([ap])\\.?\\s*m\\.?\\b`,
  "giu",
);
const CLOCK_DIGITS_PATTERN =
  /\b(\d{1,2})(?:(?::|\s+)(\d{2}))?\s*([ap])\.?\s*m\.?\b/giu;
const STORAGE_PATTERN = new RegExp(
  `\\b(${NUMBER_TOKEN}(?:[ -]+${NUMBER_TOKEN}){0,5})\\s+` +
    `(bytes?|kilobytes?|megabytes?|gigabytes?|terabytes?|kb|mb|gb|tb|percent)\\b`,
  "giu",
);
const VERSION_PATTERN = new RegExp(
  `\\b(version|v)\\s+(${NUMBER_TOKEN})\\s+point\\s+(${NUMBER_TOKEN})\\b`,
  "giu",
);

const STORAGE_UNITS: Record<string, string> = {
  byte: "B",
  bytes: "B",
  kilobyte: "KB",
  kilobytes: "KB",
  megabyte: "MB",
  megabytes: "MB",
  gigabyte: "GB",
  gigabytes: "GB",
  terabyte: "TB",
  terabytes: "TB",
  kb: "KB",
  mb: "MB",
  gb: "GB",
  tb: "TB",
};

function previousWord(text: string, index: number): string {
  return text.slice(0, index).match(/([\p{L}\p{N}]+)\W*$/u)?.[1] ?? "";
}

function nextWord(text: string, index: number): string {
  return text.slice(index).match(/^\W*([\p{L}\p{N}]+)/u)?.[1] ?? "";
}

function isQuotedOrHyphenated(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  return (
    before === "-" ||
    after === "-" ||
    /["'“‘]/u.test(before) ||
    /["'”’]/u.test(after)
  );
}

function removeHesitationFillers(text: string): string {
  const withoutFillers = text.replace(
    FILLER_PATTERN,
    (token: string, offset: number, source: string) => {
      const end = offset + token.length;
      if (token === token.toUpperCase()) return token;
      if (isQuotedOrHyphenated(source, offset, end)) return token;

      const before = previousWord(source, offset).toLowerCase();
      const after = nextWord(source, end).toLowerCase();
      if (
        PROTECTED_FILLER_CONTEXT.has(before) ||
        PROTECTED_FILLER_CONTEXT.has(after)
      ) {
        return token;
      }
      return "";
    },
  );

  return withoutFillers
    .replace(/,\s*,/gu, ",")
    .replace(/(^|\n)\s*[,;:]\s*/gu, "$1")
    .replace(/[ \t]+([,.;!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function numberTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[\s-]+/u)
    .filter(Boolean);
}

function parseCardinal(phrase: string): number | null {
  const tokens = numberTokens(phrase);
  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const token of tokens) {
    if (token === "and") continue;
    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      sawNumber = true;
      continue;
    }
    if (token in TENS) {
      current += TENS[token];
      sawNumber = true;
      continue;
    }
    if (token === "hundred") {
      if (current === 0) return null;
      current *= 100;
      continue;
    }
    if (token === "thousand") {
      if (current === 0) return null;
      total += current * 1000;
      current = 0;
      continue;
    }
    return null;
  }
  return sawNumber ? total + current : null;
}

function parseSpokenClock(phrase: string): { hour: number; minute: number | null } | null {
  const tokens = numberTokens(phrase).filter((token) => token !== "and");
  if (tokens.length === 0) return null;

  const hour = SMALL_NUMBERS[tokens[0]];
  if (hour === undefined || hour < 1 || hour > 12) return null;
  if (tokens.length === 1) return { hour, minute: null };

  const minuteTokens = tokens.slice(1);
  const minute =
    minuteTokens[0] === "oh" || minuteTokens[0] === "zero"
      ? parseCardinal(minuteTokens.slice(1).join(" "))
      : parseCardinal(minuteTokens.join(" "));
  if (minute === null || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeTimes(text: string): string {
  const wordsNormalized = text.replace(
    CLOCK_WORDS_PATTERN,
    (match: string, phrase: string, meridiem: string) => {
      const time = parseSpokenClock(phrase);
      if (!time) return match;
      const minutes =
        time.minute === null ? "" : `:${String(time.minute).padStart(2, "0")}`;
      return `${time.hour}${minutes} ${meridiem.toUpperCase()}M`;
    },
  );

  return wordsNormalized.replace(
    CLOCK_DIGITS_PATTERN,
    (match: string, hourText: string, minuteText: string | undefined, meridiem: string) => {
      const hour = Number(hourText);
      const minute = minuteText === undefined ? null : Number(minuteText);
      if (hour < 1 || hour > 12 || (minute !== null && minute > 59)) {
        return match;
      }
      return `${hour}${minute === null ? "" : `:${String(minute).padStart(2, "0")}`} ${meridiem.toUpperCase()}M`;
    },
  );
}

function normalizeMeasuredNumbers(text: string): string {
  const storageNormalized = text.replace(
    STORAGE_PATTERN,
    (match: string, phrase: string, rawUnit: string) => {
      const value = parseCardinal(phrase);
      if (value === null) return match;
      const unit = rawUnit.toLowerCase();
      if (unit === "percent") return `${value}%`;
      return `${value} ${STORAGE_UNITS[unit]}`;
    },
  );

  return storageNormalized.replace(
    VERSION_PATTERN,
    (match: string, prefix: string, majorText: string, minorText: string) => {
      const major = parseCardinal(majorText);
      const minor = parseCardinal(minorText);
      if (major === null || minor === null || major > 99 || minor > 99) {
        return match;
      }
      return `${prefix.toLowerCase() === "v" ? "v" : "version"} ${major}.${minor}`;
    },
  );
}

function normalizePunctuationSpacing(text: string): string {
  return text
    .replace(/[ \t]+([,.;!?])/gu, "$1")
    .replace(/([,;!?])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/:(?=\p{L})/gu, ": ")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function restoreSentenceCasing(text: string): string {
  let capitalizeNext = true;
  const characters = [...text];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (/\p{L}/u.test(character)) {
      if (capitalizeNext) characters[index] = character.toLocaleUpperCase();
      capitalizeNext = false;
      continue;
    }
    if (/[.!?\n]/u.test(character)) capitalizeNext = true;
  }
  return characters.join("").replace(/\bi\b/gu, "I");
}

export function normalizeParakeetTranscript(text: string): string {
  if (!text.trim()) return text;
  return restoreSentenceCasing(
    normalizePunctuationSpacing(
      normalizeMeasuredNumbers(normalizeTimes(removeHesitationFillers(text))),
    ),
  );
}
