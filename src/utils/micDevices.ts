// src/utils/micDevices.ts
// (No imports needed)

export function initMicDevicesBridge() {
  console.log("[MicDevices] Initializing mic devices bridge...");
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
  });

  console.log("[MicDevices] ✅ Mic devices bridge initialized");
}
