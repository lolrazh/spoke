import { describe, expect, it } from "vitest";

import {
  LIVE_TRANSCRIPT_EXPANDED_LINES,
  LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
  LIVE_TRANSCRIPT_INITIAL_LINES,
  LIVE_TRANSCRIPT_LINE_HEIGHT,
  LIVE_TRANSCRIPT_PANEL_WIDTH,
  LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT,
  calculateLiveTranscriptLayout,
} from "./liveTranscriptLayout";

describe("calculateLiveTranscriptLayout", () => {
  it("opens to one stable panel width", () => {
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_INITIAL_LINES,
      textWidth:
        LIVE_TRANSCRIPT_PANEL_WIDTH - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight:
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_INITIAL_LINES,
      railOffsetY: 0,
      overflowing: false,
    });
  });

  it("does not retarget its width as partial text changes", () => {
    const short = calculateLiveTranscriptLayout({
      wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });
    const long = calculateLiveTranscriptLayout({
      wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 3,
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });

    expect(short.pillWidth).toBe(LIVE_TRANSCRIPT_PANEL_WIDTH);
    expect(long.pillWidth).toBe(LIVE_TRANSCRIPT_PANEL_WIDTH);
  });

  it("clamps the panel width to the available maximum", () => {
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 360,
      }).pillWidth,
    ).toBe(360);
  });

  it("holds one reserved height through the first four rows", () => {
    const oneLine = calculateLiveTranscriptLayout({
      wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });
    const fourLines = calculateLiveTranscriptLayout({
      wrappedTextHeight:
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_INITIAL_LINES,
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });

    expect(fourLines).toEqual(oneLine);
  });

  it("expands once from four reserved rows to ten", () => {
    const fiveLines = calculateLiveTranscriptLayout({
      wrappedTextHeight:
        LIVE_TRANSCRIPT_LINE_HEIGHT * (LIVE_TRANSCRIPT_INITIAL_LINES + 1),
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });
    const nineLines = calculateLiveTranscriptLayout({
      wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 9,
      baseWidth: 196,
      baseHeight: 30,
      maxWidth: 560,
    });

    expect(fiveLines).toEqual({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_EXPANDED_LINES,
      textWidth:
        LIVE_TRANSCRIPT_PANEL_WIDTH - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight:
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_EXPANDED_LINES,
      railOffsetY: 0,
      overflowing: false,
    });
    expect(nineLines).toEqual(fiveLines);
  });

  it("caps at ten rows and moves older rows upward", () => {
    const visibleTextHeight =
      LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_EXPANDED_LINES;
    const fullTextHeight =
      LIVE_TRANSCRIPT_LINE_HEIGHT * (LIVE_TRANSCRIPT_EXPANDED_LINES + 2);
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: fullTextHeight,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT + visibleTextHeight,
      textWidth:
        LIVE_TRANSCRIPT_PANEL_WIDTH - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight,
      railOffsetY: -(fullTextHeight - visibleTextHeight),
      overflowing: true,
    });
  });

  it("keeps the expanded stage when a streaming revision gets shorter", () => {
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
        maxWrappedTextHeight:
          LIVE_TRANSCRIPT_LINE_HEIGHT * (LIVE_TRANSCRIPT_INITIAL_LINES + 1),
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toMatchObject({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_EXPANDED_LINES,
      visibleTextHeight:
        LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_EXPANDED_LINES,
      railOffsetY: 0,
      overflowing: false,
    });
  });
});
