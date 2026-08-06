import { afterEach, describe, expect, it, vi } from "vitest";

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => "/repo"),
}));
const originalResourcesPath = process.resourcesPath;

vi.mock("electron", () => ({ app: electronApp }));

import { getAudioCapturePath, nativeAudioCapture } from "./audioCapture";

type TestNativeAudioCaptureState = {
  process: {
    stdin: {
      destroyed: boolean;
      write: ReturnType<typeof vi.fn>;
    };
  } | null;
  active: boolean;
  target: unknown;
  pendingStart: unknown;
  pendingStop: unknown;
  stopPromise: Promise<void> | null;
};

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

  it("settles a pending stop when cancellation races in the main process", async () => {
    const state = nativeAudioCapture as unknown as TestNativeAudioCaptureState;
    const write = vi.fn();
    state.process = {
      stdin: {
        destroyed: false,
        write,
      },
    };
    state.active = true;

    try {
      const stopping = nativeAudioCapture.stop();
      nativeAudioCapture.cancel();

      await expect(stopping).resolves.toBeUndefined();
      expect(write).toHaveBeenNthCalledWith(1, '{"action":"stop"}\n');
      expect(write).toHaveBeenNthCalledWith(2, '{"action":"cancel"}\n');
      expect(state.stopPromise).toBeNull();
    } finally {
      state.process = null;
      state.active = false;
      state.target = null;
      state.pendingStart = null;
      state.pendingStop = null;
      state.stopPromise = null;
    }
  });
});
