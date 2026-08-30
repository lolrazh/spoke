import { describe, expect, it } from "vitest";

import { splitLiveTranscriptText } from "./liveTranscriptText";

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
