import { describe, expect, it } from "vitest";

import {
  LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
  LIVE_TRANSCRIPT_LINE_HEIGHT,
  LIVE_TRANSCRIPT_MAX_LINES,
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
        LIVE_TRANSCRIPT_LINE_HEIGHT,
      textWidth:
        LIVE_TRANSCRIPT_PANEL_WIDTH - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
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

  it("grows down by complete rows when text wraps", () => {
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
      textWidth:
        LIVE_TRANSCRIPT_PANEL_WIDTH - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
      railOffsetY: 0,
      overflowing: false,
    });
  });

  it("caps at five rows and moves older rows upward", () => {
    const visibleTextHeight =
      LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_MAX_LINES;
    const fullTextHeight =
      LIVE_TRANSCRIPT_LINE_HEIGHT * (LIVE_TRANSCRIPT_MAX_LINES + 2);
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

  it("keeps its largest height when a streaming revision gets shorter", () => {
    expect(
      calculateLiveTranscriptLayout({
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
        maxWrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 4,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toMatchObject({
      pillWidth: LIVE_TRANSCRIPT_PANEL_WIDTH,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * 4,
      visibleTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 4,
      railOffsetY: 0,
      overflowing: false,
    });
  });
});
