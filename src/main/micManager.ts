/**
 * Microphone Manager
 *
 * Manages the microphone device list, selection, and notification to
 * renderer windows. Persists selection to disk via preference I/O.
 */

import { BrowserWindow } from "electron";
import type { MicDevice, MicPreferences } from "../types/shared";
import { saveMicPreferences } from "./preferences";

// ── Internal state ─────────────────────────────────────────────────────

let micDevices: MicDevice[] = [{ id: "default", label: "System Default" }];
let micPreferences: MicPreferences = {};
let onMenuRebuild: (() => void) | null = null;

// ── Initialization ─────────────────────────────────────────────────────

export function initMicManager(
  prefs: MicPreferences,
  rebuildTrayMenu: () => void,
): void {
  micPreferences = prefs;
  onMenuRebuild = rebuildTrayMenu;
}

// ── Accessors ──────────────────────────────────────────────────────────

export function getMicDevices(): MicDevice[] {
  return micDevices;
}

export function getSelectedMicId(): string {
  return micPreferences.selectedMicId || "default";
}

// ── Actions ────────────────────────────────────────────────────────────

export function updateMicDevices(devices: MicDevice[]): void {
  console.log("[MicMgmt] Updating device list:", devices);

  const defaultDevice = { id: "default", label: "System Default" };
  const otherDevices = devices.filter((d) => d.id !== "default");
  micDevices = [defaultDevice, ...otherDevices];

  console.log("[MicMgmt] Final device list with default:", micDevices);

  // Validate current selection still exists
  if (
    micPreferences.selectedMicId &&
    !micDevices.find((d) => d.id === micPreferences.selectedMicId)
  ) {
    console.log(
      "[MicMgmt] Selected device no longer available, resetting to default",
    );
    micPreferences.selectedMicId = "default";
    saveMicPreferences(micPreferences);
  }

  onMenuRebuild?.();
  broadcastMicSelection();
}

export function selectMicDevice(deviceId: string): void {
  console.log("[MicMgmt] Selecting device:", deviceId);

  if (deviceId !== "default" && !micDevices.find((d) => d.id === deviceId)) {
    console.error("[MicMgmt] Device not found:", deviceId);
    return;
  }

  micPreferences.selectedMicId = deviceId;
  saveMicPreferences(micPreferences);

  onMenuRebuild?.();
  broadcastMicSelection();
}

function broadcastMicSelection(): void {
  const selectedId = micPreferences.selectedMicId || "default";
  console.log("[MicMgmt] Broadcasting selection:", selectedId);

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("mic:selected-changed", { id: selectedId });
  });
}
