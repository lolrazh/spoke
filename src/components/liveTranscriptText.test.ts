import { describe, expect, it } from "vitest";

import {
  boundLiveTranscriptText,
  MAX_LIVE_TRANSCRIPT_DOM_CHARS,
  splitLiveTranscriptText,
} from "./liveTranscriptText";

describe("boundLiveTranscriptText", () => {
  it("keeps only a recent word-aligned tail", () => {
    const text = Array.from({ length: 500 }, () => "word").join(" ");
    const bounded = boundLiveTranscriptText(text);

    expect(bounded.length).toBeLessThanOrEqual(MAX_LIVE_TRANSCRIPT_DOM_CHARS);
    expect(bounded).toMatch(/^word(?: word)*$/);
    expect(bounded).toBe(text.slice(text.length - bounded.length));
  });
});

describe("splitLiveTranscriptText", () => {
  it("keeps completed words stable and isolates the live tail", () => {
    expect(splitLiveTranscriptText("The quick bro", false)).toEqual({
      committed: "The quick ",
      tentative: "bro",
    });
  });

  it("promotes the previous word when the next word begins", () => {
    expect(splitLiveTranscriptText("The quick brown f", false)).toEqual({
      committed: "The quick brown ",
      tentative: "f",
    });
  });

  it("keeps punctuation with the tentative word", () => {
    expect(splitLiveTranscriptText("Hello, world!", false)).toEqual({
      committed: "Hello, ",
      tentative: "world!",
    });
  });

  it("handles scripts without splitting their final word by code unit", () => {
    expect(splitLiveTranscriptText("नमस्ते दुनिया", false)).toEqual({
      committed: "नमस्ते ",
      tentative: "दुनिया",
    });
  });

  it("segments only the recent tail of a long non-plain-ASCII snapshot", () => {
    const prefix = Array.from({ length: 180 }, () => "don't").join(" ");
    expect(splitLiveTranscriptText(`${prefix} final`, false)).toEqual({
      committed: `${prefix} `,
      tentative: "final",
    });
  });

  it("promotes the full snapshot while finalizing", () => {
    expect(splitLiveTranscriptText("The final words", true)).toEqual({
      committed: "The final words",
      tentative: "",
    });
  });
});
