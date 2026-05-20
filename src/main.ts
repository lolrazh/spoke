import {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  screen,
  ipcMain,
  clipboard,
  session,
  Menu,
  shell,
  dialog,
  systemPreferences,
  powerMonitor,
  globalShortcut,
} from "electron";
// 'net' is imported via eval'd require to avoid bundling issues when unused
import * as Sentry from "@sentry/electron/main";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { spawn, execSync } from "child_process";
import fs from "node:fs";

import {
  ISLAND_HIDDEN_Y,
  ISLAND_WIDTH,
  ISLAND_HEIGHT,
  ISLAND_VISIBLE_Y,
  SHADOW_PAD,
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
} from "./constants/window";
import { ONBOARDING_WIDTH, ONBOARDING_HEIGHT } from "./constants/onboarding";
import type {
  MicDevice,
  MicPreferences,
  PttTarget,
  SelectionInspectSnapshot,
  DisplayNotchInfo,
} from "./types/shared";
import {
  buildMicrophoneSubmenu,
  buildCommonAppItems,
  buildFeedbackAndAboutItems,
  buildPasteTranscriptItem,
} from "./utils/menuBuilders";
import {
  getTranscriptions,
  saveTranscription,
  deleteTranscription,
  clearTranscriptions,
} from "./lib/transcriptionStorage";
import { captureScreenshot, testScreenshotCapture } from "./utils/screenshot";

// Types moved to ./types/shared

// Add command line switches for WebGPU (currently disabled)
// app.commandLine.appendSwitch('enable-unsafe-webgpu');
// app.commandLine.appendSwitch('ignore-gpu-blocklist');

import type { ChildProcess } from "child_process";
import {
  CURSOR_POLL_INTERVAL_MS,
  REFERENCE_WIDTH,
  MIN_UI_SCALE,
  MAX_UI_SCALE,
} from "./constants/display";
import {
  isApiKeyTranscriptionProviderId,
  isSelectableTranscriptionProviderId,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
} from "./core/transcription/providerCatalog";
import {
  isLocalProviderSelected,
  LOCAL_STT_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "./core/transcription/providerPreferences";
import type { TranscriptionContext } from "./core/transcription/sessionTypes";
import { logger } from "./utils/logger";
import {
  initProviderStore,
  getPreferredProviderId,
  setPreferredProviderId,
  hasProviderApiKey,
  getRequiredProviderApiKey,
  setProviderApiKey,
  clearProviderApiKey,
  getProviderSettingsSnapshot,
  transcribeWithOpenAi,
  transcribeWithGroq,
  transcribeWithDeepgram,
} from "./main/providerStore";
import { enhance } from "./main/enhanceService";
import { extractOcrWords } from "./main/ocrService";
import { resolveEnhancementProvider } from "./main/llmService";
import {
  installLocalModelAndSyncSidecar,
  removeLocalModelAndStopSidecar,
  stopLocalSidecar,
  syncLocalSidecarForCurrentProvider,
  transcribeWithLocalSidecar,
} from "./main/localSttLifecycle";
import { initModelManager, getModelStatus } from "./main/modelManager";
import { getHelperPath } from "./main/helperPaths";
import {
  inspectFocusedSelection,
  type SelectionInspectOptions,
} from "./main/selectionInspect";
import { registerPermissionHandlers } from "./main/permissions";
import {
  refreshNotchInfo,
  getNotchInfoForDisplay,
  getNotchReport,
  cloneDisplayNotchInfo,
} from "./main/notchReporter";
import {
  initPreferences,
  loadMicPreferences,
  saveMicPreferences,
  loadPillPreferences,
  savePillPreferences,
  loadAppPreferences,
  saveAppPreferences,
} from "./main/preferences";
import { smoothShow, smoothHide } from "./main/windowAnimation";
import { getIconPath, getTrayIconPath } from "./main/iconPaths";
import {
  clearHideTimer,
  hideFloatingBarWithTimer,
  isFloatingBarEnabled,
  setFloatingBarEnabled,
  getHideEndTime,
  isHideTimerActive,
} from "./main/floatingBar";
import {
  initMicManager,
  getMicDevices,
  getMicPreferences,
  getSelectedMicId,
  updateMicDevices,
  selectMicDevice,
  broadcastMicSelection,
} from "./main/micManager";
import {
  preSpawnPasteHelper,
  getPreSpawnedHelper,
  pasteViaDaemon,
  killPasteDaemon,
  respawnPasteDaemon,
} from "./main/pasteDaemon";
import {
  initUpdateController,
  manualCheckForUpdates,
  scheduleUpdateCheck,
  getUpdateStatus,
  getUpdateAvailableVersion,
  isUpdateReadyToInstall,
  getUpdateError,
  jitterMs,
} from "./main/updateController";

// Initialize Sentry as early as possible in the main process
// Vite injects env at build time; provide a typed fallback for the main process
const VITE_ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env ?? {};

const sentryDsn = VITE_ENV.VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
const sentryEnv =
  VITE_ENV.VITE_SENTRY_ENVIRONMENT ?? (app.isPackaged ? "prod" : "dev");
const devFlag =
  VITE_ENV.DEV === "1" || VITE_ENV.DEV === "true" || !app.isPackaged;

Sentry.init({
  // Use a single DSN variable for both main/renderer (Vite-injected)
  dsn: sentryDsn || undefined,
  // Default to 'prod' for packaged builds and 'dev' for development
  environment: sentryEnv,
  release: app.getVersion(),
  // Enable performance tracing (tune in prod)
  tracesSampleRate: devFlag ? 1.0 : 0.1,
  beforeSend(event) {
    try {
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          u.search = ""; // strip query params
          event.request.url = u.toString();
        } catch {}
      }
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        for (const k of Object.keys(headers)) {
          if (/authorization|api[-_]?key|token/i.test(k))
            headers[k] = "[Filtered]";
        }
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (typeof b.message === "string") {
            b.message = b.message.replace(
              /(apikey|token|authorization)=([^\s&]+)/gi,
              "$1=[Filtered]",
            );
          }
          return b;
        });
      }
    } catch {}
    return event;
  },
});

let mainWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const fnHelpers = new Set<ChildProcess>();
const pasteHelpers = new Set<ChildProcess>();
let fnProc: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ""; // Buffer for incomplete lines from spoke-helper stdout
let pttTarget: PttTarget = "auto";

// Ensure a single running app instance.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus existing window when a second instance is launched
    const targetWindow = mainWindow || onboardingWindow;
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

// Pill preferences (notch width, etc.)
let pillPreferences: import("./types/shared").PillPreferences = {};
// Optical adjustment for notch width (pixels to subtract for better visual alignment)
const NOTCH_WIDTH_OPTICAL_ADJUSTMENT = 2;
// App preferences (dock visibility, etc.)
let appPreferences: import("./types/shared").AppPreferences = {};
// Onboarding persistence (local flag)
let onboardingPrefsPath: string; // Will be initialized in app.whenReady()
let onboardingPrefs: { done?: boolean; currentStep?: string } = {};

// Last transcript storage for context menu copy functionality
let lastTranscript = "";

// Dock operation in progress (prevents blur from collapsing during dock show/hide)
let dockOperationInProgress = false;

// === Active display tracking for continuous follow ===
let activeDisplayId: number | null = null;
let followCursorInterval: NodeJS.Timeout | null = null;
let coalesceTimer: NodeJS.Timeout | null = null;
let pendingBounds: Electron.Rectangle | null = null;

function getDisplayForPoint(point: Electron.Point): Electron.Display {
  return screen.getDisplayNearestPoint(point);
}

function getActiveDisplay(): Electron.Display {
  if (activeDisplayId != null) {
    const existing = screen
      .getAllDisplays()
      .find((d) => d.id === activeDisplayId);
    if (existing) return existing;
  }
  return getDisplayForPoint(screen.getCursorScreenPoint());
}

function getDisplayForWindow(): Electron.Display {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return getActiveDisplay();
  }
  const b = mainWindow.getBounds();
  // Prefer the display that best matches the window bounds (largest area intersection)
  const match = screen.getDisplayMatching(b);
  if (match) return match;
  // Fallback: use the display nearest to the window center point
  const cx = Math.round(b.x + b.width / 2);
  const cy = Math.round(b.y + b.height / 2);
  return screen.getDisplayNearestPoint({ x: cx, y: cy });
}

function centerWindowOnDisplay(
  display: Electron.Display,
  preserveRelativeY = true,
): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentBounds = mainWindow.getBounds();
  const newX =
    display.bounds.x +
    Math.round((display.size.width - currentBounds.width) / 2);
  // Always snap to safe top of target display to keep pill flush to menu bar/notch
  const newY = display.workArea.y + ISLAND_VISIBLE_Y;
  if (currentBounds.x !== newX || currentBounds.y !== newY) {
    coalescedSetBounds({
      x: newX,
      y: newY,
      width: currentBounds.width,
      height: currentBounds.height,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeScaleForDisplay(display: Electron.Display): number {
  // Shrink-only scaling: keep 1.0 on wider displays, scale down on smaller ones
  // Reference width tuned to typical modern Macs (1728 logical px). Range: [0.9, 1.0]
  const raw = display.size.width / REFERENCE_WIDTH;
  return clamp(raw, MIN_UI_SCALE, MAX_UI_SCALE);
}

function ensureEnvelopeForDisplay(
  display: Electron.Display,
): { scale: number; width: number; height: number } | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const scale = computeScaleForDisplay(display);

  // Expanded pill content, scaled per active display
  const targetContentW = Math.round(CONTENT_WIDTH * scale);
  const targetContentH = Math.round(CONTENT_HEIGHT * scale);
  const targetW = Math.max(ISLAND_WIDTH, targetContentW + SHADOW_PAD * 2);
  const targetH = Math.max(ISLAND_HEIGHT, targetContentH + SHADOW_PAD * 2);

  const current = mainWindow.getBounds();
  const newX =
    display.bounds.x + Math.round((display.size.width - targetW) / 2);
  // Snap Y to the top safe area of the target display (stick to menu bar/notch)
  const newY = display.workArea.y + ISLAND_VISIBLE_Y;

  if (
    current.width !== targetW ||
    current.height !== targetH ||
    current.x !== newX ||
    current.y !== newY
  ) {
    coalescedSetBounds({ x: newX, y: newY, width: targetW, height: targetH });
  }
  return { scale, width: targetW, height: targetH };
}

function emitActiveDisplayInfo(display: Electron.Display, scale: number): void {
  try {
    const notch = getNotchInfoForDisplay(display.id);
    const notchPayload = notch ? cloneDisplayNotchInfo(notch) : null;
    if (!notchPayload) {
      const knownIds =
        getNotchReport()
          ?.screens.map((s) => s.id)
          .join(", ") ?? "none";
      const scaleStr = Number.isFinite(scale)
        ? scale.toFixed(3)
        : String(scale);
      logger.main.info(
        `[Notch] no match for display id=${display.id}. Known notch ids: ${knownIds} (scale=${scaleStr})`,
      );
    }

    // Include stored notch width if available
    const storedNotchWidth = pillPreferences.notchWidth ?? null;

    const payload = {
      id: display.id,
      bounds: display.bounds,
      size: display.size,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      scale,
      // Current window envelope for reference
      window: mainWindow?.getBounds() ?? null,
      notch: notchPayload,
      storedNotchWidth,
    };
    mainWindow?.webContents.send("active-display", payload);
  } catch (e) {
    logger.main.warn("emitActiveDisplayInfo failed", e);
  }
}

// After refreshing notch info, also update the renderer with new display data
async function refreshNotchInfoAndEmit(reason: string): Promise<void> {
  await refreshNotchInfo(reason);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const display = getDisplayForWindow();
      const scale = computeScaleForDisplay(display);
      emitActiveDisplayInfo(display, scale);
    }
  } catch (err) {
    logger.main.warn("[Notch] Failed to emit updated notch info", err);
  }
}

async function detectAndStoreNotchWidth(): Promise<number | null> {
  logger.main.info("[PillPrefs] Detecting notch width for the first time...");

  // Refresh notch info to get all displays
  await refreshNotchInfoAndEmit("initial-detection");

  const report = getNotchReport();
  if (!report || !report.screens || report.screens.length === 0) {
    logger.main.info("[PillPrefs] No notch report available");
    return null;
  }

  // Find the built-in display with a notch
  const builtInWithNotch = report.screens.find(
    (screen) => screen.isBuiltIn && screen.hasNotch && screen.notchWidth > 0,
  );

  if (!builtInWithNotch) {
    logger.main.info("[PillPrefs] No built-in display with notch found");
    return null;
  }

  const detectedWidth = builtInWithNotch.notchWidth;
  // Optical adjustment: subtract constant for better visual alignment
  const adjustedWidth = detectedWidth - NOTCH_WIDTH_OPTICAL_ADJUSTMENT;

  // Validate width bounds (14" MBP = ~196px, 16" MBP = ~207px)
  // Clamp to reasonable range to handle unexpected hardware or API quirks
  let finalWidth = adjustedWidth;
  if (adjustedWidth < 150) {
    logger.main.warn(
      `[PillPrefs] Width ${adjustedWidth.toFixed(2)}px below minimum, clamping to 150px`,
    );
    finalWidth = 150;
  } else if (adjustedWidth > 250) {
    logger.main.warn(
      `[PillPrefs] Width ${adjustedWidth.toFixed(2)}px above maximum, clamping to 250px`,
    );
    finalWidth = 250;
  }

  logger.main.info(
    `[PillPrefs] Detected notch width: ${detectedWidth.toFixed(2)}px, storing adjusted: ${finalWidth.toFixed(2)}px on display ${builtInWithNotch.id}`,
  );

  // Store the validated width
  pillPreferences.notchWidth = finalWidth;
  savePillPreferences(pillPreferences);

  return finalWidth;
}

function startFollowCursor(): void {
  if (followCursorInterval) {
    clearInterval(followCursorInterval);
    followCursorInterval = null;
  }
  // 5 Hz polling to reduce CPU usage while still tracking display changes
  followCursorInterval = setInterval(() => {
    try {
      const point = screen.getCursorScreenPoint();
      const display = getDisplayForPoint(point);
      if (display.id !== activeDisplayId) {
        activeDisplayId = display.id;
        const result = ensureEnvelopeForDisplay(display);
        const scale = result?.scale ?? computeScaleForDisplay(display);
        emitActiveDisplayInfo(display, scale);
      }
    } catch (err) {
      logger.main.warn("startFollowCursor tick failed", err);
    }
  }, CURSOR_POLL_INTERVAL_MS);
}

function stopFollowCursor(): void {
  if (followCursorInterval) {
    clearInterval(followCursorInterval);
    followCursorInterval = null;
  }
}

function syncToCurrentDisplay(reason: string): void {
  try {
    // On OS display changes, select display based on current window location
    const display = getDisplayForWindow();
    activeDisplayId = display.id;
    const sized = ensureEnvelopeForDisplay(display);
    const scale = sized?.scale ?? computeScaleForDisplay(display);
    emitActiveDisplayInfo(display, scale);
  } catch (e) {
    logger.main.warn("syncToCurrentDisplay failed", e);
  }
}

function coalescedSetBounds(bounds: Electron.Rectangle): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.getBounds();
  // Skip if identical
  if (
    current.x === bounds.x &&
    current.y === bounds.y &&
    current.width === bounds.width &&
    current.height === bounds.height
  ) {
    return;
  }

  // Merge into pending
  pendingBounds = bounds;
  if (coalesceTimer) return;
  // Coalesce within ~16ms
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    const finalBounds = pendingBounds ?? mainWindow!.getBounds();
    pendingBounds = null;
    try {
      mainWindow!.setBounds(finalBounds, false);
      if (process.platform === "darwin") mainWindow!.invalidateShadow();
    } catch (e) {
      // ignore
    }
  }, 16);
}

function spawnHelper(path: string, args: string[] = [], isFnHelper: boolean) {
  const proc = spawn(path, args, { stdio: "pipe", detached: false });
  const helperSet = isFnHelper ? fnHelpers : pasteHelpers;
  helperSet.add(proc);
  proc.once("exit", () => helperSet.delete(proc));
  return proc;
}

async function startHelperIfIMGranted(): Promise<void> {
  try {
    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      console.warn("[FnListener] Helper not found; cannot preflight IM grant");
      return;
    }
    await new Promise<void>((resolve) => {
      const proc = spawn(helperPath, ["--check-permissions"], {
        stdio: ["ignore", "pipe", "ignore"],
        detached: false,
      });
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.on("error", (err) => {
        console.error("[FnListener] Helper spawn error:", err);
        resolve();
      });
      proc.on("close", () => {
        const hasIM = out.includes("im-granted");
        if (hasIM) {
          try {
            startFnListener();
          } catch {}
        } else {
          console.log("[FnListener] IM not granted; helper start deferred");
        }
        resolve();
      });
    });
  } catch (e) {
    console.warn(
      "[FnListener] Preflight IM check failed:",
      (e as Error)?.message,
    );
  }
}

// Removed: noisy bounds logging
// function logBounds(tag: string) { ... }

// Microphone preference management functions

function buildFloatingBarMenuItems(): Electron.MenuItemConstructorOptions[] {
  if (!mainWindow) {
    return [];
  }

  const isVisible = mainWindow.isVisible();

  if (isVisible) {
    // Window is visible - show hide options with timing
    return [
      {
        label: "Hide Floating Bar",
        submenu: [
          {
            label: "For 5 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 5 minutes");
              hideFloatingBarWithTimer(mainWindow, 5);
            },
          },
          {
            label: "For 30 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 30 minutes");
              hideFloatingBarWithTimer(mainWindow, 30);
            },
          },
          {
            label: "For 1 hour",
            click: () => {
              console.log("[Menu] Hide floating bar for 1 hour");
              hideFloatingBarWithTimer(mainWindow, 60);
            },
          },
          { type: "separator" },
          {
            label: "Indefinitely",
            click: () => {
              console.log("[Menu] Hide floating bar indefinitely");
              hideFloatingBarWithTimer(mainWindow, null);
            },
          },
        ],
      },
    ];
  } else {
    // Window is hidden - show option to show it
    let label = "Show Floating Bar";

    // If there's an active timer, show remaining time
    if (isHideTimerActive() && getHideEndTime()) {
      const remainingMs = getHideEndTime()! - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      if (remainingMinutes > 0) {
        label = `Show Floating Bar (${remainingMinutes}m remaining)`;
      }
    }

    return [
      {
        label,
        click: () => {
          console.log("[Menu] Show floating bar");
          clearHideTimer();
          if (mainWindow) {
            smoothShow(mainWindow);
            console.log("[Menu] Floating bar shown");
          }
          setFloatingBarEnabled(true);
        },
      },
    ];
  }
}

// (Removed) Silent background check for app location

const iconPath = getIconPath();

function getRendererEntryUrl(hash?: string): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (hash) url.hash = hash;
    return url.toString();
  }

  const filePath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
  const url = pathToFileURL(filePath);
  if (hash) url.hash = hash;
  return url.toString();
}

const createWindow = () => {
  // Create the browser window.
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000", // Fully transparent background
    hasShadow: false, // <-- KILL the macOS shadow (= white block)
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    focusable: false, // <-- Keeps the previous app front-most
    acceptFirstMouse: true, // <-- Allows first click to pass through to the webview
    hiddenInMissionControl: true, // <-- Hides from exposé
    type: process.platform === "darwin" ? "panel" : undefined, // <-- Panel type for full-screen overlay on macOS
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      enableWebSQL: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: ["--enable-features=SharedArrayBuffer"],
    },
    paintWhenInitiallyHidden: true,
  };

  // Try to set the icon, but don't crash if it fails
  const windowIconPath = iconPath;

  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      windowOptions.icon = windowIconPath;
    } else {
      console.warn(
        `Icon not found at path: ${windowIconPath}, continuing without icon`,
      );
    }
  } catch (error) {
    console.warn(
      `Failed to load icon: ${error.message}, continuing without icon`,
    );
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Also try to set the icon explicitly after creation (optional but good practice)
  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      mainWindow.setIcon(windowIconPath);
    }
  } catch (error) {
    console.warn(`Failed to set window icon: ${error.message}`);
  }

  // Set window behaviors for macOS
  if (process.platform === "darwin") {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    // Critical flags for full-screen overlay while keeping dock icon:
    // - visibleOnFullScreen: allows window to appear in full-screen Spaces
    // - skipTransformProcessType: prevents app from becoming UIElement/accessory, keeping dock icon
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // Prevent pill itself from going fullscreen
    mainWindow.setFullScreenable(false);
  }

  // Prepare DevTools behavior; actual show happens on renderer-ready handshake
  mainWindow.once("ready-to-show", () => {
    // Ensure initial position is the visible top-aligned Y (flush to screen top)
    try {
      const current = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(current);
      activeDisplayId = currentDisplay.id;
      const targetY = currentDisplay.workArea.y + ISLAND_VISIBLE_Y;
      mainWindow.setBounds(
        {
          x: current.x,
          y: targetY,
          width: current.width,
          height: current.height,
        },
        false,
      );
      if (process.platform === "darwin") mainWindow.invalidateShadow();
    } catch (e) {
      console.warn("Failed to top-align on ready-to-show:", e);
    }

    // DevTools behavior:
    if (VITE_ENV?.VITE_SF_DEVTOOLS === "1") {
      try {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      } catch {}
      console.log("DevTools opened (staging)");
    } else if (
      MAIN_WINDOW_VITE_DEV_SERVER_URL &&
      process.env.SF_DEVTOOLS === "1"
    ) {
      // Only auto-open DevTools for the pill window when it's actually the main app target
      if (pttTarget === "main") {
        try {
          mainWindow.webContents.openDevTools({ mode: "detach" });
        } catch {}
        console.log(
          "DevTools opened (dev opt-in). Tip: unset SF_DEVTOOLS to suppress overlays on transparent window.",
        );
      } else {
        console.log("DevTools suppressed for pill during onboarding prepare");
      }
    } else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      console.log(
        "DevTools suppressed for transparent window (set SF_DEVTOOLS=1 to enable)",
      );
    }
  });

  // Option 2 (as per suggestion): Use 'closed' event for logging after the fact
  mainWindow.on("closed", () => {
    console.log("Main window has been closed.");
    mainWindow = null; // Ensure reference is cleared
  });

  // Rebuild tray menu when main window visibility changes to update "Show Floating Bar" option
  mainWindow.on("show", () => {
    console.log("[Main Window] Window shown, rebuilding tray menu");
    // Clear any active hide timer when window is shown
    clearHideTimer();
    rebuildTrayMenu();
  });

  mainWindow.on("hide", () => {
    console.log("[Main Window] Window hidden, rebuilding tray menu");
    rebuildTrayMenu();
  });

  // Position window centered on the cursor's display and hidden under the notch
  const cursorDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  activeDisplayId = cursorDisplay.id;
  const initialX =
    cursorDisplay.bounds.x +
    Math.round((cursorDisplay.size.width - ISLAND_WIDTH) / 2);
  // Start aligned to safe top so the pill is always flush when shown
  const initialY = cursorDisplay.workArea.y + ISLAND_VISIBLE_Y;
  console.log(
    `[Window Creation] Display=${cursorDisplay.id} width=${cursorDisplay.size.width}px, Initial X=${initialX}, Y=${initialY}`,
  );
  mainWindow.setBounds({
    x: initialX,
    y: initialY,
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
  });
  // Immediately size envelope for display scale and notify renderer
  const sized = ensureEnvelopeForDisplay(cursorDisplay);
  emitActiveDisplayInfo(
    cursorDisplay,
    sized?.scale ?? computeScaleForDisplay(cursorDisplay),
  );
  void refreshNotchInfoAndEmit("window-init");

  // Collapse request on blur: if user clicks outside our window, renderer can decide to collapse
  mainWindow.on("blur", () => {
    try {
      // Skip collapse during dock operations to prevent unwanted UX disruption
      if (dockOperationInProgress) return;
      mainWindow?.webContents.send("collapse-request");
    } catch {
      // ignore
    }
  });

  mainWindow.loadURL(getRendererEntryUrl()).catch((error) => {
    console.error("[Main Window] Failed to load renderer:", error);
  });

  // Hide menu bar
  mainWindow.setMenuBarVisibility(false);

  // Make window click-through by default, but keep hover/move events forwarded
  // This allows CSS cursors/tooltips/hover states to work even when click-through is enabled
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Add this handler to grant permissions needed for SharedArrayBuffer in some contexts
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      // In a real app, you might want to be more specific about which permissions
      // and origins you grant, but for local development/SAB, granting broadly is common.
      console.log(
        `Granting permission: ${permission} to ${webContents.getURL()}`,
      );
      callback(true);
    },
  );
};

// Show windows only after their own renderers signal they are visually ready
ipcMain.on("renderer-ready", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (!senderWin || senderWin.isDestroyed()) return;

  // Only top-align and show if the pill (main) window is the sender
  if (senderWin === mainWindow) {
    // During onboarding prepare, avoid auto-show to prevent flicker
    if (pttTarget !== "main") {
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      // Align to current display's safe top before revealing (guard)
      const current = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(current);
      activeDisplayId = currentDisplay.id;
      const targetY = currentDisplay.workArea.y + ISLAND_VISIBLE_Y;
      mainWindow.setBounds(
        {
          x: current.x,
          y: targetY,
          width: current.width,
          height: current.height,
        },
        false,
      );
      if (process.platform === "darwin") mainWindow.invalidateShadow();
    } catch (e) {
      console.warn("[renderer-ready] Top-align failed:", e);
    }

    // Re-emit active display info now that renderer is ready to receive it
    try {
      const current = mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const scale = computeScaleForDisplay(display);
      emitActiveDisplayInfo(display, scale);
    } catch (e) {
      console.warn("[renderer-ready] Failed to emit display info:", e);
    }

    try {
      smoothShow(mainWindow);
    } catch (e) {
      console.warn("[renderer-ready] Failed to show:", e);
    }
    return;
  }

  // If the onboarding window reports ready, do not manipulate the pill.
  if (senderWin === onboardingWindow) {
    try {
      if (!onboardingWindow?.isVisible()) smoothShow(onboardingWindow);
    } catch (e) {
      console.warn("[renderer-ready] Failed to show onboarding:", e);
    }
  }
});

function createOnboardingWindow() {
  console.log("[Debug] Inside createOnboardingWindow function");
  const onboardingWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: ONBOARDING_WIDTH,
    height: ONBOARDING_HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: "#0f0f0f",
    hasShadow: false,
    resizable: false,
    alwaysOnTop: false,
    focusable: true,
    skipTaskbar: false,
    show: false, // FIX 1: Don't show immediately - wait for content to load
    center: true,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: app.isPackaged ? true : false,
    },
    paintWhenInitiallyHidden: true,
  };

  // macOS-specific window tweaks (no vibrancy)
  if (process.platform === "darwin") {
    onboardingWindowOptions.titleBarStyle = "hiddenInset";
    onboardingWindowOptions.trafficLightPosition = { x: 14, y: 14 };
  }

  console.log(
    "[Debug] Creating BrowserWindow with options:",
    onboardingWindowOptions,
  );
  onboardingWindow = new BrowserWindow(onboardingWindowOptions);
  console.log("[Debug] BrowserWindow created, setting menu bar visibility");
  onboardingWindow.setMenuBarVisibility(false);

  const onboardingUrl = getRendererEntryUrl("/onboarding");

  console.log("[Onboarding] Loading URL:", onboardingUrl);
  console.log("[Onboarding] __dirname:", __dirname);
  console.log("[Onboarding] MAIN_WINDOW_VITE_NAME:", MAIN_WINDOW_VITE_NAME);
  console.log("[Debug] About to load URL in onboarding window");

  onboardingWindow.loadURL(onboardingUrl).catch((error) => {
    console.error("[Debug] Error loading URL:", error);
  });
  console.log("[Debug] URL load initiated");

  // Add comprehensive error handling
  onboardingWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "[Onboarding] Failed to load:",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  onboardingWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Onboarding] Renderer process gone:", details);
  });

  onboardingWindow.on("unresponsive", () => {
    console.error("[Onboarding] Window became unresponsive");
  });

  onboardingWindow.on("closed", () => {
    console.log("[Debug] Onboarding window was closed");
  });

  // FIX 3: Wait for DOM and full rendering before showing window
  onboardingWindow.webContents.on("dom-ready", () => {
    console.log("[Onboarding] DOM ready");
  });

  // Wait for all resources to be ready; renderer will request showing when visually ready
  onboardingWindow.webContents.once("did-finish-load", () => {
    console.log("[Onboarding] Content finished loading");
  });

  // Keep DevTools behavior; showing is coordinated by renderer-ready
  onboardingWindow.once("ready-to-show", () => {
    console.log("[Onboarding] Ready to show event fired");
    if (VITE_ENV?.VITE_SF_DEVTOOLS === "1") {
      try {
        onboardingWindow.webContents.openDevTools({ mode: "detach" });
      } catch {}
      console.log("[Onboarding] DevTools opened (staging)");
    }
  });

  onboardingWindow.on("closed", () => {
    onboardingWindow = null;
  });
}

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  console.log(
    "[Tray Menu] Building tray menu with",
    getMicDevices().length,
    "devices",
  );
  const selectedMicId = getSelectedMicId();

  const micSubmenu = buildMicrophoneSubmenu(
    getMicDevices(),
    selectedMicId,
    (id) => selectMicDevice(id),
  );

  const updateItems: Electron.MenuItemConstructorOptions[] = [];
  const buildCheckLabel = () =>
    getUpdateStatus() === "checking"
      ? "Checking for Updates…"
      : "Check for Updates…";

  function restartToInstallUpdate() {
    try {
      const req: any = eval("require");
      const mod = req?.("electron-updater");
      const autoUpdater = mod?.autoUpdater as any;
      if (autoUpdater && typeof autoUpdater.quitAndInstall === "function") {
        console.log("[Updater] quitAndInstall invoked");
        autoUpdater.quitAndInstall();
        return;
      }
    } catch {}
    console.log(
      "[Updater] quitAndInstall unavailable; relaunching app as fallback",
    );
    try {
      app.relaunch();
      app.quit();
    } catch (e) {
      console.warn("[Updater] Fallback relaunch failed:", e);
    }
  }

  // Primary update actions
  updateItems.push({
    label: buildCheckLabel(),
    enabled: getUpdateStatus() !== "checking",
    click: () => {
      manualCheckForUpdates();
    },
  });

  if (isUpdateReadyToInstall()) {
    updateItems.push({ type: "separator" });
    updateItems.push({
      label: "Restart and Install Update",
      click: () => restartToInstallUpdate(),
    });
  }

  return [
    ...buildCommonAppItems(() => {
      console.log("[Tray Menu] Settings clicked");
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send("expand-pill");
      }
    }),
    // Update controls
    ...updateItems,
    { type: "separator" },
    buildPasteTranscriptItem(
      () => lastTranscript,
      () => {
        pasteLastTranscript().catch((err) => {
          console.error("[TrayMenu] Error pasting transcript:", err);
        });
      },
    ),
    { type: "separator" },
    ...buildFloatingBarMenuItems(),
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    ...buildFeedbackAndAboutItems(),
    { type: "separator" },
    {
      label: "Quit Spoke",
      accelerator: "CommandOrControl+Q",
      click: () => {
        console.log("[Tray Menu] Quit Spoke clicked");
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function buildPillContextMenu(): Electron.MenuItemConstructorOptions[] {
  console.log(
    "[Pill Menu] Building pill context menu with",
    getMicDevices().length,
    "devices",
  );
  const selectedMicId = getSelectedMicId();

  const micSubmenu = buildMicrophoneSubmenu(
    getMicDevices(),
    selectedMicId,
    (id) => selectMicDevice(id),
  );

  return [
    ...buildCommonAppItems(() => {
      console.log("[Pill Menu] Settings clicked");
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send("expand-pill");
      }
    }),
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    buildPasteTranscriptItem(
      () => lastTranscript,
      () => {
        pasteLastTranscript().catch((err) => {
          console.error("[ContextMenu] Error pasting transcript:", err);
        });
      },
    ),
    ...buildFloatingBarMenuItems(),
    { type: "separator" },
    ...buildFeedbackAndAboutItems(),
  ];
}

function rebuildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) {
    console.log("[Tray] Cannot rebuild menu - tray not available");
    return;
  }

  console.log("[Tray] Rebuilding menu with updated microphone list");
  const menuTemplate = buildTrayMenu();
  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
  console.log("[Tray] Menu rebuilt successfully");
}

const createTray = () => {
  try {
    console.log("[Tray] Starting tray creation...");

    // Check if tray already exists
    if (tray) {
      console.log("[Tray] Tray already exists, skipping creation");
      return;
    }

    // Load the tray template icon (Electron will auto-detect @2x version)
    const trayIconPath = getTrayIconPath();
    console.log(
      `[Tray] Attempting to load tray template from: ${trayIconPath}`,
    );

    let icon = nativeImage.createFromPath(trayIconPath);

    if (icon.isEmpty()) {
      console.error(
        `[Tray] Failed to load tray icon from path: ${trayIconPath}. Using empty icon.`,
      );
      icon = nativeImage.createEmpty(); // Fallback to empty
    } else {
      console.log(
        `[Tray] Successfully loaded tray icon from path: ${trayIconPath}`,
      );
      const iconSize = icon.getSize();
      console.log(
        `[Tray] Loaded icon size: ${iconSize.width}x${iconSize.height} (should be 16x16 for base)`,
      );

      // Mark as template for proper macOS automatic tinting (light/dark mode)
      icon.setTemplateImage(true);
      console.log("[Tray] Icon marked as template for automatic macOS tinting");
    }

    console.log("[Tray] Creating Tray instance...");
    tray = new Tray(icon);
    console.log("[Tray] Tray instance created successfully");

    // Additional debugging for tray visibility
    console.log(`[Tray] Tray destroyed state: ${tray.isDestroyed()}`);

    tray.setToolTip("Spoke");

    // Force tray to be visible (macOS sometimes hides it)
    if (process.platform === "darwin") {
      tray.setIgnoreDoubleClickEvents(false);
      // Try to force display the tray
      setTimeout(() => {
        if (tray && !tray.isDestroyed()) {
          console.log("[Tray] Forcing tray visibility on macOS");
          tray.setToolTip("Spoke - AI Dictation");
        }
      }, 100);
    }

    console.log("[Tray] Tooltip set");

    // Create enhanced native context menu with dynamic microphone list
    console.log("[Tray] Building context menu...");
    const menuTemplate = buildTrayMenu();
    const contextMenu = Menu.buildFromTemplate(menuTemplate);

    // Add event listener for when tray menu is about to open
    tray.on("click", () => {
      console.log("[Tray] 🎯 Tray menu opening - requesting device refresh");
      // Send refresh request to renderer processes before showing menu
      BrowserWindow.getAllWindows().forEach((window) => {
        console.log("[Tray] Sending mic:refresh-devices to window:", window.id);
        window.webContents.send("mic:refresh-devices");
      });
    });

    // Set the native context menu
    console.log("[Tray] Setting context menu...");
    tray.setContextMenu(contextMenu);
    console.log("[Tray] ✅ Tray created successfully with enhanced menu!");
  } catch (error) {
    console.error("[Tray] ❌ Failed to create tray:", error);
    console.error("[Tray] Error stack:", error.stack);
    // Ensure tray is null if creation fails
    if (tray) {
      try {
        tray.destroy();
      } catch (destroyError) {
        console.error("[Tray] Failed to destroy tray:", destroyError);
      }
    }
    tray = null;
  }
};

// (Removed) Move to Applications helper

// Add a handler for insert-text-at-cursor
ipcMain.handle(
  "insert-text-at-cursor",
  async (_event: Electron.IpcMainInvokeEvent, text: string) => {
    if (!text) {
      console.warn("[PasteHelper] Received empty text. Aborting insertion.");
      return { success: false, error: "Cannot insert empty text." };
    }

    try {
      console.log("=== TEXT INSERTION PROCESS START ===");
      console.log("Received text:", text);

      const originalClipboardText = clipboard.readText();
      console.log("Original clipboard text stored.");

      // Preserve exact text (no trimming) so verification matches payload
      // Remove leading whitespace that some transcription paths prepend
      const payloadText = text.trimStart();
      clipboard.writeText(payloadText);
      console.log("Transcription text copied to clipboard for pasting.");

      const helperPath = getHelperPath();
      if (!fs.existsSync(helperPath)) {
        console.error(
          `[PasteHelper] Spoke Helper binary not found at path: ${helperPath}`,
        );
        mainWindow?.webContents.send(
          "notify",
          "Paste unavailable: binary missing. Copied to clipboard.",
        );
        return { success: false, error: "Paste helper binary not found." };
      }

      // Use pre-spawned daemon if available, otherwise fallback to direct spawn
      const pastedViaDaemon = await pasteViaDaemon();
      if (!pastedViaDaemon) {
        console.log(
          `[PasteHelper] Pre-spawn not available, using direct spawn from: ${helperPath}`,
        );
        const proc = spawnHelper(helperPath, ["--mode=paste"], false);

        await new Promise<void>((resolve) => {
          let stderrBuffer = "";
          proc.stderr.on("data", (data) => {
            stderrBuffer += data.toString();
          });
          proc.on("close", (code) => {
            if (stderrBuffer)
              console.error(`[PasteHelper stderr]: ${stderrBuffer.trim()}`);
            console.log(
              `[PasteHelper] fallback paste helper exited with code ${code}`,
            );
            resolve();
          });
          proc.on("error", (error) => {
            console.error(
              "[PasteHelper] Error executing fallback paste-helper:",
              error,
            );
            resolve();
          });
        });
      }

      // Restore original clipboard regardless of outcome
      setTimeout(() => {
        try {
          clipboard.writeText(originalClipboardText);
        } catch {}
      }, 300);

      console.log("=== TEXT INSERTION PROCESS COMPLETE ===");
      return { success: true, verified: false };
    } catch (error) {
      console.error("=== TEXT INSERTION PROCESS FAILED (Exception) ===");
      console.error("Error during text insertion:", error);
      // In case of any other error, leave the transcribed text in the clipboard.
      try {
        const trimmed = typeof text === "string" ? text.trimStart() : text;
        clipboard.writeText(trimmed as string);
      } catch {
        clipboard.writeText(text);
      }
      mainWindow?.webContents.send(
        "notify",
        "Error. Text copied to clipboard.",
      );
      return {
        success: false,
        error:
          "An error occurred during text insertion. Text copied to clipboard.",
      };
    }
  },
);

// Helper function to paste the last transcript
async function pasteLastTranscript() {
  if (!lastTranscript || lastTranscript.trim().length === 0) {
    console.log("[PasteShortcut] No transcript available to paste");
    return;
  }

  try {
    console.log(
      "[PasteShortcut] Pasting last transcript via Command+Control+V",
    );

    const originalClipboardText = clipboard.readText();
    const payloadText = lastTranscript.trimStart();
    clipboard.writeText(payloadText);

    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      console.error("[PasteShortcut] Helper binary not found");
      return;
    }

    // Use pre-spawned daemon or fallback to direct spawn
    const pastedViaDaemon = await pasteViaDaemon();
    if (!pastedViaDaemon) {
      console.log("[PasteShortcut] Using direct spawn");
      const proc = spawnHelper(helperPath, ["--mode=paste"], false);
      await new Promise<void>((resolve) => {
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });
    }

    // Restore original clipboard
    setTimeout(() => {
      try {
        clipboard.writeText(originalClipboardText);
      } catch {}
    }, 300);
  } catch (error) {
    console.error("[PasteShortcut] Error pasting transcript:", error);
  }
}

// Preference checking for first run
// Removed onboarding persistence - always show onboarding

app.whenReady().then(async () => {
  // Initialize preferences and provider store
  initPreferences(app.getPath("userData"));
  initProviderStore(app.getPath("userData"));
  initModelManager({
    onStatusChange: (status) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("stt:model-status-changed", status);
      } catch {}
    },
    onDownloadProgress: (progress) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("stt:model-download-progress", progress);
      } catch {}
    },
  });
  // Initialize update controller with notification and tray callbacks
  initUpdateController({
    sendNotify: (message: string) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("notify", message);
      } catch {}
      try {
        if (onboardingWindow && !onboardingWindow.isDestroyed())
          onboardingWindow.webContents.send("notify", message);
      } catch {}
    },
    rebuildTrayMenu: () => rebuildTrayMenu(),
  });

  // Load onboarding flag BEFORE startup flow decision
  onboardingPrefsPath = path.join(app.getPath("userData"), "onboarding.json");
  try {
    if (fs.existsSync(onboardingPrefsPath)) {
      const raw = fs.readFileSync(onboardingPrefsPath, "utf8");
      onboardingPrefs = JSON.parse(raw);
    }
  } catch {
    onboardingPrefs = {};
  }

  // Load pill preferences
  pillPreferences = loadPillPreferences();

  // Load app preferences and apply dock visibility
  appPreferences = loadAppPreferences();
  // Default to showing in dock if preference not set
  const showInDock = appPreferences.showInDock ?? true;
  if (process.platform === "darwin") {
    try {
      if (showInDock) {
        app.dock.show();
        logger.main.info("[AppPrefs] Dock icon visible");
      } else {
        app.dock.hide();
        logger.main.info("[AppPrefs] Dock icon hidden");
      }
    } catch (error) {
      logger.main.error("[AppPrefs] Failed to set dock visibility:", error);
    }
  }

  // Stop the sidecar if current provider/model state cannot use it. Do not
  // pre-spawn on startup; packaged PyInstaller + MLX cold starts can starve
  // first paint and make onboarding feel frozen.
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
      // Sentry endpoints for error reporting
      "https://*.sentry.io",
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      "blob:",
      "data:",
    ].join(" ");

    // Avoid 'unsafe-eval' to satisfy Electron security recommendations
    const scriptSrc = `script-src 'self' ${isDev ? "'unsafe-inline'" : ""}`;
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
    // Only enforce COOP/COEP in strict prod (not dev or staging)
    const isStrictProd =
      app.isPackaged &&
      !(
        VITE_ENV?.VITE_SENTRY_ENVIRONMENT === "staging" ||
        VITE_ENV?.VITE_SENTRY_ENVIRONMENT === "dev"
      );
    if (isStrictProd) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }

    callback({ responseHeaders: headers });
  });
  console.log("[Main Process] Renderer security headers configured.");

  app.commandLine.appendSwitch("disable-http-cache");

  // Startup flow:
  // - FORCE_ONBOARDING => always show onboarding (ignore local flag)
  // - Otherwise, skip onboarding when SKIP_ONBOARDING or local done flag
  if (
    !FORCE_ONBOARDING &&
    (SKIP_ONBOARDING || onboardingPrefs?.done === true)
  ) {
    console.log("[Startup] SKIP_ONBOARDING enabled — launching main window");
    try {
      createWindow();
      createTray();
      // Start continuous follow, and start helper only if IM already granted
      startFollowCursor();
      pttTarget = "main";
      startHelperIfIMGranted();
      console.log("[Debug] Main window launched (onboarding skipped)");

      // Detect and store notch width if not already stored
      if (!pillPreferences.notchWidth) {
        detectAndStoreNotchWidth()
          .then((width) => {
            if (width && mainWindow && !mainWindow.isDestroyed()) {
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
  const micPrefs = loadMicPreferences();
  console.log("[Main Process] Microphone preferences loaded:", micPrefs);
  initMicManager(micPrefs, () => rebuildTrayMenu());

  // Silent background check for app location will be triggered after onboarding completes

  // Onboarding IPC handlers
  ipcMain.handle("helper:start", () => {
    console.log("[IPC] Starting helper process after onboarding");
    startFnListener();
    return { success: true };
  });

  // (Removed) dev-only Sentry test hooks

  // Prepare the pill window and tray before onboarding completes
  ipcMain.handle("prepare-pill", () => {
    console.log("[IPC] Preparing pill window and tray during onboarding");
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
      createTray();
      // Start continuous follow once window exists
      startFollowCursor();
      // Ensure pill is hidden until the test step asks to show it
      pttTarget = "main";
      if (mainWindow && !mainWindow.isDestroyed()) {
        const currentBounds = mainWindow.getBounds();
        const display = screen.getDisplayMatching(currentBounds);
        const hideY = display.bounds.y + ISLAND_HIDDEN_Y;
        mainWindow.setBounds(
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

  // Generic external URL opener for links
  ipcMain.handle("open-external", async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      console.error("[IPC] open-external failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("ptt:set-target", (_event, target: PttTarget) => {
    console.log(`[IPC] Setting PTT target to: ${target}`);
    pttTarget = target;
    return { success: true };
  });

  ipcMain.handle("onboarding-complete", () => {
    console.log("[IPC] Onboarding complete, starting app");
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    // Persist local onboarding flag so future launches can skip onboarding entirely
    try {
      onboardingPrefs = {
        ...onboardingPrefs,
        done: true,
        currentStep: undefined,
      };
      fs.writeFileSync(
        onboardingPrefsPath,
        JSON.stringify(onboardingPrefs, null, 2),
        "utf8",
      );
    } catch {}
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      // Ensure the pill window is visible and interactive
      smoothShow(mainWindow);
    }
    createTray();
    // Start helper only if IM is already granted; otherwise defer
    pttTarget = "main";
    startHelperIfIMGranted();
    // (Removed) silent app location check after onboarding

    // Detect and store notch width if not already stored (for new users)
    if (!pillPreferences.notchWidth) {
      detectAndStoreNotchWidth()
        .then((width) => {
          if (width && mainWindow && !mainWindow.isDestroyed()) {
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

    // Renderer will show any post-sign-in notification; keep main focused on window.
  });

  // Reset local onboarding flag for dev testing
  ipcMain.handle("onboarding:reset-local-flag", () => {
    try {
      onboardingPrefs = { ...onboardingPrefs, done: false };
      fs.writeFileSync(
        onboardingPrefsPath,
        JSON.stringify(onboardingPrefs, null, 2),
        "utf8",
      );
      console.log("[IPC] Local onboarding flag reset to false");
      return { ok: true };
    } catch (error) {
      console.error("[IPC] Failed to reset local onboarding flag:", error);
      return { ok: false };
    }
  });

  // Get saved onboarding step
  ipcMain.handle("onboarding:get-step", () => {
    return onboardingPrefs.currentStep || null;
  });

  // Save current onboarding step
  ipcMain.handle("onboarding:set-step", (_event, step: string) => {
    try {
      onboardingPrefs = { ...onboardingPrefs, currentStep: step };
      fs.writeFileSync(
        onboardingPrefsPath,
        JSON.stringify(onboardingPrefs, null, 2),
        "utf8",
      );
      return { ok: true };
    } catch (error) {
      console.error("[IPC] Failed to save onboarding step:", error);
      return { ok: false };
    }
  });

  // Allow other windows (onboarding) to request the pill to expand without directly moving the window
  ipcMain.handle("pill:expand", () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!mainWindow) return { ok: false };

      // Bring pill to visible top-aligned position and reveal
      const current = mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      const needMove = current.y !== targetY;
      if (needMove) {
        mainWindow.setBounds(
          {
            x: current.x,
            y: targetY,
            width: current.width,
            height: current.height,
          },
          false,
        );
        if (process.platform === "darwin") mainWindow.invalidateShadow();
      }
      // Only run fade-in if currently hidden to avoid flicker
      if (!mainWindow.isVisible()) {
        smoothShow(mainWindow);
      }

      // Ask renderer to expand the pill UI
      mainWindow.webContents.send("expand-pill");
      return { ok: true };
    } catch (e) {
      console.warn("[pill:expand] Failed to expand pill:", e);
      return { ok: false };
    }
  });

  // Reveal the pill without expanding (used by onboarding test steps)
  ipcMain.handle("pill:reveal", () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!mainWindow) return { ok: false };

      // During onboarding, ensure pill stays hidden and below the top edge
      if (pttTarget === "onboarding") {
        const current = mainWindow.getBounds();
        const display = screen.getDisplayMatching(current);
        const hideY = display.bounds.y + ISLAND_HIDDEN_Y;
        if (current.y !== hideY) {
          mainWindow.setBounds(
            {
              x: current.x,
              y: hideY,
              width: current.width,
              height: current.height,
            },
            false,
          );
          if (process.platform === "darwin") mainWindow.invalidateShadow();
        }
        // Do not show the window while onboarding owns the flow
        return { ok: true };
      }

      const current = mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      const needMove = current.y !== targetY;
      if (needMove) {
        mainWindow.setBounds(
          {
            x: current.x,
            y: targetY,
            width: current.width,
            height: current.height,
          },
          false,
        );
        if (process.platform === "darwin") mainWindow.invalidateShadow();
      }
      if (!mainWindow.isVisible()) {
        smoothShow(mainWindow);
      }
      return { ok: true };
    } catch (e) {
      console.warn("[pill:reveal] Failed to reveal pill:", e);
      return { ok: false };
    }
  });

  // Reveal pill specifically for onboarding test steps (compact, no expansion)
  ipcMain.handle("pill:reveal-for-test", () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!mainWindow) return { ok: false };

      // Allow reveal only during onboarding test steps; keep compact and at visible Y
      const current = mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      if (current.y !== targetY) {
        mainWindow.setBounds(
          {
            x: current.x,
            y: targetY,
            width: current.width,
            height: current.height,
          },
          false,
        );
        if (process.platform === "darwin") mainWindow.invalidateShadow();
      }
      if (!mainWindow.isVisible()) {
        smoothShow(mainWindow);
      }
      return { ok: true };
    } catch (e) {
      console.warn("[pill:reveal-for-test] Failed:", e);
      return { ok: false };
    }
  });

  // Handle pill context menu
  ipcMain.on("show-pill-context-menu", () => {
    console.log("[IPC Main] Received show-pill-context-menu event");
    if (mainWindow) {
      // Send refresh request to renderer processes before showing menu to ensure device list is current
      BrowserWindow.getAllWindows().forEach((window) => {
        console.log(
          "[Pill Menu] Sending mic:refresh-devices to window:",
          window.id,
        );
        window.webContents.send("mic:refresh-devices");
      });

      const menuTemplate = buildPillContextMenu();
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  // React to OS display changes to keep the pill consistent
  screen.on("display-added", () => {
    syncToCurrentDisplay("display-added");
    void refreshNotchInfoAndEmit("display-added");
  });
  screen.on("display-removed", () => {
    syncToCurrentDisplay("display-removed");
    void refreshNotchInfoAndEmit("display-removed");
  });
  screen.on("display-metrics-changed", () => {
    syncToCurrentDisplay("display-metrics-changed");
    void refreshNotchInfoAndEmit("display-metrics-changed");
  });

  // Handle pill expansion requests
  ipcMain.on("expand-pill", () => {
    console.log("[IPC Main] Received expand-pill event");
    if (mainWindow) {
      mainWindow.webContents.send("expand-pill");
    }
  });

  ipcMain.on(
    "show-notification",
    (
      _event: Electron.IpcMainEvent,
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
      mainWindow?.webContents.send("notify", next);
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

  // Floating bar visibility controls for renderer-driven UX flows
  ipcMain.handle("floating-bar:is-visible", () => {
    try {
      const visible = !!(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible()
      );
      return { visible };
    } catch {
      return { visible: false };
    }
  });

  ipcMain.handle("floating-bar:get-enabled", () => {
    return { enabled: isFloatingBarEnabled() };
  });

  // Hide indefinitely without emitting an additional notification (renderer handles UX)
  ipcMain.handle("floating-bar:hide-indefinitely", () => {
    try {
      clearHideTimer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        smoothHide(mainWindow);
      }
      setFloatingBarEnabled(false);
      rebuildTrayMenu(); // Update tray menu to reflect new state
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle("floating-bar:show", () => {
    try {
      clearHideTimer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        smoothShow(mainWindow);
      }
      setFloatingBarEnabled(true);
      rebuildTrayMenu(); // Update tray menu to reflect new state
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // Dock visibility controls (macOS only)
  ipcMain.handle("dock:get-visible", () => {
    const visible = appPreferences.showInDock ?? true;
    return { visible };
  });

  ipcMain.handle(
    "dock:set-visible",
    async (_event, payload: { visible: boolean }) => {
      try {
        const { visible } = payload;

        // Set flag to prevent blur-triggered collapse during dock operation
        dockOperationInProgress = true;

        // Only apply dock operations on macOS
        if (process.platform === "darwin") {
          if (visible) {
            await app.dock.show();
            logger.main.info("[Dock] Showing dock icon");
          } else {
            app.dock.hide();
            logger.main.info("[Dock] Hiding dock icon");
          }
        }

        // Save preference regardless of platform
        appPreferences.showInDock = visible;
        saveAppPreferences(appPreferences);

        // Clear flag after a brief delay to allow focus to settle
        setTimeout(() => {
          dockOperationInProgress = false;
        }, 300);

        return { ok: true };
      } catch (e) {
        dockOperationInProgress = false; // Clear flag on error
        logger.main.error("[Dock] Failed to set visibility:", e);
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // Transcription history storage handlers
  ipcMain.handle("transcriptions:get-all", () => {
    return getTranscriptions();
  });

  ipcMain.handle(
    "transcriptions:save",
    (
      _event,
      payload: { text: string; timestamp: number; mode: "dictation" | "edit" },
    ) => {
      return saveTranscription(payload);
    },
  );

  ipcMain.handle("transcriptions:delete", (_event, payload: { id: string }) => {
    return deleteTranscription(payload.id);
  });

  ipcMain.handle("transcriptions:clear", () => {
    clearTranscriptions();
    return { ok: true };
  });

  // Removed legacy dynamic window resize handler (renderer now animates within fixed envelope)

  // Handle dynamic click-through control
  ipcMain.on("set-click-through", (event, clickThrough: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    }
  });

  // Allow renderer to toggle focusable during expanded settings mode
  ipcMain.on("set-focusable", (event, focusable: boolean) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // setFocusable is a no-op on some platforms; call defensively
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mainWindow as any).setFocusable?.(focusable);
      }
    } catch (e) {
      // ignore
    }
  });

  // Allow renderer to focus the window (needed for proper cursor hover states)
  ipcMain.on("focus-window", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    } catch (e) {
      // ignore
    }
  });

  // Removed legacy explicit show/hide handlers in favor of island-slide and state-driven visibility

  ipcMain.on("island-slide", (_e, y) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const display = getActiveDisplay();
      const current = mainWindow.getBounds();
      const newY = display.bounds.y + y; // slide offset relative to target display
      // Only change Y during slide to avoid compositor thrash; X is handled on display change/envelope resize
      const target = {
        x: current.x,
        y: newY,
        width: current.width,
        height: current.height,
      };
      coalescedSetBounds(target);
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

  // ============ Local Whisper IPC handlers ============

  ipcMain.handle("stt:get-model-status", () => {
    return getModelStatus();
  });

  ipcMain.handle("stt:install-model", async () => {
    await installLocalModelAndSyncSidecar();
  });

  ipcMain.handle("stt:remove-model", async () => {
    await removeLocalModelAndStopSidecar();
  });

  // ============ Enhancement + OCR IPC handlers ============

  ipcMain.handle(
    "stt:enhance",
    async (
      _event,
      payload: {
        text: string;
        vocabulary?: string[];
        mode?: "dictation" | "edit";
        selectionText?: string;
      },
    ) => {
      return enhance(payload.text, {
        vocabulary: payload.vocabulary,
        mode: payload.mode,
        selectionText: payload.selectionText,
      });
    },
  );

  ipcMain.handle("stt:extract-ocr", async (_event, imageBase64: string) => {
    const providerId = resolveEnhancementProvider(getPreferredProviderId());
    if (!providerId) {
      return { words: [] };
    }
    return extractOcrWords(imageBase64, providerId);
  });

  ipcMain.handle("stt:transcribe-local", async (_event, pcmBuffer: Buffer) => {
    try {
      return await transcribeWithLocalSidecar(pcmBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[STT] transcribe-local failed:", msg);
      throw err;
    }
  });

  ipcMain.handle("stt:get-preferred-provider", () => {
    return getPreferredProviderId();
  });

  ipcMain.handle("stt:get-provider-settings", () => {
    return getProviderSettingsSnapshot();
  });

  ipcMain.handle(
    "stt:set-preferred-provider",
    async (_event, providerId: PreferredTranscriptionProviderId) => {
      if (!isSelectableTranscriptionProviderId(providerId)) {
        throw new Error(`Unknown transcription provider '${providerId}'.`);
      }

      if (
        isApiKeyTranscriptionProviderId(providerId) &&
        !hasProviderApiKey(providerId)
      ) {
        throw new Error(`Save an API key before selecting this provider.`);
      }

      setPreferredProviderId(providerId);
      await syncLocalSidecarForCurrentProvider();
    },
  );

  ipcMain.handle(
    "stt:transcribe-api-key-provider",
    async (
      _event,
      payload: {
        providerId: string;
        audioBuffer: Buffer;
        mimeType?: string;
        context: TranscriptionContext;
      },
    ) => {
      if (!isApiKeyTranscriptionProviderId(payload.providerId)) {
        throw new Error(
          `Provider '${payload.providerId}' does not support direct API-key transcription.`,
        );
      }

      if (payload.providerId === OPENAI_CLOUD_PROVIDER_ID) {
        return transcribeWithOpenAi(
          payload.audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      if (payload.providerId === GROQ_CLOUD_PROVIDER_ID) {
        return transcribeWithGroq(
          payload.audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      if (payload.providerId === DEEPGRAM_CLOUD_PROVIDER_ID) {
        return transcribeWithDeepgram(
          payload.audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      throw new Error(
        `Provider '${payload.providerId}' does not have a transcription handler.`,
      );
    },
  );

  ipcMain.handle(
    "stt:set-provider-api-key",
    (_event, payload: { providerId: string; apiKey: string }) => {
      if (!isApiKeyTranscriptionProviderId(payload.providerId)) {
        throw new Error(
          `Provider '${payload.providerId}' does not accept a stored API key.`,
        );
      }

      const apiKey = payload.apiKey.trim();
      if (!apiKey) {
        throw new Error("API key cannot be empty.");
      }

      setProviderApiKey(payload.providerId, apiKey);

      return getProviderSettingsSnapshot();
    },
  );

  ipcMain.handle("stt:clear-provider-api-key", (_event, providerId: string) => {
    if (!isApiKeyTranscriptionProviderId(providerId)) {
      throw new Error(
        `Provider '${providerId}' does not accept a stored API key.`,
      );
    }

    if (getPreferredProviderId() === providerId) {
      throw new Error(
        "Switch transcription providers before clearing the active provider's API key.",
      );
    }

    clearProviderApiKey(providerId);

    return getProviderSettingsSnapshot();
  });

  // Handle last transcript updates from renderer
  ipcMain.on("transcript:update", (_event, text: string) => {
    console.log(
      "[IPC] Received transcript update:",
      text.slice(0, 50) + (text.length > 50 ? "..." : ""),
    );
    lastTranscript = text;
    BrowserWindow.getAllWindows().forEach((window) => {
      try {
        window.webContents.send("transcript:updated", text);
      } catch {}
    });
  });

  // Permission IPC handlers (check/request AX, IM, mic, screen recording)
  registerPermissionHandlers({
    onImGranted: () => startHelperIfIMGranted(),
  });

  ipcMain.handle("reload-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("get-app-path", () => {
    return app.getAppPath();
  });

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

  // Provide application version to renderer via preload bridge
  ipcMain.handle("app:get-version", () => {
    try {
      return app.getVersion();
    } catch (e) {
      return "";
    }
  });

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
            mainWindow?.webContents.send("mic:refresh-devices");
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
    if (onboardingWindow) {
      onboardingWindow.close();
    }
  });

  ipcMain.handle("minimize-onboarding", () => {
    if (onboardingWindow) {
      onboardingWindow.minimize();
    }
  });

  ipcMain.handle("maximize-onboarding", () => {
    if (onboardingWindow) {
      if (onboardingWindow.isMaximized()) {
        onboardingWindow.unmaximize();
      } else {
        onboardingWindow.maximize();
      }
    }
  });

  // Register global shortcut for pasting last transcript
  const shortcutRegistered = globalShortcut.register(
    "CommandOrControl+Control+V",
    () => {
      console.log("[GlobalShortcut] Command+Control+V pressed");
      // Notify renderer that paste shortcut was pressed (for history-on-expand UX)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("paste-shortcut-pressed");
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

app.on("before-quit", () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
  console.log("[GlobalShortcut] All shortcuts unregistered");
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
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log("[App Event] activate: Showing hidden main window");
      mainWindow.show();
      return;
    }

    // If no windows exist at all, create the appropriate window
    if (allWindows.length === 0) {
      console.log("[App Event] activate: No windows exist, creating window");
      if (
        !FORCE_ONBOARDING &&
        (SKIP_ONBOARDING || onboardingPrefs?.done === true)
      )
        createWindow();
      else createOnboardingWindow();
    }
    // If windows exist but are all destroyed/invalid, recreate main window
    else if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("[App Event] activate: Main window is destroyed, recreating");
      if (
        !FORCE_ONBOARDING &&
        (SKIP_ONBOARDING || onboardingPrefs?.done === true)
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
  isQuitting = true;
  // Attempt to flush pending Sentry events before quitting (best-effort)
  try {
    void Sentry.close(2000);
  } catch {}
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

  // **belts-and-suspenders**: kill anything matching the name
  try {
    execSync("pkill -9 -f 'Spoke Helper' || true");
  } catch (e) {
    // ignore
  }
  try {
    execSync("pkill -9 -f spoke-helper    || true");
  } catch (e) {
    // ignore
  }
});

app.on("will-quit", () => {
  console.log("[MainProcess] App is quitting.");
  try {
    void Sentry.close(2000);
  } catch {}
  // Extra guard to ensure polling is stopped
  stopFollowCursor();

  // Clear restart timeout and kill spoke-helper process
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }

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

function startFnListener() {
  // Clear any pending restart timer and reset permission flag
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }

  // Reset permission denied flag when explicitly starting listener
  // (e.g., on app startup or manual restart)
  fnPermissionDenied = false;

  // Clear any buffered stdout data from previous process
  fnStdoutBuffer = "";

  // Clean up existing process to prevent orphaned processes
  if (fnProc && !fnProc.killed) {
    console.log(
      "[FnListener] Cleaning up existing spoke-helper process before starting new one",
    );
    try {
      fnProc.kill("SIGTERM");
    } catch (error) {
      console.warn(
        "[FnListener] Error killing existing spoke-helper process:",
        error,
      );
    }
    fnProc = null;
  }

  const helperPath = getHelperPath();

  // Check if the helper binary exists before attempting to spawn
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[FnListener] Spoke Helper binary not found at path: ${helperPath}`,
    );

    const targetWindow = mainWindow || onboardingWindow;
    targetWindow?.webContents.send(
      "notify",
      "Hotkey detection unavailable: binary missing",
    );
    return;
  }

  try {
    console.log(
      `[FnListener] Starting Spoke Helper helper from: ${helperPath}`,
    );
    fnProc = spawnHelper(
      helperPath,
      [],
      true,
    ) as import("child_process").ChildProcessWithoutNullStreams;

    fnProc.stdout.setEncoding("utf8");
    fnProc.stdout.on("data", (chunk: string) => {
      // Append chunk to buffer to handle commands split across boundaries
      fnStdoutBuffer += chunk;

      // Process complete lines
      const lines = fnStdoutBuffer.split(/\r?\n/);

      // Keep the last (potentially incomplete) line in the buffer
      fnStdoutBuffer = lines.pop() || "";

      // Process complete lines
      lines.forEach((line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return; // Skip empty lines

        console.log(`[FnListener] Received command: "${trimmedLine}"`);

        let targetWindow: BrowserWindow | null = null;
        if (pttTarget === "onboarding")
          targetWindow = onboardingWindow || mainWindow;
        else if (pttTarget === "main")
          targetWindow = mainWindow || onboardingWindow;
        else targetWindow = onboardingWindow || mainWindow;
        const mirrorWindow =
          targetWindow === mainWindow ? onboardingWindow : mainWindow;
        if (trimmedLine === "ready") {
          // Signal to both windows that PTT is ready
          onboardingWindow?.webContents.send("ptt-ready");
          mainWindow?.webContents.send("ptt-ready");
          // Ignore legacy generic and Fn events; only handle Right Option/Command
        } else if (trimmedLine === "optR-down") {
          // Right Option: primary PTT hotkey (press-and-hold)
          preSpawnPasteHelper();
          targetWindow?.webContents.send("ptt-down");
          if (
            pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-down");
        } else if (trimmedLine === "optR-up") {
          // End of PTT press-and-hold
          killPasteDaemon();
          targetWindow?.webContents.send("ptt-up");
          if (
            pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-up");
        } else if (trimmedLine === "cmdR-down") {
          // Right Command: visual press state only
          targetWindow?.webContents.send("ptt-cancel-down");
          if (
            pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-cancel-down");
        } else if (trimmedLine === "cmdR-up") {
          // Right Command: trigger cancel on release
          targetWindow?.webContents.send("ptt-cancel");
          if (
            pttTarget === "main" &&
            mirrorWindow &&
            mirrorWindow !== targetWindow
          )
            mirrorWindow.webContents.send("ptt-cancel");
        } else if (
          trimmedLine === "optL-down" ||
          trimmedLine === "optL-up" ||
          trimmedLine === "cmdL-down" ||
          trimmedLine === "cmdL-up"
        ) {
          // Ignore left-side modifiers explicitly
        } else if (trimmedLine === "perm-denied") {
          fnPermissionDenied = true;

          // Show tray notification immediately
          targetWindow?.webContents.send(
            "notify",
            "Grant Input Monitoring permission → restart",
          );
          // Do not show modal dialogs automatically; rely on pill notification UX
        } else {
          // Ignore any other helper messages silently
        }
      });
    });

    fnProc.stderr?.on("data", (chunk: string) => {
      console.error(`[FnListener] Spoke Helper stderr: ${chunk.toString()}`);
    });

    fnProc.on("error", (error: Error) => {
      console.error(
        "[FnListener] Failed to start Spoke Helper helper process:",
        error,
      );
      fnProc = null;

      const targetWindow =
        pttTarget === "main"
          ? mainWindow || onboardingWindow
          : onboardingWindow || mainWindow;
      if (error.message.includes("ENOENT")) {
        console.error(
          "[FnListener] Spoke Helper binary not found or not executable",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: binary not found",
        );
      } else if (error.message.includes("EACCES")) {
        console.error(
          "[FnListener] Spoke Helper binary lacks execution permissions",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: permission denied",
        );
      } else {
        console.error(
          "[FnListener] Unknown error starting Spoke Helper:",
          error.message,
        );
        (pttTarget === "main"
          ? mainWindow || onboardingWindow
          : onboardingWindow || mainWindow
        )?.webContents.send(
          "notify",
          "Hotkey detection unavailable: startup error",
        );
      }

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("error");
    });

    fnProc.on("close", (code, signal) => {
      console.log(
        `[FnListener] Spoke Helper helper process closed with code ${code}, signal ${signal}`,
      );
      fnProc = null;

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("close");
    });

    fnProc.on("exit", (code, signal) => {
      console.log(
        `[FnListener] Spoke Helper helper process exited with code ${code}, signal ${signal}`,
      );
    });
  } catch (error) {
    console.error(
      "[FnListener] Exception when spawning Spoke Helper helper:",
      error,
    );
    fnProc = null;

    const targetWindow =
      pttTarget === "main"
        ? mainWindow || onboardingWindow
        : onboardingWindow || mainWindow;
    targetWindow?.webContents.send(
      "notify",
      "Hotkey detection unavailable: spawn failed",
    );

    // Schedule restart only if not already scheduled and not quitting
    scheduleRestart("exception");
  }
}

function scheduleRestart(reason: string) {
  // Don't restart if already scheduled, if quitting, or if permissions were denied
  if (fnRestartTimeout || isQuitting || fnPermissionDenied) {
    if (fnPermissionDenied) {
      console.log(
        "[FnListener] Not scheduling restart due to permission denial. User must restart app after granting permissions.",
      );
      return;
    }
    console.log(
      `[FnListener] Not scheduling restart: already scheduled=${!!fnRestartTimeout}, quitting=${isQuitting}`,
    );
    return;
  }

  // Only auto-restart on crashes, not permission denials
  const delayMs = reason === "close" ? 5000 : 10000;
  console.log(
    `[FnListener] Scheduling restart in ${delayMs / 1000}s due to ${reason}...`,
  );

  fnRestartTimeout = setTimeout(() => {
    fnRestartTimeout = null;
    if (!fnPermissionDenied && !isQuitting) {
      console.log(`[FnListener] Executing scheduled restart due to ${reason}`);
      startFnListener();
    } else {
      console.log(
        `[FnListener] Skipping scheduled restart: permissions denied=${fnPermissionDenied}, quitting=${isQuitting}`,
      );
    }
  }, delayMs);
}
