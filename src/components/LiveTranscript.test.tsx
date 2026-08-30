import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_TRANSCRIPT_CARET_IDLE_MS,
  LiveTranscriptFromStore,
  LiveTranscript,
} from "./LiveTranscript";
import {
  getLiveTranscript,
  setLiveTranscript,
} from "../state/liveTranscript";

vi.mock("./FrequencyBars", () => ({
  default: () => <div />,
  ListeningFrequencyBars: () => <div />,
  ProcessingFrequencyBars: () => <div />,
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

describe("live transcript store", () => {
  let pendingFrame: FrameRequestCallback | null = null;
  let nextFrameId = 0;

  beforeEach(() => {
    pendingFrame = null;
    nextFrameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return ++nextFrameId;
    });
  });

  afterEach(() => {
    act(() => {
      setLiveTranscript("");
      pendingFrame?.(0);
      pendingFrame = null;
    });
    vi.restoreAllMocks();
  });

  it("updates the production leaf without rendering for each hypothesis", () => {
    let renderCount = 0;
    function Probe() {
      renderCount += 1;
      return <LiveTranscriptFromStore {...commonProps} />;
    }

    const { container } = render(<Probe />);
    expect(renderCount).toBe(1);

    act(() => {
      setLiveTranscript("Hello");
      setLiveTranscript("Hello world");
    });

    expect(renderCount).toBe(1);
    expect(getLiveTranscript()).toBe("Hello world");
    expect(
      container.querySelector(".live-transcript-measure")?.textContent,
    ).toBe("");

    act(() => {
      pendingFrame?.(16);
      pendingFrame = null;
    });

    expect(renderCount).toBe(1);
    expect(
      container.querySelector(".live-transcript-measure")?.textContent,
    ).toBe("Hello world");
    expect(
      container.querySelector(".live-transcript-tentative")?.textContent,
    ).toBe("world");
  });
});
