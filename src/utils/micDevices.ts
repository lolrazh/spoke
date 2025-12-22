// src/utils/micDevices.ts
// (No imports needed)

export function initMicDevicesBridge() {
  // Initialize
  // Don't do initial device enumeration here - let useTranscription handle it
  // This avoids the double discovery issue where we send incomplete device info first

  // Listen for device changes - but let useTranscription handle the enumeration
  navigator.mediaDevices.addEventListener("devicechange", () => {
    // Device change detected
  });

  // Listen for selection change from main
  window.mic?.onSelectedChanged(({ id }) => {
    // Selection changed
  });

  // Initialized
}
