/**
 * Conservative, deterministic cleanup for Parakeet transcripts.
 *
 * Parakeet is fast, but it can return spoken-form numbers, hesitation fillers,
 * and lowercase sentence starts. Keep this module deliberately narrow: every
 * transformation must have one clear written form. Vocabulary-specific
 * spelling remains the responsibility of dictionaryCorrection.
 */

import { normalizeSpokenNumbers, normalizeNumberUnits } from "./spokenNumbers";

const FILLER_PATTERN = /\b(?:um+|uh+|erm+|ah+)\b/giu;
const FILLER_MARKER = "\u0000";
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

function previousWord(text: string, index: number): string {
  return text.slice(0, index).match(/([\p{L}\p{N}]+)\W*$/u)?.[1] ?? "";
}

function nextWord(text: string, index: number): string {
  return text.slice(index).match(/^\W*([\p{L}\p{N}]+)/u)?.[1] ?? "";
}

function isQuotedOrHyphenated(
  text: string,
  start: number,
  end: number,
): boolean {
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
  const withMarkers = text.replace(
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
      return FILLER_MARKER;
    },
  );

  return (
    withMarkers
      // A filler can leave its comma beside the sentence-ending punctuation.
      // Remove only punctuation attached to a filler, not valid punctuation such
      // as the comma after an abbreviation.
      .replace(new RegExp(`([.!?])\\s*${FILLER_MARKER}\\s*[,;:]+`, "gu"), "$1")
      .replace(
        new RegExp(`[,;:]\\s*${FILLER_MARKER}\\s*[,;:]?\\s*([.!?])`, "gu"),
        "$1",
      )
      .replace(new RegExp(FILLER_MARKER, "gu"), "")
      .replace(/,\s*,/gu, ",")
      .replace(/(^|\n)\s*[,;:]\s*/gu, "$1")
      .replace(/[ \t]+([,.;!?])/gu, "$1")
      .replace(/[ \t]{2,}/gu, " ")
      .trim()
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
  return text
    .replace(
      /(^|[.!?][ \t]+|\n[ \t]*)(["'“‘([]*)(\p{Ll})/gu,
      (_match, boundary: string, opening: string, letter: string) =>
        boundary + opening + letter.toLocaleUpperCase(),
    )
    .replace(/\bi\b/gu, "I");
}

export function normalizeParakeetTranscript(text: string): string {
  if (!text.trim()) return text;
  return restoreSentenceCasing(
    normalizePunctuationSpacing(
      normalizeNumberUnits(
        normalizeSpokenNumbers(removeHesitationFillers(text)),
      ),
    ),
  );
}
