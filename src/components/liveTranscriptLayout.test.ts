import { describe, expect, it } from "vitest";

import {
  LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
  LIVE_TRANSCRIPT_LINE_HEIGHT,
  LIVE_TRANSCRIPT_MAX_LINES,
  LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT,
  calculateLiveTranscriptLayout,
} from "./liveTranscriptLayout";

describe("calculateLiveTranscriptLayout", () => {
  it("keeps the base pill width while a short phrase still fits", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 50,
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 196,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT,
      textWidth: 196 - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
      railOffsetY: 0,
      overflowing: false,
    });
  });

  it("grows from measured text width before reaching the cap", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 250,
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }).pillWidth,
    ).toBe(250 + LIVE_TRANSCRIPT_HORIZONTAL_PADDING);
  });

  it("holds the max width and grows down when text wraps", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 600,
        wrappedTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 560,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT +
        LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
      textWidth: 560 - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight: LIVE_TRANSCRIPT_LINE_HEIGHT * 2,
      railOffsetY: 0,
      overflowing: false,
    });
  });

  it("caps at three rows and moves older rows upward", () => {
    const visibleTextHeight =
      LIVE_TRANSCRIPT_LINE_HEIGHT * LIVE_TRANSCRIPT_MAX_LINES;
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 900,
        wrappedTextHeight: 80,
        baseWidth: 196,
        baseHeight: 30,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 560,
      pillHeight:
        LIVE_TRANSCRIPT_VERTICAL_CHROME_HEIGHT + visibleTextHeight,
      textWidth: 560 - LIVE_TRANSCRIPT_HORIZONTAL_PADDING,
      visibleTextHeight,
      railOffsetY: -(80 - visibleTextHeight),
      overflowing: true,
    });
  });
});
