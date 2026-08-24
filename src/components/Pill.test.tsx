import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Pill from "./Pill";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => true };
});

const commonProps = {
  pillContext: {},
  notifWidth: null,
  isTextTruncated: false,
  dims: {
    baseW: 196,
    baseH: 30,
    restingH: 7,
    expandedW: 520,
    expandedH: 340,
    maxW: 560,
  },
  onHoverChange: vi.fn(),
  onMetrics: vi.fn(),
  onMouseEnter: vi.fn(),
  onMouseLeave: vi.fn(),
  onExpand: vi.fn(),
  onCollapse: vi.fn(),
  panelView: "settings" as const,
};

describe("Pill live transcript", () => {
  it("shows partial text only while dictation is active", () => {
    const { container, getByRole, rerender } = render(
      <Pill
        {...commonProps}
        pillState="LISTENING"
        liveTranscript="Hello from Nemotron"
      />,
    );

    expect(
      container.querySelector(".live-transcript-rail")?.textContent,
    ).toBe("Hello from Nemotron");
    const liveLayout = container.querySelector(".live-transcript");
    expect(
      liveLayout?.children[0]?.classList.contains("live-transcript-activity"),
    ).toBe(true);
    expect(
      liveLayout?.children[1]?.classList.contains("live-transcript-viewport"),
    ).toBe(true);
    expect(getByRole("status").textContent).toBe("Live transcription active");

    rerender(
      <Pill
        {...commonProps}
        pillState="IDLE"
        liveTranscript="Hello from Nemotron"
      />,
    );

    expect(container.querySelector(".live-transcript-rail")).toBeNull();
    expect(getByRole("status").textContent).toBe("");
  });

  it("keeps the transcript visible while finalization is processing", () => {
    const { container } = render(
      <Pill
        {...commonProps}
        pillState="PROCESSING"
        liveTranscript="Final words"
      />,
    );

    expect(
      container.querySelector(".live-transcript-rail")?.textContent,
    ).toBe("Final words");
    expect(container.querySelector(".live-transcript-activity")).not.toBeNull();
  });

  it("keeps completed words separate from the tentative live tail", () => {
    const { container, rerender } = render(
      <Pill
        {...commonProps}
        pillState="LISTENING"
        liveTranscript="The quick brown"
      />,
    );

    rerender(
      <Pill
        {...commonProps}
        pillState="LISTENING"
        liveTranscript="The quick crown fox"
      />,
    );

    const rail = container.querySelector(".live-transcript-rail");
    expect(rail?.textContent).toBe("The quick crown fox");
    expect(
      container.querySelector(".live-transcript-committed")?.textContent,
    ).toBe("The quick crown ");
    expect(
      container.querySelector(".live-transcript-tentative")?.textContent,
    ).toBe("fox");
  });
});
