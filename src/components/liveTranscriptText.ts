const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

export type LiveTranscriptText = {
  committed: string;
  tentative: string;
};

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
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.isWordLike) tentativeStart = segment.index;
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
 * English dictation is the common case. Avoid the full Unicode segmenter when
 * the final word is a plain ASCII token after whitespace. Apostrophes, hyphens,
 * digits, and non-ASCII text stay on the Unicode path because they can change
 * word-boundary rules.
 */
function splitSimpleAsciiText(text: string): LiveTranscriptText | null {
  let hasLetter = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isAsciiLetter(code)) {
      hasLetter = true;
      continue;
    }
    if (
      code > 0x7f ||
      code === 0x27 ||
      code === 0x2d ||
      (code >= 0x30 && code <= 0x39)
    ) {
      return null;
    }
  }
  if (!hasLetter) return null;

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
