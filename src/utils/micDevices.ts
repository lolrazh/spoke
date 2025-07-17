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

async function refreshDevices() {
  try {
    console.log("[MicDevices] Enumerating devices...");
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = mapDevices(devices);
    console.log("[MicDevices] Found devices:", mics);
    window.mic?.updateDevices(mics, currentSelected);
  } catch (err) {
    console.warn("[MicDevices] enumerateDevices failed", err);
    window.mic?.updateDevices([{ id: "default", label: "System Default" }], currentSelected);
  }
}

export function initMicDevicesBridge(defaultSelected?: string) {
  console.log("[MicDevices] Initializing mic devices bridge...");
  currentSelected = defaultSelected;
  
  // Initial device enumeration
  refreshDevices();
  
  // Listen for device changes
  navigator.mediaDevices.addEventListener("devicechange", () => {
    console.log("[MicDevices] Device change detected, refreshing...");
    refreshDevices();
  });
  
  // Listen for selection change from main
  window.mic?.onSelectedChanged(({ id }) => {
    console.log("[MicDevices] Selection changed to:", id);
    currentSelected = id;
  });
  
  console.log("[MicDevices] ✅ Mic devices bridge initialized");
} 