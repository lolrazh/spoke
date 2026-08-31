export const MAX_LIVE_TRANSCRIPT_DOM_CHARS = 2048;

/**
 * Keep the transient live hypothesis bounded to the text the UI can display.
 * Preserve a word boundary when the suffix starts in the middle of a word.
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
