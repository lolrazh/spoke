export const LIVE_TRANSCRIPT_CHROME_WIDTH = 82;

export type LiveTranscriptLayout = {
  pillWidth: number;
  viewportWidth: number;
  railOffsetX: number;
  overflowing: boolean;
};

/**
 * Derive the pill target from measured text instead of character counts.
 *
 * `maxTextWidth` makes expansion monotonic within one dictation. The current
 * width remains separate so a corrected final result cannot scroll past its
 * actual trailing edge.
 */
export function calculateLiveTranscriptLayout({
  currentTextWidth,
  maxTextWidth,
  baseWidth,
  maxWidth,
}: {
  currentTextWidth: number;
  maxTextWidth: number;
  baseWidth: number;
  maxWidth: number;
}): LiveTranscriptLayout {
  const safeBaseWidth = Math.max(0, Math.min(baseWidth, maxWidth));
  const desiredWidth = Math.ceil(
    Math.max(0, maxTextWidth) + LIVE_TRANSCRIPT_CHROME_WIDTH,
  );
  const pillWidth = Math.max(
    safeBaseWidth,
    Math.min(maxWidth, desiredWidth),
  );
  const viewportWidth = Math.max(
    0,
    pillWidth - LIVE_TRANSCRIPT_CHROME_WIDTH,
  );
  const overflow = Math.max(
    0,
    Math.ceil(Math.max(0, currentTextWidth) - viewportWidth),
  );

  return {
    pillWidth,
    viewportWidth,
    railOffsetX: overflow === 0 ? 0 : -overflow,
    overflowing: overflow > 0,
  };
}
