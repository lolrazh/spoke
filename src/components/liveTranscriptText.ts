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

  const segments = Array.from(wordSegmenter.segment(text));
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.isWordLike) {
      return {
        committed: text.slice(0, segment.index),
        tentative: text.slice(segment.index),
      };
    }
  }

  return { committed: "", tentative: text };
}
