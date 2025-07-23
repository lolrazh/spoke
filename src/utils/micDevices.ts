// src/utils/micDevices.ts
export type MicDevice = { id: string; label: string };

let currentSelected: string | undefined; // from prefs; updated via main broadcast

function mapDevices(devices: MediaDeviceInfo[]): MicDevice[] {
  const mics: MicDevice[] = [];
  // Always include a synthetic "default" device at top.
  mics.push({ id: "default", label: "System Default" });
  for (const d of devices) {
    if (d.kind === "audioinput") {
      mics.push({ id: d.deviceId, label: d.label || "Microphone" });
    }
  }
  return mics;
}

export function initMicDevicesBridge(defaultSelected?: string) {
  console.log("[MicDevices] Initializing mic devices bridge...");
  currentSelected = defaultSelected;

  // Don't do initial device enumeration here - let useTranscription handle it
  // This avoids the double discovery issue where we send incomplete device info first

  // Listen for device changes - but let useTranscription handle the enumeration
  navigator.mediaDevices.addEventListener("devicechange", () => {
    console.log(
      "[MicDevices] Device change detected, but letting useTranscription handle enumeration",
    );
  });

  // Listen for selection change from main
  window.mic?.onSelectedChanged(({ id }) => {
    console.log("[MicDevices] Selection changed to:", id);
    currentSelected = id;
  });

  console.log("[MicDevices] ✅ Mic devices bridge initialized");
}
