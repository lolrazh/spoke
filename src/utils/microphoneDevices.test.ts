import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MICROPHONE,
  discoverMicrophoneDevices,
} from "./microphoneDevices";

describe("discoverMicrophoneDevices", () => {
  const originalBridge = window.audioCapture;

  afterEach(() => {
    window.audioCapture = originalBridge;
  });

  it("prefers native Core Audio IDs when available", async () => {
    const enumerateDevices = vi.spyOn(
      navigator.mediaDevices,
      "enumerateDevices",
    );
    window.audioCapture = {
      isAvailable: async () => true,
      listDevices: vi.fn(async () => [
        { id: "core-audio-uid", label: "Built-in Microphone" },
      ]),
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      onFrame: () => () => {},
      onStopped: () => () => {},
      onError: () => () => {},
    };

    const devices = await discoverMicrophoneDevices();

    expect(devices).toEqual([
      DEFAULT_MICROPHONE,
      { id: "core-audio-uid", label: "Built-in Microphone" },
    ]);
    expect(enumerateDevices).not.toHaveBeenCalled();
    enumerateDevices.mockRestore();
  });

  it("falls back to browser IDs when native devices are unavailable", async () => {
    window.audioCapture = undefined;
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, "enumerateDevices")
      .mockResolvedValueOnce([
        {
          deviceId: "browser-id",
          kind: "audioinput",
          label: "Browser Microphone",
        } as MediaDeviceInfo,
      ]);

    await expect(discoverMicrophoneDevices()).resolves.toEqual([
      DEFAULT_MICROPHONE,
      { id: "browser-id", label: "Browser Microphone" },
    ]);
    enumerateDevices.mockRestore();
  });
});
