/**
 * Floating Bar Visibility
 *
 * Manages the pill window's timed hide/show behavior. Supports hiding
 * for a fixed duration (with auto-show timer) or indefinitely.
 */

import type { BrowserWindow } from "electron";
import { smoothShow, smoothHide } from "./windowAnimation";

// ── Internal state ─────────────────────────────────────────────────────

let hideTimer: NodeJS.Timeout | null = null;
let hideEndTime: number | null = null;
let enabled = true;

// ── State accessors ────────────────────────────────────────────────────

export function isFloatingBarEnabled(): boolean {
  return enabled;
}

export function setFloatingBarEnabled(value: boolean): void {
  enabled = value;
}

export function getHideEndTime(): number | null {
  return hideEndTime;
}

export function isHideTimerActive(): boolean {
  return hideTimer !== null;
}

// ── Timer management ───────────────────────────────────────────────────

export function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
    hideEndTime = null;
    console.log("[Hide Timer] Timer cleared");
  }
}

/**
 * Hide the floating bar for a specified duration or indefinitely.
 * @param win The main window to hide
 * @param minutes Number of minutes to hide, or null for indefinitely
 */
export function hideFloatingBarWithTimer(
  win: BrowserWindow | null,
  minutes: number | null,
): void {
  console.log(
    `[Hide Timer] Hiding floating bar for ${minutes ? minutes + " minutes" : "indefinitely"}`,
  );

  clearHideTimer();

  if (!win || win.isDestroyed()) return;

  smoothHide(win);

  if (minutes !== null) {
    hideEndTime = Date.now() + minutes * 60 * 1000;
    hideTimer = setTimeout(
      () => {
        console.log("[Hide Timer] Timer expired, showing floating bar");
        if (win && !win.isDestroyed()) {
          smoothShow(win);
          win.webContents.send("notify", "Floating bar shown automatically");
        }
        clearHideTimer();
      },
      minutes * 60 * 1000,
    );

    win.webContents.send(
      "notify",
      `Floating Bar Hidden for ${minutes} minutes. Use the Tray Menu to show early.`,
    );
  } else {
    enabled = false;
    win.webContents.send(
      "notify",
      "Floating Bar Hidden Indefinitely. Use the Tray Menu to show again.",
    );
  }
}
