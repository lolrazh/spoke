import {
  app,
  BrowserWindow,
  screen,
  session,
  globalShortcut,
  Notification,
} from "electron";
// 'net' is imported via eval'd require to avoid bundling issues when unused
import path from "node:path";
import process from "node:process";
import { execSync } from "child_process";
import fs from "node:fs";

import { logger } from "./utils/logger";
import { initProviderStore } from "./main/providerStore";
import {
  stopLocalSidecar,
  syncLocalSidecarForCurrentProvider,
} from "./main/localSttLifecycle";
import { initModelManager } from "./main/modelManager";
import { registerPermissionHandlers } from "./main/permissions";
import {
  initPreferences,
  loadMicPreferences,
  loadPillPreferences,
  loadAppPreferences,
} from "./main/preferences";
import { initMicManager } from "./main/micManager";
import { killPasteDaemon } from "./main/pasteDaemon";
import { fnHelpers, pasteHelpers } from "./main/helperProcess";
import {
  startHelperIfIMGranted,
  clearFnRestartTimer,
} from "./main/fnListener";
import {
  initUpdateController,
  scheduleUpdateCheck,
  jitterMs,
} from "./main/updateController";
import { bootTimeline } from "./main/bootTimeline";
import { installMainConsoleFileSink } from "./main/diagnosticLog";
import { state } from "./main/windowState";
import {
  createWindow,
  createOnboardingWindow,
  registerWindowLifecycleIpc,
  registerDisplayChangeListeners,
  startFollowCursor,
  stopFollowCursor,
  getDisplayForWindow,
  computeScaleForDisplay,
  emitActiveDisplayInfo,
  detectAndStoreNotchWidth,
} from "./main/windows";
import { rebuildTrayMenu } from "./main/tray";
import { pasteLastTranscript } from "./main/pasteOrchestrator";
import {
  registerInsertTextAtCursorIpc,
  registerTranscriptIpc,
} from "./main/ipc/transcriptIpc";
import { registerWindowIpc } from "./main/ipc/windowIpc";
import { registerSttIpc } from "./main/ipc/sttIpc";
import { registerSettingsIpc } from "./main/ipc/settingsIpc";
import { registerMiscIpc } from "./main/ipc/miscIpc";

bootTimeline.configure({
  enabled: !app.isPackaged || process.env.SF_BOOT_TIMELINE === "1",
});
bootTimeline.mark("main:module-loaded", {
  packaged: app.isPackaged,
  pid: process.pid,
});

// Disable Chromium's HTTP cache. Must be set before app is ready — command
// line switches appended after that point are silently ignored.
app.commandLine.appendSwitch("disable-http-cache");

// Ensure a single running app instance.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus existing window when a second instance is launched
    const targetWindow = state.mainWindow || state.onboardingWindow;
    if (targetWindow && !targetWindow.isDestroyed()) {
      if (!targetWindow.isVisible()) targetWindow.show();
      targetWindow.focus();
    }
  });
}

// Dev helper: allow skipping onboarding for faster iteration
const SKIP_ONBOARDING =
  process.env.SKIP_ONBOARDING === "1" || process.env.SKIP_ONBOARDING === "true";

// Dev helper: force-show onboarding every launch (ignore local done flag)
const FORCE_ONBOARDING =
  process.env.FORCE_ONBOARDING === "1" ||
  process.env.FORCE_ONBOARDING === "true";

// Show windows only after their own renderers signal they are visually ready,
// and forward renderer boot-timeline marks. Registered at module load (not
// inside app.whenReady()) to match the original evaluation order.
registerWindowLifecycleIpc();
registerInsertTextAtCursorIpc();

// Preference checking for first run
// Removed onboarding persistence - always show onboarding

app.whenReady().then(async () => {
  installMainConsoleFileSink();
  bootTimeline.mark("app:when-ready");
  // Initialize preferences and provider store
  const userDataPath = app.getPath("userData");
  bootTimeline.measureSync("startup:init-preferences", () => {
    initPreferences(userDataPath);
    initProviderStore(userDataPath);
  });
  bootTimeline.measureSync("startup:init-model-manager", () => {
    // Broadcast model events to every window. The model install runs during
    // onboarding, which lives in its own window (state.onboardingWindow) — sending
    // only to state.mainWindow meant the onboarding progress bar received almost no
    // updates and appeared to jump straight from ~0% to done.
    const broadcastToAllWindows = (channel: string, payload: unknown) => {
      try {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) window.webContents.send(channel, payload);
        });
      } catch {}
    };

    // Throttle high-frequency download chunks (~thousands for a 442MB file),
    // but always emit the endpoints so the bar reliably reaches 0% and 100%.
    // Keyed per modelId so concurrent installs don't starve each other's bars.
    const lastProgressEmit = new Map<string, number>();
    const PROGRESS_EMIT_INTERVAL_MS = 30;

    initModelManager({
      onStatusChange: (status) => {
        broadcastToAllWindows("stt:model-status-changed", status);
      },
      onDownloadProgress: (progress) => {
        const now = Date.now();
        const isEndpoint = progress.progress <= 0 || progress.progress >= 1;
        const last = lastProgressEmit.get(progress.modelId) ?? 0;
        if (!isEndpoint && now - last < PROGRESS_EMIT_INTERVAL_MS) return;
        lastProgressEmit.set(progress.modelId, now);
        broadcastToAllWindows("stt:model-download-progress", progress);
      },
    });
  });
  // Initialize update controller with notification and tray callbacks
  bootTimeline.measureSync("startup:init-update-controller", () => {
    initUpdateController({
      sendNotify: (message: string) => {
        try {
          if (state.mainWindow && !state.mainWindow.isDestroyed())
            state.mainWindow.webContents.send("notify", message);
        } catch {}
        try {
          if (state.onboardingWindow && !state.onboardingWindow.isDestroyed())
            state.onboardingWindow.webContents.send("notify", message);
        } catch {}
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: "Spoke",
              body: message,
              silent: false,
            }).show();
          }
        } catch (err) {
          console.warn("[auto-update] native notification failed:", err);
        }
      },
      rebuildTrayMenu: () => rebuildTrayMenu(),
      onStateChange: (snapshot) => {
        try {
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send("update:state-changed", snapshot);
          }
        } catch {}
        try {
          if (state.onboardingWindow && !state.onboardingWindow.isDestroyed()) {
            state.onboardingWindow.webContents.send("update:state-changed", snapshot);
          }
        } catch {}
      },
    });
  });

  // Load onboarding flag BEFORE startup flow decision
  bootTimeline.measureSync("startup:load-onboarding-prefs", () => {
    state.onboardingPrefsPath = path.join(userDataPath, "onboarding.json");
    try {
      if (fs.existsSync(state.onboardingPrefsPath)) {
        const raw = fs.readFileSync(state.onboardingPrefsPath, "utf8");
        state.onboardingPrefs = JSON.parse(raw);
      }
    } catch {
      state.onboardingPrefs = {};
    }
  });

  // Load pill preferences
  state.pillPreferences = bootTimeline.measureSync("startup:load-pill-prefs", () =>
    loadPillPreferences(),
  );

  // Load app preferences and apply dock visibility
  state.appPreferences = bootTimeline.measureSync("startup:load-app-prefs", () =>
    loadAppPreferences(),
  );
  // Default to showing in dock if preference not set
  const showInDock = state.appPreferences.showInDock ?? true;
  if (process.platform === "darwin") {
    try {
      if (showInDock) {
        app.dock?.show();
        logger.main.info("[AppPrefs] Dock icon visible");
      } else {
        app.dock?.hide();
        logger.main.info("[AppPrefs] Dock icon hidden");
      }
    } catch (error) {
      logger.main.error("[AppPrefs] Failed to set dock visibility:", error);
    }
  }

  // Stop the sidecar if current provider/model state cannot use it. Do not
  // pre-spawn on startup; packaged PyInstaller + MLX cold starts can starve
  // first paint and make onboarding feel frozen.
  bootTimeline.mark("startup:sync-sidecar-scheduled");
  syncLocalSidecarForCurrentProvider().catch((err) => {
    console.error("[STT] Failed to sync sidecar on startup:", err);
  });

  const isDev = !app.isPackaged;
  console.log("[Main Process] Setting up renderer security headers...");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const styleSrc = "style-src 'self' 'unsafe-inline'";
    const fontSrc = "font-src 'self' data:";
    const connect = [
      "connect-src 'self'",
      "https://api.openai.com",
      "https://api.groq.com",
      "https://api.deepgram.com",
      ...(isDev
        ? [
            "http://localhost:*",
            "http://127.0.0.1:*",
            "ws://localhost:*",
            "ws://127.0.0.1:*",
          ]
        : []),
      "blob:",
      "data:",
    ].join(" ");

    // ORT Web needs WASM compilation for local VAD. Keep JS eval blocked.
    const scriptSrc = [
      "script-src 'self'",
      "'wasm-unsafe-eval'",
      ...(isDev ? ["'unsafe-inline'"] : []),
    ].join(" ");
    const imgSrc = "img-src 'self' data:";
    const csp = [
      "default-src 'self'",
      connect,
      scriptSrc,
      styleSrc,
      imgSrc,
      fontSrc,
    ].join("; ");

    const headers: Record<string, string | string[]> = {
      ...details.responseHeaders,
      "Content-Security-Policy": csp,
    };
    if (app.isPackaged) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }

    callback({ responseHeaders: headers });
  });
  console.log("[Main Process] Renderer security headers configured.");
  bootTimeline.mark("startup:security-headers-configured");

  // Startup flow:
  // - FORCE_ONBOARDING => always show onboarding (ignore local flag)
  // - Otherwise, skip onboarding when SKIP_ONBOARDING or local done flag
  if (
    !FORCE_ONBOARDING &&
    (SKIP_ONBOARDING || state.onboardingPrefs?.done === true)
  ) {
    bootTimeline.mark("startup:flow", { route: "main" });
    console.log("[Startup] SKIP_ONBOARDING enabled — launching main window");
    try {
      createWindow();
      // Start continuous follow, and start helper only if IM already granted
      startFollowCursor();
      state.pttTarget = "main";
      startHelperIfIMGranted();
      console.log("[Debug] Main window launched (onboarding skipped)");

      // Detect and store notch width if not already stored
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

      // Schedule background update check ~60s after startup with jitter
      scheduleUpdateCheck(jitterMs(60_000, 0.2), "startup", true);
    } catch (error) {
      console.error(
        "[Debug] Error launching main window with SKIP_ONBOARDING:",
        error,
      );
    }
  } else {
    bootTimeline.mark("startup:flow", { route: "onboarding" });
    console.log(
      FORCE_ONBOARDING
        ? "[Startup] FORCE_ONBOARDING enabled — showing onboarding"
        : "[Startup] Showing onboarding",
    );
    console.log("[Debug] About to create onboarding window...");
    try {
      createOnboardingWindow();
      console.log("[Debug] Onboarding window created successfully");
    } catch (error) {
      console.error("[Debug] Error creating onboarding window:", error);
    }
  }

  // Initialize microphone manager
  const micPrefs = bootTimeline.measureSync("startup:load-mic-prefs", () =>
    loadMicPreferences(),
  );
  console.log("[Main Process] Microphone preferences loaded:", micPrefs);
  bootTimeline.measureSync("startup:init-mic-manager", () => {
    initMicManager(micPrefs, () => rebuildTrayMenu());
  });

  // Silent background check for app location will be triggered after onboarding completes

  // React to OS display changes to keep the pill consistent
  registerDisplayChangeListeners();

  // IPC handler groups (see src/main/ipc/*)
  registerSettingsIpc();
  registerWindowIpc();
  registerTranscriptIpc();
  registerSttIpc();
  registerMiscIpc();

  // Permission IPC handlers (check/request AX, IM, mic, screen recording)
  registerPermissionHandlers({
    onImGranted: () => startHelperIfIMGranted(),
  });

  // Register global shortcut for pasting last transcript
  const shortcutRegistered = globalShortcut.register(
    "CommandOrControl+Control+V",
    () => {
      console.log("[GlobalShortcut] Command+Control+V pressed");
      // Notify renderer that paste shortcut was pressed (for history-on-expand UX)
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send("paste-shortcut-pressed");
      }
      pasteLastTranscript().catch((err) => {
        console.error("[GlobalShortcut] Error in pasteLastTranscript:", err);
      });
    },
  );

  if (shortcutRegistered) {
    console.log("[GlobalShortcut] Command+Control+V successfully registered");
  } else {
    console.error(
      "[GlobalShortcut] Failed to register Command+Control+V (may be in use by another app)",
    );
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep app running in dock even when all windows are closed
});

app.on("activate", () => {
  console.log("[App Event] activate: Dock icon clicked or app activated");

  // Guard: Don't create windows before app is ready (can happen on fresh install)
  if (!app.isReady()) {
    console.log(
      "[App Event] activate: App not ready yet, skipping window creation",
    );
    return;
  }

  // Check if we have any visible windows first
  const allWindows = BrowserWindow.getAllWindows();
  const visibleWindows = allWindows.filter((window) => window.isVisible());

  console.log(
    `[App Event] activate: ${allWindows.length} total windows, ${visibleWindows.length} visible`,
  );

  if (visibleWindows.length === 0) {
    // No visible windows - show existing hidden windows or create new ones

    // Show the main window if it exists but is hidden
    if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isVisible()) {
      console.log("[App Event] activate: Showing hidden main window");
      state.mainWindow.show();
      return;
    }

    // If no windows exist at all, create the appropriate window
    if (allWindows.length === 0) {
      console.log("[App Event] activate: No windows exist, creating window");
      if (
        !FORCE_ONBOARDING &&
        (SKIP_ONBOARDING || state.onboardingPrefs?.done === true)
      )
        createWindow();
      else createOnboardingWindow();
    }
    // If windows exist but are all destroyed/invalid, recreate main window
    else if (!state.mainWindow || state.mainWindow.isDestroyed()) {
      console.log("[App Event] activate: Main window is destroyed, recreating");
      if (
        !FORCE_ONBOARDING &&
        (SKIP_ONBOARDING || state.onboardingPrefs?.done === true)
      )
        createWindow();
      else createOnboardingWindow();
    }
  } else {
    console.log(
      "[App Event] activate: Windows already visible, no action needed",
    );
  }
});

app.on("before-quit", () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
  console.log("[GlobalShortcut] All shortcuts unregistered");

  state.isQuitting = true;
  // Stop follow-cursor polling to avoid timers running during shutdown
  stopFollowCursor();

  // Clean up local Whisper sidecar
  stopLocalSidecar();

  // Clean up pre-spawned paste helper
  killPasteDaemon();

  // brutally nuke anything we forgot
  for (const p of [...fnHelpers, ...pasteHelpers]) {
    try {
      if (p.pid) process.kill(p.pid, "SIGKILL");
    } catch (e) {
      // ignore
    }
  }

  // **belts-and-suspenders**: kill leftover helpers, but only ones launched
  // from our own bundle — anchor the pattern to the app's resources/app path
  // so unrelated processes can never match.
  const ownBasePath = (
    app.isPackaged ? process.resourcesPath : app.getAppPath()
  ).replace(/'/g, "");
  try {
    execSync(`pkill -9 -f '${ownBasePath}/.*Spoke Helper' || true`);
  } catch (e) {
    // ignore
  }
  try {
    execSync(`pkill -9 -f '${ownBasePath}/.*spoke-helper' || true`);
  } catch (e) {
    // ignore
  }
});

app.on("will-quit", () => {
  console.log("[MainProcess] App is quitting.");
  // Extra guard to ensure polling is stopped
  stopFollowCursor();

  // Clear restart timeout and kill spoke-helper process
  clearFnRestartTimer();

  // Clean up pre-spawned paste helper
  killPasteDaemon();

  for (const p of [...fnHelpers, ...pasteHelpers]) {
    try {
      p.kill("SIGKILL");
    } catch (e) {
      // ignore
    }
  }
});
