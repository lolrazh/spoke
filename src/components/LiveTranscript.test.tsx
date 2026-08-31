import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_TRANSCRIPT_CARET_IDLE_MS,
  LiveTranscriptFromStore,
} from "./LiveTranscript";
import {
  getLiveTranscript,
  setLiveTranscript,
} from "../state/liveTranscript";
import { MAX_LIVE_TRANSCRIPT_DOM_CHARS } from "./liveTranscriptText";

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
  let pendingFrame: FrameRequestCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    pendingFrame = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 1;
    });
    act(() => setLiveTranscript(""));
  });

  afterEach(() => {
    act(() => {
      setLiveTranscript("");
      pendingFrame?.(0);
      pendingFrame = null;
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("blinks only after an idle gap and becomes solid on new text", () => {
    act(() => setLiveTranscript("Hello"));
    const { container, rerender } = render(
      <LiveTranscriptFromStore {...commonProps} />,
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

    act(() => {
      setLiveTranscript("Hello world");
      pendingFrame?.(0);
      pendingFrame = null;
    });
    expect(caret?.classList.contains("is-blinking")).toBe(false);

    const timerCount = vi.getTimerCount();
    act(() => {
      setLiveTranscript("Hello world again");
      setLiveTranscript("Hello world again and again");
      pendingFrame?.(0);
      pendingFrame = null;
    });
    expect(vi.getTimerCount()).toBe(timerCount);

    rerender(<LiveTranscriptFromStore {...commonProps} />);
  });

  it("does not blink with reduced motion and hides while processing", () => {
    act(() => setLiveTranscript("Hello"));
    const { container, rerender } = render(
      <LiveTranscriptFromStore {...commonProps} reducedMotion />,
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
      <LiveTranscriptFromStore {...commonProps} isProcessing />,
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

  it("bounds the live transcript DOM to the recent tail", () => {
    const text = Array.from({ length: 500 }, () => "word").join(" ");
    const { container } = render(
      <LiveTranscriptFromStore {...commonProps} />,
    );

    act(() => {
      setLiveTranscript(text);
      pendingFrame?.(0);
      pendingFrame = null;
    });

    expect(
      container.querySelector(".live-transcript-measure")?.textContent
        ?.length,
    ).toBeLessThanOrEqual(MAX_LIVE_TRANSCRIPT_DOM_CHARS);
    expect(
      container.querySelector(".live-transcript-rail")?.textContent?.length,
    ).toBeLessThanOrEqual(MAX_LIVE_TRANSCRIPT_DOM_CHARS);
  });
});
