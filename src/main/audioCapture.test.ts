import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const spawnHelper = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnHelper, default: { spawn: spawnHelper } }));
vi.mock("node:fs", () => ({ existsSync: () => true, default: { existsSync: () => true } }));

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
  NATIVE_AUDIO_START_TIMEOUT_MS,
  NativeAudioCaptureManager,
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
    const kill = vi.fn();
    state.process = {
      stdin: {
        destroyed: false,
        write,
      },
      kill,
    };
    state.active = true;

    try {
      const stopping = nativeAudioCapture.stop();
      nativeAudioCapture.cancel();

      await expect(stopping).resolves.toBeUndefined();
      expect(write).toHaveBeenNthCalledWith(1, '{"action":"stop"}\n');
      expect(kill).toHaveBeenCalledWith("SIGKILL");
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
        undefined,
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

  it("forwards a meter packet independently and ignores malformed levels", () => {
    const state = nativeAudioCapture as unknown as {
      stdoutBuffer: Buffer;
      target: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } | null;
      handleStdout: (chunk: Buffer) => void;
    };
    const send = vi.fn();
    state.stdoutBuffer = Buffer.alloc(0);
    state.target = { isDestroyed: () => false, send };
    const packet = Buffer.alloc(9);
    packet.writeUInt32BE(5, 0);
    packet[4] = 6;
    packet.writeFloatLE(0.025, 5);
    try {
      state.handleStdout(packet);
      expect(send).toHaveBeenCalledWith("audio-capture:level", expect.closeTo(0.025), undefined);
      packet.writeFloatLE(NaN, 5);
      state.handleStdout(packet);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      state.stdoutBuffer = Buffer.alloc(0);
      state.target = null;
    }
  });
});

function helper() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { destroyed: false, write: vi.fn() },
    killed: false,
    kill: vi.fn(() => { child.killed = true; return true; }),
  });
  return child;
}

function owner() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  });
}

function emit(child: ReturnType<typeof helper>, type: number, payload = Buffer.alloc(0)) {
  const packet = Buffer.alloc(5 + payload.length);
  packet.writeUInt32BE(1 + payload.length);
  packet[4] = type;
  payload.copy(packet, 5);
  child.stdout.emit("data", packet);
}

describe("native capture ownership", () => {
  let manager: NativeAudioCaptureManager;
  let children: ReturnType<typeof helper>[];
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
    manager = new NativeAudioCaptureManager();
    children = [];
    spawnHelper.mockImplementation(() => {
      const child = helper();
      children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    });
  });

  afterEach(() => {
    manager.cancel();
    vi.useRealTimers();
    Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  });

  async function acknowledgeStart(child: ReturnType<typeof helper>) {
    emit(child, 1);
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalledWith(
      '{"action":"start","deviceId":"default"}\n',
    ));
    emit(child, 2);
  }

  it("reserves capture while the helper is still booting", async () => {
    const target = owner() as unknown as WebContents;
    const starting = manager.start(target, "default", "first");
    await expect(manager.start(target, "default", "second")).rejects.toThrow("already running");
    expect(children).toHaveLength(1);
    await acknowledgeStart(children[0]);
    await starting;
  });

  it("cancels booting capture and ignores late events from the retired helper", async () => {
    const target = owner();
    const starting = manager.start(target as unknown as WebContents, "default", "first");
    const rejected = expect(starting).rejects.toThrow("cancelled");
    manager.cancel(target as unknown as WebContents, "first");
    const next = manager.start(target as unknown as WebContents, "default", "second");
    emit(children[0], 1);
    emit(children[0], 2);
    emit(children[0], 4);
    children[0].emit("close", null, "SIGKILL");
    await rejected;
    await acknowledgeStart(children[1]);
    await next;
    expect(children[0].stdin.write).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
    expect(children[1].killed).toBe(false);
    await expect(manager.start(target as unknown as WebContents, "default", "third")).rejects.toThrow("already running");
  });

  it("does not report success if cancel wins just after native start", async () => {
    const target = owner() as unknown as WebContents;
    const starting = manager.start(target, "default", "first");
    const rejected = expect(starting).rejects.toThrow("cancelled");
    emit(children[0], 1);
    await vi.waitFor(() => expect(children[0].stdin.write).toHaveBeenCalled());
    emit(children[0], 2);
    manager.cancel(target, "first");
    const next = manager.start(target, "default", "second");
    await rejected;
    await acknowledgeStart(children[1]);
    await next;
    expect(children[1].killed).toBe(false);
  });

  it("rejects startup if the helper exits before ready, including a clean exit", async () => {
    const target = owner() as unknown as WebContents;
    const starting = manager.start(target, "default", "first");
    const rejected = expect(starting).rejects.toThrow("exited with code 0");
    children[0].emit("close", 0, null);
    await rejected;
    const next = manager.start(target, "default", "second");
    await acknowledgeStart(children[1]);
    await next;
  });

  it.each(["reload", "render-process-gone", "destroyed"])(
    "releases the microphone on %s and permits the next recording", async (event) => {
      const target = owner();
      const starting = manager.start(target as unknown as WebContents, "default", "first");
      await acknowledgeStart(children[0]);
      await starting;
      if (event === "reload") target.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      else target.emit(event);
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      expect(target.listenerCount("destroyed")).toBe(0);
      const next = manager.start(target as unknown as WebContents, "default", "second");
      await acknowledgeStart(children[1]);
      await next;
    },
  );

  it("does not cancel on same-document or subframe navigation", async () => {
    const target = owner();
    const starting = manager.start(target as unknown as WebContents, "default", "first");
    await acknowledgeStart(children[0]);
    await starting;
    target.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    target.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    expect(children[0].killed).toBe(false);
  });

  it("does not let stale sessions or other windows stop a newer capture", async () => {
    const target = owner() as unknown as WebContents;
    const starting = manager.start(target, "default", "current");
    await acknowledgeStart(children[0]);
    await starting;
    manager.cancel(target, "old");
    manager.cancel(owner() as unknown as WebContents, "current");
    await manager.stop(target, "old");
    expect(children[0].killed).toBe(false);
    expect(children[0].stdin.write).toHaveBeenCalledOnce();
    emit(children[0], 3, Buffer.from([0, 0]));
    expect(target.send).toHaveBeenCalledWith("audio-capture:frame", Buffer.from([0, 0]), "current");
  });

  it.each(["capture-error", "process-error", "close"])(
    "clears a failed capture after %s and allows a retry", async (event) => {
      const target = owner();
      const starting = manager.start(target as unknown as WebContents, "default", "first");
      await acknowledgeStart(children[0]);
      await starting;
      if (event === "capture-error") emit(children[0], 5, Buffer.from("microphone disconnected"));
      else if (event === "process-error") children[0].emit("error", new Error("helper failed"));
      else children[0].emit("close", 1, null);
      expect(target.send).toHaveBeenCalledWith("audio-capture:error", expect.any(String), "first");
      const next = manager.start(target as unknown as WebContents, "default", "second");
      await acknowledgeStart(children[1]);
      await next;
    },
  );

  it("bounds a stuck startup and releases its native helper", async () => {
    vi.useFakeTimers();
    const target = owner() as unknown as WebContents;
    const starting = manager.start(target, "default", "first");
    const rejected = expect(starting).rejects.toThrow("acknowledge start");
    await vi.advanceTimersByTimeAsync(NATIVE_AUDIO_START_TIMEOUT_MS);
    await rejected;
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    const next = manager.start(target, "default", "second");
    emit(children[1], 1);
    await vi.advanceTimersByTimeAsync(0);
    emit(children[1], 2);
    await next;
  });
});
