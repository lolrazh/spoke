export type MicrophoneDevice = { id: string; label: string };

export const DEFAULT_MICROPHONE: MicrophoneDevice = {
  id: "default",
  label: "System Default",
};

/**
 * Prefer stable Core Audio UIDs on macOS. Browser device IDs are intentionally
 * opaque and are not valid Core Audio device identifiers for native capture.
 */
export async function discoverMicrophoneDevices(): Promise<MicrophoneDevice[]> {
  try {
    const nativeDevices = await window.audioCapture?.listDevices?.();
    if (nativeDevices?.length) {
      return [
        DEFAULT_MICROPHONE,
        ...nativeDevices.filter((device) => device.id !== "default"),
      ];
    }
  } catch {
    // Fall back to browser enumeration for tests, non-macOS, and older builds.
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const browserDevices = devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        id: device.deviceId || DEFAULT_MICROPHONE.id,
        label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
      }));

    return [
      DEFAULT_MICROPHONE,
      ...browserDevices.filter((device) => device.id !== "default"),
    ];
  } catch {
    return [DEFAULT_MICROPHONE];
  }
}
