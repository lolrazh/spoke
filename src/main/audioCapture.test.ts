import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => "/repo"),
}));
const originalResourcesPath = process.resourcesPath;

vi.mock("electron", () => ({ app: electronApp }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));

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

  it("forwards complete native PCM packets without an extra payload copy", () => {
    const state = nativeAudioCapture as unknown as {
      stdoutBuffer: Buffer;
      target: {
        isDestroyed: () => boolean;
        send: ReturnType<typeof vi.fn>;
      } | null;
      handleStdout: (chunk: Buffer) => void;
    };
    const send = vi.fn();
    state.stdoutBuffer = Buffer.alloc(0);
    state.target = { isDestroyed: () => false, send };

    const packet = Buffer.alloc(4 + 1 + 4);
    packet.writeUInt32BE(5, 0);
    packet[4] = 3;
    packet.writeInt16LE(0x1234, 5);
    packet.writeInt16LE(-7, 7);

    try {
      state.handleStdout(packet);

      expect(send).toHaveBeenCalledWith(
        "audio-capture:frame",
        expect.any(Buffer),
      );
      const forwarded = send.mock.calls[0][1] as Buffer;
      expect(forwarded).toEqual(Buffer.from([0x34, 0x12, 0xf9, 0xff]));
      expect(forwarded.buffer).toBe(packet.buffer);
      expect(state.stdoutBuffer.byteLength).toBe(0);
      expect(state.stdoutBuffer.buffer).not.toBe(packet.buffer);
    } finally {
      state.stdoutBuffer = Buffer.alloc(0);
      state.target = null;
    }
  });
});

describe("native capture document ownership", () => {
  const manager = nativeAudioCapture as unknown as {
    process: {
      stdin: { destroyed: boolean; write: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    } | null;
    ready: Promise<void> | null;
    active: boolean;
    ensureProcess: () => Promise<void>;
    handleEvent: (type: number, payload: Buffer) => void;
  };
  function setup(ready = Promise.resolve()) {
    const owner = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    });
    const child = {
      stdin: { destroyed: false, write: vi.fn() },
      kill: vi.fn(),
    };
    manager.process = child;
    manager.ready = ready;
    vi.spyOn(manager, "ensureProcess").mockReturnValue(ready);
    return { owner, child };
  }
  afterEach(() => {
    nativeAudioCapture.cancel();
    manager.process = null;
    manager.ready = null;
    vi.restoreAllMocks();
  });
  it.each(["destroyed", "render-process-gone", "reload"])(
    "releases an active capture on %s and allows another recording",
    async (event) => {
      const { owner, child } = setup();
      const started = nativeAudioCapture.start(
        owner as unknown as WebContents,
        "default",
      );
      await Promise.resolve();
      manager.handleEvent(2, Buffer.alloc(0));
      await started;
      if (event === "reload")
        owner.emit("did-start-navigation", {
          isMainFrame: true,
          isSameDocument: false,
        });
      else owner.emit(event);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(manager.active).toBe(false);
      expect(owner.listenerCount("did-start-navigation")).toBe(0);
      const next = setup();
      const restarted = nativeAudioCapture.start(
        next.owner as unknown as WebContents,
        "default",
      );
      await Promise.resolve();
      manager.handleEvent(2, Buffer.alloc(0));
      await expect(restarted).resolves.toBeUndefined();
    },
  );
  it("reserves startup and rejects a second start before the helper is ready", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { owner } = setup(ready);
    const first = nativeAudioCapture.start(
      owner as unknown as WebContents,
      "default",
    );
    await expect(
      nativeAudioCapture.start(owner as unknown as WebContents, "default"),
    ).rejects.toThrow("already running");
    owner.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });
    release();
    await expect(first).rejects.toThrow("cancelled during startup");
    expect(manager.active).toBe(false);
  });
  it("ignores in-page and subframe navigation and removes listeners on stop", async () => {
    const { owner, child } = setup();
    const start = nativeAudioCapture.start(
      owner as unknown as WebContents,
      "default",
    );
    await Promise.resolve();
    manager.handleEvent(2, Buffer.alloc(0));
    await start;
    owner.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: true,
    });
    owner.emit("did-start-navigation", {
      isMainFrame: false,
      isSameDocument: false,
    });
    expect(child.kill).not.toHaveBeenCalled();
    const stop = nativeAudioCapture.stop();
    manager.handleEvent(4, Buffer.alloc(0));
    await stop;
    expect(owner.listenerCount("did-start-navigation")).toBe(0);
    expect(owner.listenerCount("destroyed")).toBe(0);
  });
});
