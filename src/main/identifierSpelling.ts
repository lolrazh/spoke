const DIGIT_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/** A comparison key only. Never rewrites ordinary prose or guesses homophones. */
export function identifierSpellingKey(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/gu,
      word => DIGIT_WORDS[word])
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Fuzzy spelling must not insert, delete, or change a number. */
export function sameDigits(a: string, b: string): boolean {
  return (a.match(/\p{N}/gu) ?? []).join("") === (b.match(/\p{N}/gu) ?? []).join("");
}
