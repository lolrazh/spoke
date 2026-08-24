import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSmoothTranscriptText } from "./useSmoothTranscriptText";

describe("useSmoothTranscriptText", () => {
  let currentTime: number;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;

  const runFrame = () => {
    currentTime += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      pending.forEach((callback) => callback(currentTime));
    });
  };

  beforeEach(() => {
    currentTime = 0;
    nextFrameId = 1;
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paces a partial across display frames", () => {
    const { result } = renderHook(() =>
      useSmoothTranscriptText("smooth streaming text", { enabled: true }),
    );

    expect(result.current).toBe("");
    runFrame();
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current).not.toBe("smooth streaming text");

    for (let index = 0; index < 30; index += 1) runFrame();
    expect(result.current).toBe("smooth streaming text");
  });

  it("corrects a revised prefix without clearing visible text", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSmoothTranscriptText(text, { enabled: true }),
      { initialProps: { text: "The quick brown" } },
    );
    for (let index = 0; index < 6; index += 1) runFrame();
    const visibleLength = result.current.length;

    rerender({ text: "The quick crown fox" });

    expect(result.current).toBe("The quick crown fox".slice(0, visibleLength));
    expect(result.current.length).toBe(visibleLength);
  });

  it("reveals an extended grapheme without splitting it", () => {
    const family = "👨‍👩‍👧‍👦";
    const { result } = renderHook(() =>
      useSmoothTranscriptText(`${family} hello`, { enabled: true }),
    );

    runFrame();
    expect(result.current).toBe(family);
  });

  it("shows the full partial immediately when motion is reduced", () => {
    const { result } = renderHook(() =>
      useSmoothTranscriptText("No animation", { enabled: false }),
    );

    expect(result.current).toBe("No animation");
    expect(frames.size).toBe(0);
  });

  it("cancels its pending display frame when the transcript unmounts", () => {
    const { unmount } = renderHook(() =>
      useSmoothTranscriptText("Still arriving", { enabled: true }),
    );
    expect(frames.size).toBe(1);

    unmount();

    expect(frames.size).toBe(0);
  });
});
