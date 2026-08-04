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
    const session = new NativePcmCaptureSession({
      onPcmFrame: (frame) => received.push(frame),
    });

    await session.start();
    onFrame(new Uint8Array([0, 0, 0xff, 0x7f]));
    const captured = await session.stop();

    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(received).toHaveLength(1);
    expect(Array.from(received[0])).toEqual([0, 32767]);
    expect(Array.from(captured.pcm16)).toEqual([0, 32767]);
    expect(captured.sampleRateHz).toBe(16000);
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

    const session = new NativePcmCaptureSession({ onError: reportError });
    onFrame(new Uint8Array([0]));

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("invalid PCM16") }),
    );
    expect(onStopped).not.toBeNull();
    expect(onError).not.toBeNull();
  });
});
