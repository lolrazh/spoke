import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  getLiveTranscript,
  setLiveTranscript,
} from "./liveTranscript";
import {
  boundLiveTranscriptText,
  MAX_LIVE_TRANSCRIPT_DOM_CHARS,
} from "../utils/liveTranscriptText";

describe("live transcript store", () => {
  afterEach(() => {
    act(() => setLiveTranscript(""));
  });

  it("does not retain more than the visible live transcript tail", () => {
    const text = Array.from({ length: 500 }, () => "word").join(" ");

    act(() => setLiveTranscript(text));

    expect(getLiveTranscript()).toBe(boundLiveTranscriptText(text));
    expect(getLiveTranscript().length).toBeLessThanOrEqual(
      MAX_LIVE_TRANSCRIPT_DOM_CHARS,
    );
  });
});
