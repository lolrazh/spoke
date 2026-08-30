let wordSegmenter: Intl.Segmenter | null = null;
const SIMPLE_ASCII_LIVE_TEXT_RE = /^[\t\n\r\x20-\x26\x28-\x2c\x2e-\x2f\x3a-\x7f]*$/;
const MAX_SEGMENTER_SUFFIX_LENGTH = 512;
export const MAX_LIVE_TRANSCRIPT_DOM_CHARS = 2048;

export type LiveTranscriptText = {
  committed: string;
  tentative: string;
};

/**
 * The live viewport shows only the newest ten lines. Keep its DOM and layout
 * measurement bounded while the full hypothesis remains in the transcription
 * pipeline for final insertion and history.
 */
export function boundLiveTranscriptText(text: string): string {
  if (text.length <= MAX_LIVE_TRANSCRIPT_DOM_CHARS) return text;

  let start = text.length - MAX_LIVE_TRANSCRIPT_DOM_CHARS;
  if (isLowSurrogate(text.charCodeAt(start))) start += 1;

  while (start < text.length && !isLiveWhitespace(text.charCodeAt(start))) {
    start += 1;
  }
  while (start < text.length && isLiveWhitespace(text.charCodeAt(start))) {
    start += 1;
  }

  return text.slice(start);
}

/**
 * Keep completed words in a stable text run and isolate only the word that is
 * still being formed. This prevents browser shaping changes at the live edge
 * from repainting the full transcript on every streaming update.
 */
export function splitLiveTranscriptText(
  text: string,
  final: boolean,
): LiveTranscriptText {
  if (!text || final) return { committed: text, tentative: "" };

  const simpleAsciiResult = splitSimpleAsciiText(text);
  if (simpleAsciiResult) return simpleAsciiResult;

  let tentativeStart: number | null = null;
  const segmenter =
    (wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" }));
  const suffixStart = findSegmenterSuffixStart(text);
  const segmentText = text.slice(suffixStart);
  for (const segment of segmenter.segment(segmentText)) {
    if (segment.isWordLike) tentativeStart = suffixStart + segment.index;
  }

  if (tentativeStart !== null) {
    return {
      committed: text.slice(0, tentativeStart),
      tentative: text.slice(tentativeStart),
    };
  }

  return { committed: "", tentative: text };
}

/**
 * Only the final word-like segment affects the live split. Keep a little
 * context before the tail so the segmenter can distinguish punctuation and
 * contractions, but do not rescan a long transcript on every partial update.
 * Starting at whitespace preserves a real word boundary. If there is no such
 * boundary in the suffix, keep the full-text fallback for long unbroken tokens.
 */
function findSegmenterSuffixStart(text: string): number {
  const suffixStart = Math.max(0, text.length - MAX_SEGMENTER_SUFFIX_LENGTH);
  if (suffixStart === 0) return 0;

  const earliestBoundary = Math.max(0, suffixStart - MAX_SEGMENTER_SUFFIX_LENGTH);
  for (let index = suffixStart; index >= earliestBoundary; index -= 1) {
    if (isAsciiWhitespace(text.charCodeAt(index))) return index;
  }
  return 0;
}

/**
 * English dictation is the common case. Avoid the full Unicode segmenter when
 * the final word is a plain ASCII token after whitespace. Apostrophes, hyphens,
 * digits, and non-ASCII text stay on the Unicode path because they can change
 * word-boundary rules.
 */
function splitSimpleAsciiText(text: string): LiveTranscriptText | null {
  if (!SIMPLE_ASCII_LIVE_TEXT_RE.test(text)) return null;

  let tentativeEnd = text.length - 1;
  while (tentativeEnd >= 0 && !isAsciiLetter(text.charCodeAt(tentativeEnd))) {
    tentativeEnd -= 1;
  }
  if (tentativeEnd < 0) return { committed: "", tentative: text };

  let tentativeStart = tentativeEnd;
  while (
    tentativeStart > 0 &&
    isAsciiLetter(text.charCodeAt(tentativeStart - 1))
  ) {
    tentativeStart -= 1;
  }
  if (
    tentativeStart === 0 ||
    !isAsciiWhitespace(text.charCodeAt(tentativeStart - 1))
  ) {
    return null;
  }

  return {
    committed: text.slice(0, tentativeStart),
    tentative: text.slice(tentativeStart),
  };
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

function isLiveWhitespace(code: number): boolean {
  return (
    isAsciiWhitespace(code) ||
    code === 0x85 ||
    code === 0xa0 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
