import { afterEach, describe, expect, it, vi } from "vitest";

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => "/repo"),
}));
const originalResourcesPath = process.resourcesPath;

vi.mock("electron", () => ({ app: electronApp }));

import { getAudioCapturePath } from "./audioCapture";

describe("getAudioCapturePath", () => {
  afterEach(() => {
    electronApp.isPackaged = false;
    if (originalResourcesPath === undefined) {
      Object.defineProperty(process, "resourcesPath", {
        configurable: true,
        value: undefined,
      });
    } else {
      Object.defineProperty(process, "resourcesPath", {
        configurable: true,
        value: originalResourcesPath,
      });
    }
    vi.clearAllMocks();
  });

  it("resolves the helper from the native build output in development", () => {
    expect(getAudioCapturePath()).toBe(
      "/repo/native/bin/Spoke Audio Capture.app/Contents/MacOS/Spoke Audio Capture",
    );
  });

  it("resolves the helper directly from packaged Resources", () => {
    electronApp.isPackaged = true;
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/app/Contents/Resources",
    });

    expect(getAudioCapturePath()).toBe(
      "/app/Contents/Resources/Spoke Audio Capture.app/Contents/MacOS/Spoke Audio Capture",
    );
  });
});
