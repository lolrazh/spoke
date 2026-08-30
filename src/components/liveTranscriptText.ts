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
