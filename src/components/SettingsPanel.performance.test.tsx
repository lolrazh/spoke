import React, { act } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  progressRenders: 0,
  emitState: null as ((state: unknown) => void) | null,
}));

vi.mock("./ui/ProgressRing", () => ({
  default: ({ progress }: { progress: number }) => {
    harness.progressRenders += 1;
    return React.createElement("span", {
      "data-testid": "progress-ring",
      "data-progress": String(progress),
    });
  },
}));

function snapshot(downloadPercent: number) {
  return {
    status: "downloading",
    version: "v0.1.8",
    readyToInstall: false,
    error: null,
    downloadPercent,
  };
}

describe("SettingsPanel update progress rendering", () => {
  beforeEach(() => {
    harness.progressRenders = 0;
    harness.emitState = null;
    (window as any).app = {
      getVersion: vi.fn(async () => "0.1.7"),
    };
    (window as any).update = {
      getState: vi.fn(async () => snapshot(0)),
      onStateChanged: vi.fn((callback: (state: unknown) => void) => {
        harness.emitState = callback;
        return () => {
          if (harness.emitState === callback) harness.emitState = null;
        };
      }),
      installWhenReady: vi.fn(async () => ({
        ok: true,
        snapshot: snapshot(0),
      })),
      restart: vi.fn(async () => ({ ok: true })),
    };
  });

  it("renders once for a burst of progress snapshots and keeps the latest", async () => {
    const SettingsPanel = (await import("./SettingsPanel")).default;
    const { container, unmount } = render(
      React.createElement(SettingsPanel, { embeddedMode: true }),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 540));
    });

    expect(harness.emitState).not.toBeNull();
    harness.progressRenders = 0;

    await act(async () => {
      for (const progress of [10, 20, 30]) {
        harness.emitState?.(snapshot(progress));
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(harness.progressRenders).toBe(1);
    expect(
      container
        .querySelector('[data-testid="progress-ring"]')
        ?.getAttribute("data-progress"),
    ).toBe("0.3");
    unmount();
  });
});
