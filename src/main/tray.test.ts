import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { quit: vi.fn(), getVersion: vi.fn(() => "0.1.33") },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn(), createEmpty: vi.fn() },
  Tray: vi.fn(),
  autoUpdater: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() },
}));

import { updateIndicatorTooltip } from "./tray";
import type { UpdateSnapshot } from "./updateController";

const base: UpdateSnapshot = {
  status: "idle",
  version: null,
  readyToInstall: false,
  error: null,
  downloadPercent: null,
};

describe("updateIndicatorTooltip", () => {
  it("is just the app name when there is nothing to say", () => {
    expect(updateIndicatorTooltip(base)).toBe("Spoke");
    expect(updateIndicatorTooltip({ ...base, status: "not-available" })).toBe(
      "Spoke",
    );
    expect(updateIndicatorTooltip({ ...base, status: "checking" })).toBe(
      "Spoke",
    );
  });

  it("shows download progress", () => {
    expect(
      updateIndicatorTooltip({
        ...base,
        status: "downloading",
        version: "0.1.33",
        downloadPercent: 42,
      }),
    ).toBe("Spoke: downloading update, 42%");
    expect(updateIndicatorTooltip({ ...base, status: "downloading" })).toBe(
      "Spoke: downloading update",
    );
  });

  it("asks for a restart once the update is ready", () => {
    expect(
      updateIndicatorTooltip({
        ...base,
        status: "available",
        version: "0.1.33",
        readyToInstall: true,
        downloadPercent: 100,
      }),
    ).toBe("Spoke 0.1.33 is ready. Restart to update.");
  });

  it("reports a failed update", () => {
    expect(
      updateIndicatorTooltip({ ...base, status: "error", error: "offline" }),
    ).toBe("Spoke: update failed");
  });
});
