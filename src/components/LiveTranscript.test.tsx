import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_TRANSCRIPT_CARET_IDLE_MS,
  LiveTranscript,
} from "./LiveTranscript";

vi.mock("./FrequencyBars", () => ({
  default: () => <div />,
  ListeningFrequencyBars: () => <div />,
}));

const commonProps = {
  isProcessing: false,
  textWidth: 392,
  visibleTextHeight: 20,
  railOffsetY: 0,
  overflowing: false,
  reducedMotion: false,
  onTextMetricsChange: vi.fn(),
};

describe("LiveTranscript caret", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blinks only after an idle gap and becomes solid on new text", () => {
    const { container, rerender } = render(
      <LiveTranscript {...commonProps} text="Hello" />,
    );
    const caret = container.querySelector(".live-transcript-caret");

    expect(caret).not.toBeNull();
    expect(caret?.classList.contains("is-blinking")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LIVE_TRANSCRIPT_CARET_IDLE_MS - 1);
    });
    expect(caret?.classList.contains("is-blinking")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(caret?.classList.contains("is-blinking")).toBe(true);

    rerender(<LiveTranscript {...commonProps} text="Hello world" />);
    expect(caret?.classList.contains("is-blinking")).toBe(false);
  });

  it("does not blink with reduced motion and hides while processing", () => {
    const { container, rerender } = render(
      <LiveTranscript {...commonProps} text="Hello" reducedMotion />,
    );

    act(() => {
      vi.advanceTimersByTime(LIVE_TRANSCRIPT_CARET_IDLE_MS);
    });
    expect(
      container
        .querySelector(".live-transcript-caret")
        ?.classList.contains("is-blinking"),
    ).toBe(false);

    rerender(
      <LiveTranscript {...commonProps} text="Hello" isProcessing />,
    );
    expect(container.querySelector(".live-transcript-caret")).toBeNull();
  });
});
