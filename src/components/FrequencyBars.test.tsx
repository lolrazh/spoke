import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FrequencyBars } from "./FrequencyBars";
import { processingBounceFrame } from "./processingBounce";
import { setAudioLevel } from "../state/audioLevel";
import { ListeningMeter } from "./listeningMeter";

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
    const { container } = render(<FrequencyBars mode="listening" />);
    const bar = container.querySelector<HTMLElement>(".frequency-element");

    expect(container.querySelectorAll(".frequency-element")).toHaveLength(18);
    expect(bar?.style.width).toBe("2px");

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

  it("moves the processing packet across the same bars and stops on unmount", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { container, unmount } = render(<FrequencyBars mode="processing" />);
    const bars = Array.from(container.querySelectorAll<HTMLElement>(".frequency-element"));
    const initial = bars[0].style.transform;
    expect(bars).toHaveLength(18);
    expect(bars[0].style.height).toBe("12px");
    act(() => pendingFrame?.(450));
    expect(bars[0].style.transform).not.toBe(initial);
    expect(bars[17].style.transform).toBe(initial);
    expect(Array.from(container.querySelectorAll(".frequency-element"))).toEqual(bars);
    expect(pendingFrame).not.toBeNull();
    unmount();
    expect(cancel).toHaveBeenCalledWith(nextFrameId);
    pendingFrame = null;
  });

  it("morphs and reverses from displayed heights without replacing the bars", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { container, rerender, unmount } = render(<FrequencyBars mode="listening" />);
    const bars = Array.from(container.querySelectorAll<HTMLElement>(".frequency-element"));
    const transforms = () => bars.map(bar => bar.style.transform);
    const speaking = transforms();
    now = 80;
    rerender(<FrequencyBars mode="processing" />);
    expect(Array.from(container.querySelectorAll(".frequency-element"))).toEqual(bars);
    expect(transforms()).toEqual(speaking);
    now = 120;
    act(() => pendingFrame?.(now));
    expect(transforms()).not.toEqual(speaking);
    const intermediate = transforms();
    rerender(<FrequencyBars mode="listening" />);
    expect(transforms()).toEqual(intermediate);
    rerender(<FrequencyBars mode="processing" />);
    expect(transforms()).toEqual(intermediate);
    now = 240;
    act(() => pendingFrame?.(now));
    for (let index = 0; index < bars.length; index++) {
      const height = Number(bars[index].style.transform.slice(7, -1)) * 12;
      expect(height).toBeCloseTo(processingBounceFrame(0.12, index).height, 2);
    }
    unmount();
    pendingFrame = null;
  });

  it("uses a static processing shape with reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { container, unmount } = render(<FrequencyBars mode="processing" />);
    expect(pendingFrame).toBeNull();
    const bar = container.querySelector<HTMLElement>(".frequency-element");
    expect(bar?.style.opacity).toBe("0.85");
    unmount();
  });

  it("retains the eight-bar timing across the original 18 bars", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const reference = new ListeningMeter(8, now);
    reference.observe(0, now);
    const { container } = render(<FrequencyBars mode="listening" />);
    const bars = container.querySelectorAll<HTMLElement>(".frequency-element");
    const level = (time: number) => time < 160 ? 0.002 : time < 420 ? 0.05 : 0;
    for (now = 0; now <= 800; now += 16) {
      act(() => {
        setAudioLevel(level(now));
        reference.observe(level(now), now);
        const frame = pendingFrame;
        pendingFrame = null;
        frame?.(now);
      });
      const source = reference.advance(now);
      // Ends preserve the source ends; the middle spans the two source center bars.
      for (const index of [0, 8, 9, 17]) {
        const position = index * 7 / 17;
        const low = Math.floor(position);
        const fraction = position - low;
        const expected = Math.min(12, source[low] * (1 - fraction) +
          source[Math.min(7, low + 1)] * fraction);
        const rendered = Number(bars[index].style.transform.slice(7, -1)) * 12;
        // The existing paint threshold skips changes below 0.006 pixels.
        expect(Math.abs(rendered - expected)).toBeLessThan(0.0061);
      }
    }
  });

  it("continues between audio updates and cancels its display loop on unmount", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = render(<FrequencyBars mode="listening" />);
    act(() => {
      const frame = pendingFrame;
      pendingFrame = null;
      frame?.(performance.now() + 16);
    });
    expect(pendingFrame).not.toBeNull();
    unmount();
    expect(cancel).toHaveBeenCalledWith(nextFrameId);
  });
});
