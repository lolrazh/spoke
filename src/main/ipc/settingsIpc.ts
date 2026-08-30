/**
 * Settings IPC
 *
 * Onboarding orchestration (helper/pill prepare steps, completion,
 * step/flag persistence), the miscellaneous app-control handlers
 * (open-external, reload, app path/version), permission post-grant
 * follow-ups, onboarding window controls, and the updater handlers.
 *
 * The onboarding prefs (`onboarding.json`) are read/written with raw
 * `fs`/JSON calls here rather than through src/main/preferences.ts: that
 * module's API (load/save*Preferences) is shaped around the mic/pill/app
 * preference *files*, one function pair per file, and has no generic
 * "read/write arbitrary JSON blob at a path" entry point. Onboarding prefs
 * already had their own ad hoc path (set once in main.ts's whenReady) before
 * this decomposition, so that logic is kept together here rather than
 * force-fitting it into preferences.ts's per-file API.
 */

import { app, ipcMain, screen } from "electron";
import fs from "node:fs";

import { ISLAND_HIDDEN_Y } from "../../constants/window";
import type { PttTarget } from "../../types/shared";
import { logger } from "../../utils/logger";
import { state } from "../windowState";
import {
  createWindow,
  startFollowCursor,
  detectAndStoreNotchWidth,
  getDisplayForWindow,
  computeScaleForDisplay,
  emitActiveDisplayInfo,
  scheduleLocalSidecarPrewarm,
} from "../windows";
import { createTray } from "../tray";
import { startFnListener, startHelperIfIMGranted } from "../fnListener";
import { smoothShow } from "../windowAnimation";
import { respawnPasteDaemon } from "../pasteDaemon";
import { openExternalUrlSafely } from "../navigationGuards";
import {
  manualCheckForUpdates,
  scheduleUpdateCheck,
  getUpdateStatus,
  isUpdateReadyToInstall,
  getUpdateSnapshot,
  setDevUpdateStateForTesting,
  quitAndInstallUpdate,
  downloadUpdate,
  jitterMs,
} from "../updateController";

function persistOnboardingPrefs(): void {
  fs.writeFileSync(
    state.onboardingPrefsPath,
    JSON.stringify(state.onboardingPrefs, null, 2),
    "utf8",
  );
}

export function registerSettingsIpc(): void {
  // Onboarding IPC handlers
  ipcMain.handle("helper:start", () => {
    console.log("[IPC] Starting helper process after onboarding");
    startFnListener();
    return { success: true };
  });

  // Prepare the pill window and tray before onboarding completes
  ipcMain.handle("prepare-pill", () => {
    console.log("[IPC] Preparing pill window and tray during onboarding");
    try {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) {
        createWindow();
      }
      createTray();
      // Start continuous follow once window exists
      startFollowCursor();
      // Ensure pill is hidden until the test step asks to show it
      state.pttTarget = "main";
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        const currentBounds = state.mainWindow.getBounds();
        const display = screen.getDisplayMatching(currentBounds);
        const hideY = display.bounds.y + ISLAND_HIDDEN_Y;
        state.mainWindow.setBounds(
          {
            x: currentBounds.x,
            y: hideY,
            width: currentBounds.width,
            height: currentBounds.height,
          },
          false,
        );
      }
      return { success: true };
    } catch (error) {
      console.error("[IPC] Failed to prepare pill:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Generic external URL opener for links (https/http/mailto only)
  ipcMain.handle("open-external", async (_event, url: string) => {
    try {
      const opened = await openExternalUrlSafely(url);
      if (!opened) {
        return { ok: false, error: "URL scheme not allowed." };
      }
      return { ok: true };
    } catch (err: any) {
      console.error("[IPC] open-external failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("ptt:set-target", (_event, target: PttTarget) => {
    console.log(`[IPC] Setting PTT target to: ${target}`);
    state.pttTarget = target;
    return { success: true };
  });

  ipcMain.handle("onboarding-complete", () => {
    console.log("[IPC] Onboarding complete, starting app");
    if (state.onboardingWindow) {
      state.onboardingWindow.close();
    }
    // Persist local onboarding flag so future launches can skip onboarding entirely
    try {
      state.onboardingPrefs = {
        ...state.onboardingPrefs,
        done: true,
        currentStep: undefined,
      };
      persistOnboardingPrefs();
    } catch {}
    if (!state.mainWindow || state.mainWindow.isDestroyed()) {
      createWindow();
    } else {
      // Ensure the pill window is visible and interactive
      smoothShow(state.mainWindow);
    }
    createTray();
    // Start helper only if IM is already granted; otherwise defer
    state.pttTarget = "main";
    startHelperIfIMGranted();
    // (Removed) silent app location check after onboarding

    // Detect and store notch width if not already stored (for new users)
    if (!state.pillPreferences.notchWidth) {
      detectAndStoreNotchWidth()
        .then((width) => {
          if (width && state.mainWindow && !state.mainWindow.isDestroyed()) {
            // Re-emit display info with the newly stored width
            const display = getDisplayForWindow();
            const scale = computeScaleForDisplay(display);
            emitActiveDisplayInfo(display, scale);
          }
        })
        .catch((err) => {
          logger.main.error("[PillPrefs] Failed to detect notch width:", err);
        });
    }

    // Schedule background update check ~60s after onboarding completes (with jitter)
    scheduleUpdateCheck(jitterMs(60_000, 0.2), "post-onboarding", true);
    scheduleLocalSidecarPrewarm("post-onboarding", 250);

    // Renderer will show any post-sign-in notification; keep main focused on window.
  });

  // Get saved onboarding step
  ipcMain.handle("onboarding:get-step", () => {
    return state.onboardingPrefs.currentStep || null;
  });

  // Save current onboarding step
  ipcMain.handle("onboarding:set-step", (_event, step: string) => {
    try {
      state.onboardingPrefs = { ...state.onboardingPrefs, currentStep: step };
      persistOnboardingPrefs();
      return { ok: true };
    } catch (error) {
      console.error("[IPC] Failed to save onboarding step:", error);
      return { ok: false };
    }
  });

  // Respond to permission grants without full app restart
  ipcMain.handle(
    "permissions:post-grant",
    async (_event, type: "accessibility" | "microphone") => {
      try {
        if (type === "accessibility") {
          // Respawn paste daemon to pick up AX trust
          respawnPasteDaemon();
          return { ok: true };
        }
        if (type === "microphone") {
          // Ask pill to refresh devices list to ensure clean state
          try {
            state.mainWindow?.webContents.send("mic:refresh-devices");
          } catch {}
          return { ok: true };
        }
        return { ok: false, error: "Unknown type" };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
  );

  // Onboarding window controls
  ipcMain.handle("close-onboarding", () => {
    if (state.onboardingWindow) {
      state.onboardingWindow.close();
    }
  });

  ipcMain.handle("minimize-onboarding", () => {
    if (state.onboardingWindow) {
      state.onboardingWindow.minimize();
    }
  });

  ipcMain.handle("maximize-onboarding", () => {
    if (state.onboardingWindow) {
      if (state.onboardingWindow.isMaximized()) {
        state.onboardingWindow.unmaximize();
      } else {
        state.onboardingWindow.maximize();
      }
    }
  });

  ipcMain.handle("reload-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("get-app-path", () => {
    return app.getAppPath();
  });

  // Provide application version to renderer via preload bridge
  ipcMain.handle("app:get-version", () => {
    try {
      return app.getVersion();
    } catch (e) {
      return "";
    }
  });

  ipcMain.handle("update:get-state", () => getUpdateSnapshot());

  ipcMain.handle("update:check", async () => {
    await manualCheckForUpdates(false);
    return getUpdateSnapshot();
  });

  ipcMain.handle("update:restart", () => {
    // Guard: a stray call must not quit-to-same-version. Only install when a
    // downloaded update is actually staged and ready.
    if (!isUpdateReadyToInstall()) return { ok: false };
    quitAndInstallUpdate();
    return { ok: true };
  });

  ipcMain.handle("update:install-when-ready", async () => {
    if (isUpdateReadyToInstall()) {
      return { ok: true, snapshot: getUpdateSnapshot() };
    }

    // Starts the transfer when the engine already knows the update, including
    // resuming after a failed download attempt (no-op otherwise). Download
    // completion only marks the update ready; the explicit restart handler is
    // the only path that calls quitAndInstall().
    downloadUpdate();

    if (
      getUpdateStatus() !== "downloading" &&
      getUpdateStatus() !== "checking"
    ) {
      // Nothing cached to download (the failure was in the check itself, or
      // the state went stale). Re-check quietly; the capsule broadcasts every
      // step, so a notification here would only collapse the open panel to
      // repeat what it already shows. Chain straight into the download when
      // the check finds the update.
      await manualCheckForUpdates(true);
      if (getUpdateStatus() === "available") downloadUpdate();
    }

    return { ok: true, snapshot: getUpdateSnapshot() };
  });

  ipcMain.handle("update:dev-set-state", (_event, devState: unknown) => {
    if (
      devState !== "idle" &&
      devState !== "checking" &&
      devState !== "available" &&
      devState !== "not-available" &&
      devState !== "error" &&
      devState !== "ready"
    ) {
      return {
        ok: false,
        snapshot: getUpdateSnapshot(),
        error: "Invalid dev update state",
      };
    }
    return setDevUpdateStateForTesting(devState);
  });
}
