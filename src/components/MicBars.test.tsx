import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";

import { MicBars } from "./MicBars";

describe("mic bars", () => {
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
    pendingFrame = null;
    vi.restoreAllMocks();
  });

  it("keeps a fixed layout box while scaling the resting bars", () => {
    const analyserRef = { current: null } as RefObject<AnalyserNode | null>;
    const { container } = render(
      <MicBars analyserRef={analyserRef} active={false} />,
    );
    const bar = container.querySelector<HTMLElement>(".flex-1");

    expect(bar?.style.height).toBe("86px");
    expect(bar?.style.transform).toBe("scaleY(0.06976744186046512)");
  });

  it("scales active bars from their bottom edge", () => {
    const analyser = {
      frequencyBinCount: 24,
      getByteFrequencyData: (data: Uint8Array) => data.fill(255),
    } as unknown as AnalyserNode;
    const analyserRef = {
      current: analyser,
    } as RefObject<AnalyserNode | null>;
    const { container } = render(
      <MicBars analyserRef={analyserRef} active />,
    );

    act(() => {
      pendingFrame?.(16);
      pendingFrame = null;
    });

    const bar = container.querySelector<HTMLElement>(".flex-1");
    expect(bar?.style.height).toBe("86px");
    expect(bar?.style.transform).toBe("scaleY(1)");
    expect(bar?.style.transformOrigin).toBe("bottom");
  });
});
