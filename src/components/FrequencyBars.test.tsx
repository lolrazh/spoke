import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ListeningFrequencyBars,
  ProcessingFrequencyBars,
} from "./FrequencyBars";
import { setAudioLevel } from "../state/audioLevel";

describe("imperative frequency bars", () => {
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
      setAudioLevel(0);
      pendingFrame?.(0);
      pendingFrame = null;
    });
    vi.restoreAllMocks();
  });

  it("animates listening bars with transforms instead of height layout", () => {
    const { container } = render(<ListeningFrequencyBars />);
    const bar = container.querySelector<HTMLElement>(".frequency-element");

    expect(bar?.style.height).toBe("12px");
    expect(bar?.style.transform).toMatch(/^scaleY\(/);

    act(() => {
      setAudioLevel(0.5);
      pendingFrame?.(16);
      pendingFrame = null;
    });

    expect(bar?.style.height).toBe("12px");
    expect(bar?.style.transform).toMatch(/^scaleY\(/);
  });

  it("animates processing bars with transforms", () => {
    const { container } = render(<ProcessingFrequencyBars />);
    const bar = container.querySelector<HTMLElement>(".frequency-element");

    expect(bar?.style.height).toBe("12px");
    expect(bar?.style.transform).toMatch(/^scaleY\(/);
    expect(bar?.classList.contains("processing-frequency-element")).toBe(true);
  });
});
