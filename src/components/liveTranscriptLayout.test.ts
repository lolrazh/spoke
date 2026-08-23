import { describe, expect, it } from "vitest";

import {
  LIVE_TRANSCRIPT_CHROME_WIDTH,
  calculateLiveTranscriptLayout,
} from "./liveTranscriptLayout";

describe("calculateLiveTranscriptLayout", () => {
  it("keeps the base pill width while a short phrase still fits", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 50,
        maxTextWidth: 50,
        baseWidth: 196,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 196,
      viewportWidth: 196 - LIVE_TRANSCRIPT_CHROME_WIDTH,
      railOffsetX: 0,
      overflowing: false,
    });
  });

  it("grows from measured text width before reaching the cap", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 250,
        maxTextWidth: 250,
        baseWidth: 196,
        maxWidth: 560,
      }).pillWidth,
    ).toBe(250 + LIVE_TRANSCRIPT_CHROME_WIDTH);
  });

  it("holds the max width and moves the rail to expose the newest text", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 600,
        maxTextWidth: 600,
        baseWidth: 196,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 560,
      viewportWidth: 560 - LIVE_TRANSCRIPT_CHROME_WIDTH,
      railOffsetX: -(600 - (560 - LIVE_TRANSCRIPT_CHROME_WIDTH)),
      overflowing: true,
    });
  });

  it("keeps expansion monotonic without scrolling past shorter corrected text", () => {
    expect(
      calculateLiveTranscriptLayout({
        currentTextWidth: 200,
        maxTextWidth: 600,
        baseWidth: 196,
        maxWidth: 560,
      }),
    ).toEqual({
      pillWidth: 560,
      viewportWidth: 560 - LIVE_TRANSCRIPT_CHROME_WIDTH,
      railOffsetX: 0,
      overflowing: false,
    });
  });
});
