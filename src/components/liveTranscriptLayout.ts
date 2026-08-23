export const LIVE_TRANSCRIPT_HORIZONTAL_PADDING = 28;
export const LIVE_TRANSCRIPT_LINE_HEIGHT = 19;
export const LIVE_TRANSCRIPT_MAX_LINES = 5;
export const LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT = 40;

export type LiveTranscriptLayout = {
  pillWidth: number;
  pillHeight: number;
  textWidth: number;
  visibleTextHeight: number;
  railOffsetY: number;
  overflowing: boolean;
};

export function calculateLiveTranscriptWidth({
  currentTextWidth,
  baseWidth,
  maxWidth,
}: {
  currentTextWidth: number;
  baseWidth: number;
  maxWidth: number;
}): Pick<LiveTranscriptLayout, "pillWidth" | "textWidth"> {
  const safeMaxWidth = Math.max(0, maxWidth);
  const safeBaseWidth = Math.max(
    0,
    Math.min(baseWidth, safeMaxWidth),
  );
  const desiredWidth = Math.ceil(
    Math.max(0, currentTextWidth) + LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
  );
  const pillWidth = Math.max(
    safeBaseWidth,
    Math.min(safeMaxWidth, desiredWidth),
  );

  return {
    pillWidth,
    textWidth: Math.max(
      0,
      pillWidth - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
    ),
  };
}

/**
 * Derive the pill target from measured text instead of character counts.
 *
 * Text starts below the activity bars. The pill first grows horizontally from
 * its center. At the width cap, text wraps and grows the pill to five rows.
 * Longer transcripts keep their newest rows visible without taking over the
 * screen.
 */
export function calculateLiveTranscriptLayout({
  currentTextWidth,
  wrappedTextHeight,
  baseWidth,
  baseHeight,
  maxWidth,
}: {
  currentTextWidth: number;
  wrappedTextHeight: number;
  baseWidth: number;
  baseHeight: number;
  maxWidth: number;
}): LiveTranscriptLayout {
  const { pillWidth, textWidth } = calculateLiveTranscriptWidth({
    currentTextWidth,
    baseWidth,
    maxWidth,
  });
  const fullTextHeight = Math.max(
    LIVE_TRANSCRIPT_LINE_HEIGHT,
    Math.ceil(Math.max(0, wrappedTextHeight)),
  );
  const maxVisibleTextHeight =
    LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_MAX_LINES;
  const visibleTextHeight = Math.min(fullTextHeight, maxVisibleTextHeight);
  const pillHeight = Math.max(
    Math.max(0, baseHeight),
    LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT + visibleTextHeight,
  );
  const overflowY = Math.max(0, fullTextHeight - visibleTextHeight);

  return {
    pillWidth,
    pillHeight,
    textWidth,
    visibleTextHeight,
    railOffsetY: overflowY === 0 ? 0 : -overflowY,
    overflowing: overflowY > 0,
  };
}
