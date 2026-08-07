import { afterEach, describe, expect, it, vi } from "vitest";

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => "/repo"),
}));
const originalResourcesPath = process.resourcesPath;

vi.mock("electron", () => ({ app: electronApp }));

import {
  getAudioCapturePath,
  nativeAudioCapture,
  NATIVE_AUDIO_STOP_TIMEOUT_MS,
} from "./audioCapture";

type TestNativeAudioCaptureState = {
  process: {
    stdin: {
      destroyed: boolean;
      write: ReturnType<typeof vi.fn>;
    };
    killed?: boolean;
    kill?: ReturnType<typeof vi.fn>;
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

  it("force-terminates a helper that never acknowledges stop", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const state = nativeAudioCapture as unknown as TestNativeAudioCaptureState;
    state.process = {
      stdin: {
        destroyed: false,
        write: vi.fn(),
      },
      killed: false,
      kill,
    };
    state.active = true;

    try {
      const stopping = nativeAudioCapture.stop();
      const stopped = expect(stopping).rejects.toThrow(
        "did not acknowledge stop",
      );
      await vi.advanceTimersByTimeAsync(NATIVE_AUDIO_STOP_TIMEOUT_MS);

      await stopped;
      expect(kill).toHaveBeenCalledWith("SIGKILL");
      expect(state.process).toBeNull();
      expect(state.active).toBe(false);
      expect(state.stopPromise).toBeNull();
    } finally {
      vi.useRealTimers();
      state.process = null;
      state.active = false;
      state.target = null;
      state.pendingStart = null;
      state.pendingStop = null;
      state.stopPromise = null;
    }
  });
});
