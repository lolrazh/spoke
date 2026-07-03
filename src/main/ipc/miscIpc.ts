/**
 * Misc IPC
 *
 * Everything that doesn't fit the other IPC groups: focused-selection
 * inspection, screenshot capture (for OCR context), microphone device
 * management, the generic show-notification relay, and the
 * power-monitor-driven background update-check trigger.
 */

import { ipcMain, powerMonitor, type IpcMainEvent } from "electron";

import type { MicDevice, SelectionInspectSnapshot } from "../../types/shared";
import { captureScreenshot, testScreenshotCapture } from "../../utils/screenshot";
import {
  inspectFocusedSelection,
  type SelectionInspectOptions,
} from "../selectionInspect";
import {
  getSelectedMicId,
  updateMicDevices,
  selectMicDevice,
} from "../micManager";
import { scheduleUpdateCheck, jitterMs } from "../updateController";
import { state } from "../windowState";

export function registerMiscIpc(): void {
  ipcMain.handle(
    "selection:inspect",
    async (_event, payload?: SelectionInspectOptions) => {
      const contextChars =
        payload &&
        typeof payload === "object" &&
        typeof payload.contextChars === "number"
          ? payload.contextChars
          : undefined;
      try {
        return await inspectFocusedSelection({ contextChars });
      } catch (error) {
        return {
          ok: false,
          status: "exception",
          range: null,
          selectedText: null,
          context: null,
          valueLength: null,
          hadSelection: false,
          source: "none",
          rawOutput: "",
          error: (error as Error)?.message ?? "Selection inspection failed",
        } satisfies SelectionInspectSnapshot;
      }
    },
  );

  // Screenshot capture for OCR context (Phase 1)
  ipcMain.handle("screenshot:capture", async (_event, options) => {
    try {
      const result = await captureScreenshot(options);
      console.log(
        `[Screenshot] Captured in ${result.captureTimeMs}ms, size: ${result.sizeKb}KB`,
      );
      return { success: true, ...result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Screenshot] Capture failed:", errorMsg);
      return { success: false, error: errorMsg };
    }
  });

  // Screenshot test handler (for PoC performance testing)
  ipcMain.handle("screenshot:test", async () => {
    try {
      return await testScreenshotCapture();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Screenshot Test] Failed:", errorMsg);
      return { success: false, error: errorMsg };
    }
  });

  // Microphone management IPC handlers
  ipcMain.on(
    "mic:devices-update",
    (_event, payload: { devices: MicDevice[]; selectedId?: string }) => {
      console.log("[IPC] Received microphone devices update:", payload);
      updateMicDevices(payload.devices);
    },
  );

  ipcMain.handle("mic:select", (_event, payload: { id: string }) => {
    console.log("[IPC] Received microphone selection:", payload.id);
    try {
      selectMicDevice(payload.id);
      return { ok: true };
    } catch (error) {
      console.error("[IPC] Failed to select microphone:", error);
      return { ok: false };
    }
  });

  ipcMain.handle("mic:get-selected", () => {
    const selectedId = getSelectedMicId();
    return { id: selectedId };
  });

  ipcMain.on(
    "show-notification",
    (
      _event: IpcMainEvent,
      payload:
        | string
        | {
            message: string;
            actionId?: string | null;
          },
    ) => {
      const next =
        typeof payload === "string"
          ? { message: payload, actionId: null }
          : {
              message: payload?.message ?? "",
              actionId:
                typeof payload?.actionId === "string" ? payload.actionId : null,
            };
      console.log(
        `[IPC Main] Received show-notification request, forwarding to renderer: ${next.message}${
          next.actionId ? ` (action=${next.actionId})` : ""
        }`,
      );
      state.mainWindow?.webContents.send("notify", next);
    },
  );

  // Background triggers for update checks
  try {
    powerMonitor.on("resume", () => {
      // Check ~60s after wake with jitter
      scheduleUpdateCheck(jitterMs(60_000, 0.2), "resume", true);
    });
  } catch {}
  // Note: network regain detection is renderer-friendly via navigator.onLine.
  // Main process lacks a stable 'online' event; we rely on periodic checks + resume.
}
