import { afterEach, describe, expect, it, vi } from "vitest";
import { NativePcmCaptureSession } from "./nativePcmCaptureSession";

describe("NativePcmCaptureSession", () => {
  const originalBridge = window.audioCapture;

  afterEach(() => {
    window.audioCapture = originalBridge;
  });

  it("converts streamed little-endian bytes and waits for the stopped event", async () => {
    let onFrame = (_payload: Uint8Array): void => {};
    let onStopped: (() => void) | null = null;
    let onError: ((message: string) => void) | null = null;
    const start = vi.fn(async () => ({ ok: true }));
    const stop = vi.fn(async () => {
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
    expect(received).toHaveLength(2);
    expect(Array.from(received[0])).toEqual([0, 32767]);
    expect(Array.from(received[1])).toEqual([819, 819]);
    expect(levels).toHaveLength(2);
    expect(levels[1]).toBeCloseTo((819 / 32768) * 4 * 3, 6);
    expect(Array.from(captured.pcm16)).toEqual([0, 32767, 819, 819]);
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
