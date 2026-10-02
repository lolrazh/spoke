import { afterEach, describe, expect, it, vi } from "vitest";
import { NativePcmCaptureSession } from "./nativePcmCaptureSession";

describe("NativePcmCaptureSession", () => {
  const originalBridge = window.audioCapture;

  afterEach(() => {
    window.audioCapture = originalBridge;
  });

  function bridge() {
    const remove = vi.fn();
    const api = {
      isAvailable: vi.fn(async () => true),
      listDevices: vi.fn(async () => []),
      start: vi.fn(async (_sessionId: string) => ({ ok: true })),
      stop: vi.fn(async (_sessionId: string) => ({ ok: true })),
      cancel: vi.fn(async (_sessionId: string) => ({ ok: true })),
      onFrame: vi.fn(() => remove),
      onLevel: vi.fn(() => remove),
      onStopped: vi.fn(() => remove),
      onError: vi.fn(() => remove),
    };
    window.audioCapture = api;
    return { api, remove };
  }

  it("releases subscriptions when native start rejects", async () => {
    const { api, remove } = bridge();
    api.start.mockRejectedValueOnce(new Error("microphone unavailable"));
    const session = new NativePcmCaptureSession();
    await expect(session.start()).rejects.toThrow("microphone unavailable");
    expect(remove).toHaveBeenCalledTimes(4);
    expect(api.cancel).toHaveBeenCalledWith(api.start.mock.calls[0][0]);
    session.cancel();
    expect(api.cancel).toHaveBeenCalledOnce();
  });

  it("cancels startup immediately and does not cancel again after a late acknowledgement", async () => {
    const { api } = bridge();
    let resolveStart!: (value: { ok: boolean }) => void;
    api.start.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    const first = new NativePcmCaptureSession();
    const starting = first.start();
    const rejected = expect(starting).rejects.toThrow("cancelled");
    first.cancel();
    expect(api.cancel).toHaveBeenCalledOnce();
    const second = new NativePcmCaptureSession();
    await second.start();
    expect(api.start.mock.calls[0][0]).not.toBe(api.start.mock.calls[1][0]);
    resolveStart({ ok: true });
    await rejected;
    first.cancel();
    expect(api.cancel).toHaveBeenCalledOnce();
    second.cancel();
    expect(api.cancel).toHaveBeenLastCalledWith(api.start.mock.calls[1][0]);
  });

  it("finishes cleanup when stop IPC resolves without a renderer stopped event", async () => {
    const { api, remove } = bridge();
    const session = new NativePcmCaptureSession();
    await session.start();
    await session.stop();
    expect(api.stop).toHaveBeenCalledWith(api.start.mock.calls[0][0]);
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it("releases native capture if stop arrives before startup completes", async () => {
    const { api } = bridge();
    let resolveStart!: (value: { ok: boolean }) => void;
    api.start.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    const session = new NativePcmCaptureSession();
    const starting = session.start();
    const rejected = expect(starting).rejects.toThrow("cancelled");
    await session.stop();
    expect(api.cancel).toHaveBeenCalledOnce();
    resolveStart({ ok: true });
    await rejected;
    expect(api.cancel).toHaveBeenCalledOnce();
  });

  it("keeps the final native flush frame before the stopped event", async () => {
    let onFrame = (_payload: Uint8Array): void => {};
    let onStopped: (() => void) | null = null;
    let onError: ((message: string) => void) | null = null;
    const start = vi.fn(async () => ({ ok: true }));
    const stop = vi.fn(async () => {
      onFrame(new Uint8Array([0x2a, 0x00]));
      onStopped?.();
      return { ok: true };
    });
    const cancel = vi.fn(async () => ({ ok: true }));

    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: async () => [],
      start,
      stop,
      cancel,
      onFrame: (callback) => {
        onFrame = callback;
        return () => {
          onFrame = () => {};
        };
      },
      onStopped: (callback) => {
        onStopped = callback;
        return () => {
          onStopped = null;
        };
      },
      onError: (callback) => {
        onError = callback;
        return () => {
          onError = null;
        };
      },
    };

    const received: Int16Array[] = [];
    const levels: number[] = [];
    const session = new NativePcmCaptureSession({
      onPcmFrame: (frame) => received.push(frame),
      onAudioLevel: (level) => levels.push(level),
    });

    await session.start();
    onFrame(new Uint8Array([0, 0, 0xff, 0x7f]));
    onFrame(new Uint8Array([0x33, 0x03, 0x33, 0x03]));
    const captured = await session.stop();

    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(received).toHaveLength(3);
    expect(Array.from(received[0])).toEqual([0, 32767]);
    expect(Array.from(received[1])).toEqual([819, 819]);
    expect(levels).toHaveLength(3);
    expect(levels[1]).toBeCloseTo(819 / 32768, 6);
    expect(Array.from(captured.pcm16)).toEqual([0, 32767, 819, 819, 42]);
    expect(captured.sampleRateHz).toBe(16000);
    expect(onError).toBeNull();
  });

  it("keeps decoding correct for an unaligned byte view", () => {
    let onFrame = (_payload: Uint8Array): void => {};

    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: async () => [],
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      onFrame: (callback) => {
        onFrame = callback;
        return () => {
          onFrame = () => {};
        };
      },
      onStopped: () => () => {},
      onError: () => () => {},
    };

    const received: Int16Array[] = [];
    new NativePcmCaptureSession({ onPcmFrame: (frame) => received.push(frame) });

    const backing = new Uint8Array([0xaa, 0, 0, 0xff, 0x7f, 0xbb]);
    onFrame(backing.subarray(1, 5));

    expect(Array.from(received[0])).toEqual([0, 32767]);
  });

  it("uses independent meter events without replacing PCM or publishing after cancel", () => {
    let frame = (_payload: Uint8Array) => {};
    let level = (_rms: number) => {};
    const removeLevel = vi.fn();
    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: async () => [],
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      onFrame: (callback) => { frame = callback; return () => {}; },
      onLevel: (callback) => { level = callback; return removeLevel; },
      onStopped: () => () => {},
      onError: () => () => {},
    };
    const onAudioLevel = vi.fn();
    const onPcmFrame = vi.fn();
    const session = new NativePcmCaptureSession({ onAudioLevel, onPcmFrame });
    level(0.01);
    level(0.03);
    frame(new Uint8Array([0, 0, 0xff, 0x7f]));
    expect(onAudioLevel.mock.calls).toEqual([[0.01], [0.03]]);
    expect(Array.from(onPcmFrame.mock.calls[0][0])).toEqual([0, 32767]);
    session.cancel();
    level(0.1);
    expect(onAudioLevel).toHaveBeenCalledTimes(2);
    expect(removeLevel).toHaveBeenCalledOnce();
  });

  it("settles a pending stop when cancellation races with it", async () => {
    let onStopped: (() => void) | null = null;
    let onError: ((message: string) => void) | null = null;
    let resolveStop: (() => void) | null = null;
    const stop = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveStop = () => resolve({ ok: true });
        }),
    );
    const cancel = vi.fn(async () => {
      resolveStop?.();
      return { ok: true };
    });

    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: async () => [],
      start: async () => ({ ok: true }),
      stop,
      cancel,
      onFrame: (_callback) => () => {},
      onStopped: (callback) => {
        onStopped = callback;
        return () => {
          onStopped = null;
        };
      },
      onError: (callback) => {
        onError = callback;
        return () => {
          onError = null;
        };
      },
    };

    const session = new NativePcmCaptureSession();
    await session.start();
    const stopping = session.stop();

    session.cancel();

    const captured = await stopping;
    expect(stop).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(captured.pcm16).toHaveLength(0);
    expect(onStopped).toBeNull();
    expect(onError).toBeNull();
  });

  it("reports malformed native frames without passing them downstream", () => {
    let onFrame = (_payload: Uint8Array): void => {};
    let onStopped: (() => void) | null = null;
    let onError: ((message: string) => void) | null = null;
    const reportError = vi.fn();

    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: async () => [],
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      onFrame: (callback) => {
        onFrame = callback;
        return () => {
          onFrame = () => {};
        };
      },
      onStopped: (callback) => {
        onStopped = callback;
        return () => {
          onStopped = null;
        };
      },
      onError: (callback) => {
        onError = callback;
        return () => {
          onError = null;
        };
      },
    };

    new NativePcmCaptureSession({ onError: reportError });
    onFrame(new Uint8Array([0]));

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("invalid PCM16") }),
    );
    expect(onStopped).not.toBeNull();
    expect(onError).not.toBeNull();
  });
});
