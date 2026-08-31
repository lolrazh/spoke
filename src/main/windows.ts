/**
 * Windows
 *
 * Factories and lifecycle wiring for the two top-level windows: the
 * always-on-top "pill" (main) window and the onboarding window. Also owns
 * the per-display sizing/positioning math (notch-aware envelope sizing,
 * follow-cursor polling, coalesced bounds updates) that keeps the pill
 * flush to the active display's safe area.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  screen,
  type Display,
  type Point,
  type Rectangle,
  type BrowserWindowConstructorOptions,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ISLAND_WIDTH,
  ISLAND_HEIGHT,
  ISLAND_VISIBLE_Y,
  SHADOW_PAD,
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
} from "../constants/window";
import { ONBOARDING_WIDTH, ONBOARDING_HEIGHT } from "../constants/onboarding";
import {
  CURSOR_POLL_INTERVAL_MS,
  REFERENCE_WIDTH,
  MIN_UI_SCALE,
  MAX_UI_SCALE,
} from "../constants/display";
import { logger } from "../utils/logger";
import { bootTimeline } from "./bootTimeline";
import {
  attachRendererConsoleFileSink,
} from "./diagnosticLog";
import { applyNavigationGuards } from "./navigationGuards";
import { getIconPath } from "./iconPaths";
import {
  refreshNotchInfo,
  getNotchInfoForDisplay,
  getNotchReport,
  cloneDisplayNotchInfo,
} from "./notchReporter";
import { savePillPreferences } from "./preferences";
import { smoothShow } from "./windowAnimation";
import { clearHideTimer } from "./floatingBar";
import { prewarmLocalSidecar } from "./localSttLifecycle";
import { state } from "./windowState";
import { createTray, rebuildTrayMenu } from "./tray";

// Vite injects env at build time; provide a typed fallback for the main process
const VITE_ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env ?? {};

const iconPath = getIconPath();

// Optical adjustment for notch width (pixels to subtract for better visual alignment)
const NOTCH_WIDTH_OPTICAL_ADJUSTMENT = 2;

// === Active display tracking for continuous follow ===
let followCursorInterval: NodeJS.Timeout | null = null;
// Whether follow-cursor is logically enabled. Polling itself is paused while
// the pill window is hidden, but this stays true so "show" can resume it.
let followCursorActive = false;
let coalesceTimer: NodeJS.Timeout | null = null;
let pendingBounds: Rectangle | null = null;
let lastFollowCursorPoint: Point | null = null;

function getDisplayForPoint(point: Point): Display {
  return screen.getDisplayNearestPoint(point);
}

function getActiveDisplay(): Display {
  if (state.activeDisplayId != null) {
    const existing = screen
      .getAllDisplays()
      .find((d) => d.id === state.activeDisplayId);
    if (existing) return existing;
  }
  return getDisplayForPoint(screen.getCursorScreenPoint());
}

export function getDisplayForWindow(): Display {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) {
    return getActiveDisplay();
  }
  const b = state.mainWindow.getBounds();
  // Prefer the display that best matches the window bounds (largest area intersection)
  const match = screen.getDisplayMatching(b);
  if (match) return match;
  // Fallback: use the display nearest to the window center point
  const cx = Math.round(b.x + b.width / 2);
  const cy = Math.round(b.y + b.height / 2);
  return screen.getDisplayNearestPoint({ x: cx, y: cy });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeScaleForDisplay(display: Display): number {
  // Shrink-only scaling: keep 1.0 on wider displays, scale down on smaller ones
  // Reference width tuned to typical modern Macs (1728 logical px). Range: [0.9, 1.0]
  const raw = display.size.width / REFERENCE_WIDTH;
  return clamp(raw, MIN_UI_SCALE, MAX_UI_SCALE);
}

function ensureEnvelopeForDisplay(
  display: Display,
): { scale: number; width: number; height: number } | null {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return null;
  const scale = computeScaleForDisplay(display);

  // Expanded pill content, scaled per active display
  const targetContentW = Math.round(CONTENT_WIDTH * scale);
  const targetContentH = Math.round(CONTENT_HEIGHT * scale);
  const targetW = Math.max(ISLAND_WIDTH, targetContentW + SHADOW_PAD * 2);
  const targetH = Math.max(ISLAND_HEIGHT, targetContentH + SHADOW_PAD * 2);

  const current = state.mainWindow.getBounds();
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

export function emitActiveDisplayInfo(display: Display, scale: number): void {
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
    const storedNotchWidth = state.pillPreferences.notchWidth ?? null;

    const payload = {
      id: display.id,
      bounds: display.bounds,
      size: display.size,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      scale,
      // Current window envelope for reference
      window: state.mainWindow?.getBounds() ?? null,
      notch: notchPayload,
      storedNotchWidth,
    };
    state.mainWindow?.webContents.send("active-display", payload);
  } catch (e) {
    logger.main.warn("emitActiveDisplayInfo failed", e);
  }
}

// After refreshing notch info, also update the renderer with new display data
async function refreshNotchInfoAndEmit(reason: string): Promise<void> {
  await refreshNotchInfo(reason);
  try {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      const display = getDisplayForWindow();
      const scale = computeScaleForDisplay(display);
      emitActiveDisplayInfo(display, scale);
    }
  } catch (err) {
    logger.main.warn("[Notch] Failed to emit updated notch info", err);
  }
}

export async function detectAndStoreNotchWidth(): Promise<number | null> {
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
  state.pillPreferences.notchWidth = finalWidth;
  savePillPreferences(state.pillPreferences);

  return finalWidth;
}

// (Re)arm the polling timer. Internal: callers gate on followCursorActive and
// window visibility.
function runFollowCursorInterval(): void {
  if (followCursorInterval) {
    clearInterval(followCursorInterval);
    followCursorInterval = null;
  }
  lastFollowCursorPoint = null;
  // 5 Hz polling to reduce CPU usage while still tracking display changes
  followCursorInterval = setInterval(() => {
    try {
      const point = screen.getCursorScreenPoint();
      if (
        lastFollowCursorPoint?.x === point.x &&
        lastFollowCursorPoint?.y === point.y
      ) {
        return;
      }
      lastFollowCursorPoint = point;
      const display = getDisplayForPoint(point);
      if (display.id !== state.activeDisplayId) {
        state.activeDisplayId = display.id;
        const result = ensureEnvelopeForDisplay(display);
        const scale = result?.scale ?? computeScaleForDisplay(display);
        emitActiveDisplayInfo(display, scale);
      }
    } catch (err) {
      logger.main.warn("startFollowCursor tick failed", err);
    }
  }, CURSOR_POLL_INTERVAL_MS);
}

// Pause the timer without clearing the logical "active" flag, so a later
// "show" resumes polling.
function pauseFollowCursorInterval(): void {
  if (followCursorInterval) {
    clearInterval(followCursorInterval);
    followCursorInterval = null;
  }
  lastFollowCursorPoint = null;
}

export function startFollowCursor(): void {
  followCursorActive = true;
  // Don't burn CPU polling while the pill is hidden; the window "show" handler
  // resumes polling (and re-syncs the display).
  if (state.mainWindow && !state.mainWindow.isVisible()) {
    pauseFollowCursorInterval();
    return;
  }
  runFollowCursorInterval();
}

export function stopFollowCursor(): void {
  followCursorActive = false;
  pauseFollowCursorInterval();
}

/** Resume polling when the pill is shown, if follow-cursor is enabled. */
function resumeFollowCursorOnShow(): void {
  if (!followCursorActive) return;
  // Land the pill on the display it should be on before polling resumes.
  syncToCurrentDisplay();
  runFollowCursorInterval();
}

/** Pause polling when the pill is hidden. */
function pauseFollowCursorOnHide(): void {
  if (!followCursorActive) return;
  pauseFollowCursorInterval();
}

function syncToCurrentDisplay(): void {
  try {
    lastFollowCursorPoint = null;
    // On OS display changes, select display based on current window location
    const display = getDisplayForWindow();
    state.activeDisplayId = display.id;
    const sized = ensureEnvelopeForDisplay(display);
    const scale = sized?.scale ?? computeScaleForDisplay(display);
    emitActiveDisplayInfo(display, scale);
  } catch (e) {
    logger.main.warn("syncToCurrentDisplay failed", e);
  }
}

function coalescedSetBounds(bounds: Rectangle): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  const current = state.mainWindow.getBounds();
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
    const finalBounds = pendingBounds ?? state.mainWindow!.getBounds();
    pendingBounds = null;
    try {
      state.mainWindow!.setBounds(finalBounds, false);
      if (process.platform === "darwin") state.mainWindow!.invalidateShadow();
    } catch (e) {
      // ignore
    }
  }, 16);
}

// refreshNotchInfo spawns a native binary each time, and display-metrics-changed
// fires in bursts (e.g. resolution/arrangement changes). Debounce the refresh so
// a burst spawns the helper once, on the trailing edge; the emit still runs after
// that final refresh completes.
const NOTCH_REFRESH_DEBOUNCE_MS = 300;
let notchRefreshTimer: NodeJS.Timeout | null = null;

function debouncedRefreshNotchInfoAndEmit(reason: string): void {
  if (notchRefreshTimer) clearTimeout(notchRefreshTimer);
  notchRefreshTimer = setTimeout(() => {
    notchRefreshTimer = null;
    void refreshNotchInfoAndEmit(reason);
  }, NOTCH_REFRESH_DEBOUNCE_MS);
}

// React to OS display changes to keep the pill consistent
export function registerDisplayChangeListeners(): void {
  screen.on("display-added", () => {
    syncToCurrentDisplay();
    debouncedRefreshNotchInfoAndEmit("display-added");
  });
  screen.on("display-removed", () => {
    syncToCurrentDisplay();
    debouncedRefreshNotchInfoAndEmit("display-removed");
  });
  screen.on("display-metrics-changed", () => {
    syncToCurrentDisplay();
    debouncedRefreshNotchInfoAndEmit("display-metrics-changed");
  });
}

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

export function scheduleLocalSidecarPrewarm(
  reason: string,
  delayMs: number,
): void {
  bootTimeline.mark("sidecar-prewarm:scheduled", { reason, delayMs });
  const timer = setTimeout(() => {
    bootTimeline.mark("sidecar-prewarm:timer-fired", { reason });
    prewarmLocalSidecar(reason);
  }, delayMs);
  timer.unref?.();
}

function scheduleMainWindowPostReadyWork(): void {
  if (state.mainWindowPostReadyWorkScheduled) return;
  state.mainWindowPostReadyWorkScheduled = true;

  const trayTimer = setTimeout(() => {
    createTray();
  }, 50);
  trayTimer.unref?.();

  scheduleLocalSidecarPrewarm("renderer-ready", 250);
}

export const createWindow = () => {
  bootTimeline.mark("main-window:create:start");
  // Create the browser window.
  const windowOptions: BrowserWindowConstructorOptions = {
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
      sandbox: true,
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
      `Failed to load icon: ${error instanceof Error ? error.message : error}, continuing without icon`,
    );
  }

  state.mainWindow = new BrowserWindow(windowOptions);
  attachRendererConsoleFileSink(state.mainWindow.webContents, "main");
  applyNavigationGuards(state.mainWindow.webContents);
  bootTimeline.mark("main-window:browser-window-created");

  // Also try to set the icon explicitly after creation (optional but good practice)
  try {
    const icon = nativeImage.createFromPath(windowIconPath);
    if (!icon.isEmpty()) {
      state.mainWindow.setIcon(windowIconPath);
    }
  } catch (error) {
    console.warn(
      `Failed to set window icon: ${error instanceof Error ? error.message : error}`,
    );
  }

  // Set window behaviors for macOS
  if (process.platform === "darwin") {
    state.mainWindow.setAlwaysOnTop(true, "screen-saver");
    // Critical flags for full-screen overlay while keeping dock icon:
    // - visibleOnFullScreen: allows window to appear in full-screen Spaces
    // - skipTransformProcessType: prevents app from becoming UIElement/accessory, keeping dock icon
    state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // Prevent pill itself from going fullscreen
    state.mainWindow.setFullScreenable(false);
  }

  // Prepare DevTools behavior; actual show happens on renderer-ready handshake
  state.mainWindow.once("ready-to-show", () => {
    const win = state.mainWindow;
    if (!win) return;
    bootTimeline.mark("main-window:ready-to-show");
    // Ensure initial position is the visible top-aligned Y (flush to screen top)
    try {
      const current = win.getBounds();
      const currentDisplay = screen.getDisplayMatching(current);
      state.activeDisplayId = currentDisplay.id;
      const targetY = currentDisplay.workArea.y + ISLAND_VISIBLE_Y;
      win.setBounds(
        {
          x: current.x,
          y: targetY,
          width: current.width,
          height: current.height,
        },
        false,
      );
      if (process.platform === "darwin") win.invalidateShadow();
    } catch (e) {
      console.warn("Failed to top-align on ready-to-show:", e);
    }

    // DevTools behavior:
    if (VITE_ENV?.VITE_SF_DEVTOOLS === "1") {
      try {
        win.webContents.openDevTools({ mode: "detach" });
      } catch {}
      console.log("DevTools opened (staging)");
    } else if (
      MAIN_WINDOW_VITE_DEV_SERVER_URL &&
      process.env.SF_DEVTOOLS === "1"
    ) {
      // Only auto-open DevTools for the pill window when it's actually the main app target
      if (state.pttTarget === "main") {
        try {
          win.webContents.openDevTools({ mode: "detach" });
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
  state.mainWindow.on("closed", () => {
    console.log("Main window has been closed.");
    state.mainWindow = null; // Ensure reference is cleared
    state.mainWindowPostReadyWorkScheduled = false;
  });

  state.mainWindow.webContents.once("dom-ready", () => {
    bootTimeline.mark("main-window:dom-ready");
  });

  state.mainWindow.webContents.once("did-finish-load", () => {
    bootTimeline.mark("main-window:did-finish-load");
  });

  // Rebuild tray menu when main window visibility changes to update "Show Floating Bar" option
  state.mainWindow.on("show", () => {
    console.log("[Main Window] Window shown, rebuilding tray menu");
    // Clear any active hide timer when window is shown
    clearHideTimer();
    rebuildTrayMenu();
    resumeFollowCursorOnShow();
  });

  state.mainWindow.on("hide", () => {
    console.log("[Main Window] Window hidden, rebuilding tray menu");
    rebuildTrayMenu();
    pauseFollowCursorOnHide();
  });

  // Position window centered on the cursor's display and hidden under the notch
  const cursorDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  state.activeDisplayId = cursorDisplay.id;
  const initialX =
    cursorDisplay.bounds.x +
    Math.round((cursorDisplay.size.width - ISLAND_WIDTH) / 2);
  // Start aligned to safe top so the pill is always flush when shown
  const initialY = cursorDisplay.workArea.y + ISLAND_VISIBLE_Y;
  console.log(
    `[Window Creation] Display=${cursorDisplay.id} width=${cursorDisplay.size.width}px, Initial X=${initialX}, Y=${initialY}`,
  );
  state.mainWindow.setBounds({
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
  state.mainWindow.on("blur", () => {
    try {
      // Skip collapse during dock operations to prevent unwanted UX disruption
      if (state.dockOperationInProgress) return;
      state.mainWindow?.webContents.send("collapse-request");
    } catch {
      // ignore
    }
  });

  bootTimeline.mark("main-window:load-url:start");
  state.mainWindow.loadURL(getRendererEntryUrl()).catch((error) => {
    console.error("[Main Window] Failed to load renderer:", error);
  });

  // Hide menu bar
  state.mainWindow.setMenuBarVisibility(false);

  // Make window click-through by default, but keep hover/move events forwarded
  // This allows CSS cursors/tooltips/hover states to work even when click-through is enabled
  state.mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Only grant the permissions the app actually needs: 'media' covers the
  // microphone used for dictation. Everything else is denied.
  state.mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const granted = permission === "media";
      console.log(
        `${granted ? "Granting" : "Denying"} permission: ${permission} to ${webContents.getURL()}`,
      );
      callback(granted);
    },
  );
};

// Show windows only after their own renderers signal they are visually ready,
// and forward boot-timeline marks reported by the renderer. Registered at
// module load (not inside app.whenReady()) to match the original main.ts
// evaluation order.
export function registerWindowLifecycleIpc(): void {
  ipcMain.on("renderer-ready", (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || senderWin.isDestroyed()) return;

    // Only top-align and show if the pill (main) window is the sender
    if (senderWin === state.mainWindow) {
      bootTimeline.mark("main-window:renderer-ready", {
        target: state.pttTarget,
      });
      // During onboarding prepare, avoid auto-show to prevent flicker
      if (state.pttTarget !== "main") {
        return;
      }
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
      try {
        // Align to current display's safe top before revealing (guard)
        const current = state.mainWindow.getBounds();
        const currentDisplay = screen.getDisplayMatching(current);
        state.activeDisplayId = currentDisplay.id;
        const targetY = currentDisplay.workArea.y + ISLAND_VISIBLE_Y;
        state.mainWindow.setBounds(
          {
            x: current.x,
            y: targetY,
            width: current.width,
            height: current.height,
          },
          false,
        );
        if (process.platform === "darwin") state.mainWindow.invalidateShadow();
      } catch (e) {
        console.warn("[renderer-ready] Top-align failed:", e);
      }

      // Re-emit active display info now that renderer is ready to receive it
      try {
        const current = state.mainWindow.getBounds();
        const display = screen.getDisplayMatching(current);
        const scale = computeScaleForDisplay(display);
        emitActiveDisplayInfo(display, scale);
      } catch (e) {
        console.warn("[renderer-ready] Failed to emit display info:", e);
      }

      try {
        smoothShow(state.mainWindow);
      } catch (e) {
        console.warn("[renderer-ready] Failed to show:", e);
      }
      scheduleMainWindowPostReadyWork();
      return;
    }

    // If the onboarding window reports ready, do not manipulate the pill.
    if (senderWin === state.onboardingWindow) {
      bootTimeline.mark("onboarding-window:renderer-ready");
      try {
        if (!state.onboardingWindow?.isVisible())
          smoothShow(state.onboardingWindow);
      } catch (e) {
        console.warn("[renderer-ready] Failed to show onboarding:", e);
      }
    }
  });

  ipcMain.on(
    "boot:renderer-mark",
    (_event, payload: { label?: string; rendererMs?: number } | undefined) => {
      const label =
        typeof payload?.label === "string" && payload.label.trim()
          ? payload.label.trim()
          : "unknown";
      bootTimeline.mark(`renderer:${label}`, {
        rendererMs:
          typeof payload?.rendererMs === "number"
            ? Math.round(payload.rendererMs)
            : undefined,
      });
    },
  );
}

export function createOnboardingWindow() {
  bootTimeline.mark("onboarding-window:create:start");
  console.log("[Debug] Inside createOnboardingWindow function");
  const onboardingWindowOptions: BrowserWindowConstructorOptions = {
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
      sandbox: true,
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
  state.onboardingWindow = new BrowserWindow(onboardingWindowOptions);
  attachRendererConsoleFileSink(
    state.onboardingWindow.webContents,
    "onboarding",
  );
  applyNavigationGuards(state.onboardingWindow.webContents);
  bootTimeline.mark("onboarding-window:browser-window-created");
  console.log("[Debug] BrowserWindow created, setting menu bar visibility");
  state.onboardingWindow.setMenuBarVisibility(false);

  const onboardingUrl = getRendererEntryUrl("/onboarding");

  console.log("[Onboarding] Loading URL:", onboardingUrl);
  console.log("[Onboarding] __dirname:", __dirname);
  console.log("[Onboarding] MAIN_WINDOW_VITE_NAME:", MAIN_WINDOW_VITE_NAME);
  console.log("[Debug] About to load URL in onboarding window");

  bootTimeline.mark("onboarding-window:load-url:start");
  state.onboardingWindow.loadURL(onboardingUrl).catch((error) => {
    console.error("[Debug] Error loading URL:", error);
  });
  console.log("[Debug] URL load initiated");

  state.onboardingWindow.webContents.once("dom-ready", () => {
    bootTimeline.mark("onboarding-window:dom-ready");
  });

  state.onboardingWindow.webContents.once("did-finish-load", () => {
    bootTimeline.mark("onboarding-window:did-finish-load");
  });

  state.onboardingWindow.once("ready-to-show", () => {
    bootTimeline.mark("onboarding-window:ready-to-show");
  });

  // Add comprehensive error handling
  state.onboardingWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "[Onboarding] Failed to load:",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  state.onboardingWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error("[Onboarding] Renderer process gone:", details);
    },
  );

  state.onboardingWindow.on("unresponsive", () => {
    console.error("[Onboarding] Window became unresponsive");
  });

  state.onboardingWindow.on("closed", () => {
    console.log("[Debug] Onboarding window was closed");
  });

  // FIX 3: Wait for DOM and full rendering before showing window
  state.onboardingWindow.webContents.on("dom-ready", () => {
    console.log("[Onboarding] DOM ready");
  });

  // Wait for all resources to be ready; renderer will request showing when visually ready
  state.onboardingWindow.webContents.once("did-finish-load", () => {
    console.log("[Onboarding] Content finished loading");
  });

  // Keep DevTools behavior; showing is coordinated by renderer-ready
  const onboardingWindowForDevTools = state.onboardingWindow;
  onboardingWindowForDevTools.once("ready-to-show", () => {
    console.log("[Onboarding] Ready to show event fired");
    if (VITE_ENV?.VITE_SF_DEVTOOLS === "1") {
      try {
        onboardingWindowForDevTools.webContents.openDevTools({
          mode: "detach",
        });
      } catch {}
      console.log("[Onboarding] DevTools opened (staging)");
    }
  });

  state.onboardingWindow.on("closed", () => {
    state.onboardingWindow = null;
  });
}
