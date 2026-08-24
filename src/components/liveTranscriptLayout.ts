export const LIVE_TRANSCRIPT_HORIZONTAL_PADDING = 28;
export const LIVE_TRANSCRIPT_LINE_HEIGHT = 20;
export const LIVE_TRANSCRIPT_MAX_LINES = 10;
export const LIVE_TRANSCRIPT_PANEL_WIDTH = 420;
export const LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT = 40;

export type LiveTranscriptLayout = {
  pillWidth: number;
  pillHeight: number;
  textWidth: number;
  visibleTextHeight: number;
  railOffsetY: number;
  overflowing: boolean;
};

/**
 * Derive one stable live panel target.
 *
 * The panel opens to one width, then grows with each wrapped line. Longer
 * transcripts keep their newest rows visible without taking over the screen.
 */
export function calculateLiveTranscriptLayout({
  wrappedTextHeight,
  maxWrappedTextHeight = wrappedTextHeight,
  baseWidth,
  baseHeight,
  maxWidth,
}: {
  wrappedTextHeight: number;
  maxWrappedTextHeight?: number;
  baseWidth: number;
  baseHeight: number;
  maxWidth: number;
}): LiveTranscriptLayout {
  const safeMaxWidth = Math.max(0, maxWidth);
  const safeBaseWidth = Math.max(0, Math.min(baseWidth, safeMaxWidth));
  const pillWidth = Math.max(
    safeBaseWidth,
    Math.min(safeMaxWidth, LIVE_TRANSCRIPT_PANEL_WIDTH),
  );
  const textWidth = Math.max(
    0,
    pillWidth - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
  );
  const fullTextHeight = Math.max(
    LIVE_TRANSCRIPT_LINE_HEIGHT,
    Math.ceil(Math.max(0, wrappedTextHeight)),
  );
  const layoutTextHeight = Math.max(
    fullTextHeight,
    Math.ceil(Math.max(0, maxWrappedTextHeight)),
  );
  const visibleLineCount = Math.min(
    LIVE_TRANSCRIPT_MAX_LINES,
    Math.ceil(layoutTextHeight / LIVE_TRANSCRIPT_LINE_HEIGHT),
  );
  const visibleTextHeight = LIVE_TRANSCRIPT_LINE_HEIGHT * visibleLineCount;
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
