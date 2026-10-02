import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true })),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: ipc.exposeInMainWorld },
  ipcRenderer: ipc,
}));

import "./preload";

const capture = ipc.exposeInMainWorld.mock.calls.find(([name]) => name === "audioCapture")![1] as NonNullable<Window["audioCapture"]>;

describe("native capture preload ownership", () => {
  beforeEach(() => {
    ipc.invoke.mockClear();
    ipc.on.mockClear();
    ipc.removeListener.mockClear();
  });

  it("includes the session ID in each lifecycle request", async () => {
    await capture.start("current");
    await capture.stop("current");
    await capture.cancel("current");
    expect(ipc.invoke.mock.calls).toEqual([
      ["audio-capture:start", "current"],
      ["audio-capture:stop", "current"],
      ["audio-capture:cancel", "current"],
    ]);
  });

  it("rejects late frames, levels and errors from a previous capture", () => {
    const frame = vi.fn();
    const level = vi.fn();
    const error = vi.fn();
    const removers = [
      capture.onFrame(frame, "current"),
      capture.onLevel!(level, "current"),
      capture.onError(error, "current"),
    ];
    const events = ipc.on.mock.calls.map(([channel, callback]) => {
      const payload = channel === "audio-capture:frame" ? new Uint8Array([0, 0]) :
        channel === "audio-capture:level" ? 0.01 : "microphone disconnected";
      return { callback, payload };
    });
    events.forEach(({ callback, payload }) => callback({}, payload, "previous"));
    expect(frame).not.toHaveBeenCalled();
    expect(level).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    events.forEach(({ callback, payload }) => callback({}, payload, "current"));
    expect(frame).toHaveBeenCalledOnce();
    expect(level).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    removers.forEach((remove) => remove());
    expect(ipc.removeListener.mock.calls).toEqual(ipc.on.mock.calls);
  });

  it("ignores a stopped event from a previous capture", () => {
    const stopped = vi.fn();
    capture.onStopped(stopped, "current");
    const listener = ipc.on.mock.calls[0][1];
    listener({}, "previous");
    expect(stopped).not.toHaveBeenCalled();
    listener({}, "current");
    expect(stopped).toHaveBeenCalledOnce();
  });
});
