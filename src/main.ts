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
} from "electron";
import * as Sentry from "@sentry/electron/main";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { spawn, execSync } from "child_process";
import http from "node:http";

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
import type { MicDevice, MicPreferences, PttTarget } from "./types/shared";
import {
  buildMicrophoneSubmenu,
  buildCommonAppItems,
  buildFeedbackAndAboutItems,
  buildCopyTranscriptItem,
} from "./utils/menuBuilders";

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
import { logger } from "./utils/logger";

// Initialize Sentry as early as possible in the main process
// Vite injects env at build time; provide a typed fallback for the main process
const VITE_ENV: Record<string, string | undefined> = (
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ??
  {}
);

const sentryDsn = VITE_ENV.VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
const sentryEnv = VITE_ENV.VITE_SENTRY_ENVIRONMENT ?? (app.isPackaged ? "prod" : "dev");
const devFlag = VITE_ENV.DEV === "1" || VITE_ENV.DEV === "true" || !app.isPackaged;

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
              /(supabase|apikey|token|authorization)=([^\s&]+)/gi,
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

// Initialize auto-updates (packaged builds only)
try {
  if (app.isPackaged) {
    updateElectronApp({
      logger: console,
      updateSource: {
        type: UpdateSourceType.StaticStorage,
        // Fetch RELEASES.json from darwin/<arch>/
        baseUrl: `https://releases.sonicflow.app/darwin/${process.arch}`,
      },
      // You can temporarily set "1 minute" while testing updates
      updateInterval: "1 hour",
    });
  }
} catch (e) {
  console.warn("[auto-update] init skipped:", e);
}
let mainWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const fnHelpers = new Set<ChildProcess>();
const pasteHelpers = new Set<ChildProcess>();
let fnProc: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
let fnRestartTimeout: NodeJS.Timeout | null = null;
let preSpawnedPasteHelper: import("child_process").ChildProcessWithoutNullStreams | null =
  null;
// Track readiness of the pre-spawned paste helper (daemon)
let preSpawnReady: Promise<void> | null = null;
let resolvePreSpawnReady: (() => void) | null = null;
let fnPermissionDenied = false;
let fnStdoutBuffer = ""; // Buffer for incomplete lines from sonic-helper stdout
let pttTarget: PttTarget = "auto";
// Buffer deep links received before windows are ready
let pendingAuthUrls: string[] = [];
let devAuthServerUrl: string | null = null;
let devAuthServer: http.Server | null = null;
// Duplicate callback prevention - track processed auth URLs
const processedAuthUrls = new Set<string>();

// Helper function to send auth callback with duplicate prevention
function sendAuthCallback(url: string) {
  // Extract the significant parts for deduplication (ignore minor differences)
  const parsed = new URL(url);
  const dedupeKey = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}?${parsed.searchParams.toString()}`;

  if (processedAuthUrls.has(dedupeKey)) {
    console.log(
      `[Auth] Ignoring duplicate callback: ${url.substring(0, 50)}...`,
    );
    return false;
  }

  processedAuthUrls.add(dedupeKey);
  console.log(`[Auth] Processing new callback: ${url.substring(0, 50)}...`);

  const targetWindow = onboardingWindow || mainWindow;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("auth:callback", { url });
    if (!targetWindow.isVisible()) targetWindow.show();
    targetWindow.focus();
    return true;
  } else {
    pendingAuthUrls.push(url);
    return false;
  }
}

// Ensure single instance so deep links route to the running app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    try {
      const maybeUrl = argv.find(
        (a) =>
          typeof a === "string" &&
          (a.startsWith("sonicflow://") || a.startsWith("sonicflow-dev://")),
      );
      if (maybeUrl) {
        sendAuthCallback(maybeUrl);
      }
    } catch (e) {
      console.error("[Auth] second-instance handler error:", e);
    }
  });
}

// Dev helper: allow skipping onboarding/auth for faster iteration
const SKIP_ONBOARDING =
  process.env.SKIP_ONBOARDING === "1" ||
  process.env.SKIP_ONBOARDING === "true" ||
  process.env.SKIP_AUTH === "1" ||
  process.env.SKIP_AUTH === "true";

// Dev helper: force-show onboarding every launch (ignore local done flag)
const FORCE_ONBOARDING =
  process.env.FORCE_ONBOARDING === "1" ||
  process.env.FORCE_ONBOARDING === "true";

// Microphone management state
let micDevices: MicDevice[] = [
  { id: "default", label: "System Default" }, // Always available fallback
];
let micPreferences: MicPreferences = {};
let micPrefsPath: string; // Will be initialized in app.whenReady()
// Onboarding persistence (local flag)
let onboardingPrefsPath: string; // Will be initialized in app.whenReady()
let onboardingPrefs: { done?: boolean } = {};

// Last transcript storage for context menu copy functionality
let lastTranscript = "";

// Floating bar hide timer management
let hideTimer: NodeJS.Timeout | null = null;
let hideEndTime: number | null = null;
// Preference-level flag to reflect user's intent (Settings toggle)
let floatingBarEnabled = true;

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
    logBounds("centerWindowOnDisplay");
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
    logBounds("ensureEnvelopeForDisplay");
  }
  return { scale, width: targetW, height: targetH };
}

function emitActiveDisplayInfo(display: Electron.Display, scale: number): void {
  try {
    const payload = {
      id: display.id,
      bounds: display.bounds,
      size: display.size,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      scale,
      // Current window envelope for reference
      window: mainWindow?.getBounds() ?? null,
    };
    mainWindow?.webContents.send("active-display", payload);
  } catch (e) {
    logger.main.warn("emitActiveDisplayInfo failed", e);
  }
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
        const prevId = activeDisplayId;
        activeDisplayId = display.id;
        const result = ensureEnvelopeForDisplay(display);
        const scale = result?.scale ?? computeScaleForDisplay(display);
        emitActiveDisplayInfo(display, scale);
        console.log(
          `[FollowCursor] Display changed ${prevId ?? "none"} -> ${display.id} @ scaleFactor=${display.scaleFactor}, logicalWidth=${display.size.width}, scale=${scale}`,
        );
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
    console.log(
      `[DisplayChange] ${reason}: active=${display.id} width=${display.size.width} scale=${scale}`,
    );
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
    console.warn("[FnListener] Preflight IM check failed:", (e as Error)?.message);
  }
}

function getHelperPath(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "Sonic Flow Helper.app",
        "Contents",
        "MacOS",
        "Sonic Flow Helper",
      )
    : path.join(
        app.getAppPath(),
        "native",
        "bin",
        "Sonic Flow Helper.app",
        "Contents",
        "MacOS",
        "Sonic Flow Helper",
      );
}

function preSpawnPasteHelper() {
  // Clean up any existing pre-spawned helper
  if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
    try {
      preSpawnedPasteHelper.kill();
    } catch (e) {
      // ignore
    }
    preSpawnedPasteHelper = null;
    preSpawnReady = null;
    resolvePreSpawnReady = null;
  }

  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[PreSpawn] Paste helper binary not found at path: ${helperPath}`,
    );
    return;
  }

  console.log(`[PreSpawn] Starting paste helper daemon for dictation`);

  // Spawn the helper in daemon mode - it will wait for paste commands via stdin
  preSpawnedPasteHelper = spawn(helperPath, ["--mode=paste-daemon"], {
    stdio: "pipe",
    detached: false,
  });

  // Initialize readiness promise and resolve when daemon prints ready token
  preSpawnReady = new Promise<void>((resolve) => {
    resolvePreSpawnReady = resolve;
  });

  try {
    preSpawnedPasteHelper.stdout.setEncoding("utf8");
    const onData = (data: string | Buffer) => {
      const out = data.toString().trim();
      // Daemon emits this once ready to accept commands
      if (out.includes("paste-daemon-ready") && resolvePreSpawnReady) {
        resolvePreSpawnReady();
        resolvePreSpawnReady = null;
      }
    };
    preSpawnedPasteHelper.stdout.on("data", onData);
    // Ensure listener is cleaned up on exit
    preSpawnedPasteHelper.once("exit", () => {
      try {
        preSpawnedPasteHelper?.stdout?.off("data", onData as any);
      } catch {}
    });
  } catch {}

  pasteHelpers.add(preSpawnedPasteHelper);
  preSpawnedPasteHelper.once("exit", () => {
    if (preSpawnedPasteHelper) {
      pasteHelpers.delete(preSpawnedPasteHelper);
      preSpawnedPasteHelper = null;
      preSpawnReady = null;
      resolvePreSpawnReady = null;
    }
  });
}

function logBounds(tag: string) {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  const [cw, ch] = mainWindow.getContentSize();
  console.log(`[${tag}] bounds=%o content=%o`, b, { w: cw, h: ch });
}

// Microphone preference management functions
function loadMicPreferences(): MicPreferences {
  try {
    if (fs.existsSync(micPrefsPath)) {
      const data = fs.readFileSync(micPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      console.log("[MicPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    console.error("[MicPrefs] Failed to load preferences:", error);
  }

  const defaultPrefs = { selectedMicId: "default" };
  console.log("[MicPrefs] Using default preferences:", defaultPrefs);
  return defaultPrefs;
}

function saveMicPreferences(prefs: MicPreferences): void {
  try {
    // Ensure userData directory exists
    const userDataDir = app.getPath("userData");
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    fs.writeFileSync(micPrefsPath, JSON.stringify(prefs, null, 2));
    console.log("[MicPrefs] Saved preferences:", prefs);
  } catch (error) {
    console.error("[MicPrefs] Failed to save preferences:", error);
  }
}

function updateMicDevices(devices: MicDevice[]): void {
  console.log("[MicMgmt] Updating device list:", devices);

  // Always ensure "System Default" is first, then add other devices
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

  // Rebuild tray menu with new devices
  rebuildTrayMenu();

  // Notify renderers of selection change
  broadcastMicSelection();
}

function selectMicDevice(deviceId: string): void {
  console.log("[MicMgmt] Selecting device:", deviceId);

  // Validate device exists
  if (deviceId !== "default" && !micDevices.find((d) => d.id === deviceId)) {
    console.error("[MicMgmt] Device not found:", deviceId);
    return;
  }

  micPreferences.selectedMicId = deviceId;
  saveMicPreferences(micPreferences);

  // Rebuild tray menu to update checkmarks
  rebuildTrayMenu();

  // Notify renderers
  broadcastMicSelection();
}

function broadcastMicSelection(): void {
  const selectedId = micPreferences.selectedMicId || "default";
  console.log("[MicMgmt] Broadcasting selection:", selectedId);

  // Send to all renderer windows
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("mic:selected-changed", { id: selectedId });
  });
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
    hideEndTime = null;
    console.log("[Hide Timer] Timer cleared");
  }
}

function hideFloatingBarWithTimer(minutes: number | null): void {
  console.log(
    `[Hide Timer] Hiding floating bar for ${minutes ? minutes + " minutes" : "indefinitely"}`,
  );

  // Clear any existing timer
  clearHideTimer();

  // Hide the window
  if (mainWindow) {
    smoothHide(mainWindow);

    // Set up timer if duration is specified
    if (minutes !== null) {
      hideEndTime = Date.now() + minutes * 60 * 1000;
      hideTimer = setTimeout(
        () => {
          console.log("[Hide Timer] Timer expired, showing floating bar");
          if (mainWindow) {
            smoothShow(mainWindow);
            mainWindow?.webContents.send(
              "notify",
              "Floating bar shown automatically",
            );
          }
          clearHideTimer();
        },
        minutes * 60 * 1000,
      );

      mainWindow?.webContents.send(
        "notify",
        `Floating bar hidden for ${minutes} minutes. Use tray menu to show early.`,
      );
    } else {
      // Treat indefinite hide as preference OFF
      floatingBarEnabled = false;
      mainWindow?.webContents.send(
        "notify",
        "Floating bar hidden indefinitely. Use tray menu to show again.",
      );
    }
  }
}

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
              hideFloatingBarWithTimer(5);
            },
          },
          {
            label: "For 30 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 30 minutes");
              hideFloatingBarWithTimer(30);
            },
          },
          {
            label: "For 1 hour",
            click: () => {
              console.log("[Menu] Hide floating bar for 1 hour");
              hideFloatingBarWithTimer(60);
            },
          },
          { type: "separator" },
          {
            label: "Indefinitely",
            click: () => {
              console.log("[Menu] Hide floating bar indefinitely");
              hideFloatingBarWithTimer(null);
            },
          },
        ],
      },
    ];
  } else {
    // Window is hidden - show option to show it
    let label = "Show Floating Bar";

    // If there's an active timer, show remaining time
    if (hideTimer && hideEndTime) {
      const remainingMs = hideEndTime - Date.now();
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
          floatingBarEnabled = true;
        },
      },
    ];
  }
}

// FUCK IT - USE PNG FOR EVERYTHING! It works better at runtime
// Try multiple possible locations for the icon
const getIconPath = () => {
  const possiblePaths = [
    path.join(__dirname, "assets", "icon.png"), // Vite build location
    path.join(__dirname, "..", "assets", "icon.png"), // Alternative location
    path.join(process.resourcesPath, "icon.png"), // extraResource location
    path.join(__dirname, "..", "..", "public", "assets", "icon.png"), // Source location
  ];

  for (const iconPath of possiblePaths) {
    try {
      if (fs.existsSync(iconPath)) {
        console.log(`[Main Process] Found icon at: ${iconPath}`);
        return iconPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No icon found in any expected location");
  return possiblePaths[0]; // fallback
};

const getTrayIconPath = () => {
  const possiblePaths = [
    path.join(__dirname, "assets", "TrayTemplate.png"), // Vite build location (base 16x16)
    path.join(__dirname, "..", "assets", "TrayTemplate.png"), // Alternative location
    path.join(process.resourcesPath, "TrayTemplate.png"), // extraResource location
    path.join(__dirname, "..", "..", "public", "assets", "TrayTemplate.png"), // Source location
  ];

  for (const trayPath of possiblePaths) {
    try {
      if (fs.existsSync(trayPath)) {
        console.log(`[Main Process] Found tray icon at: ${trayPath}`);

        // Also check if @2x version exists in the same directory for high-DPI
        const trayDir = path.dirname(trayPath);
        const tray2xPath = path.join(trayDir, "TrayTemplate@2x.png");
        if (fs.existsSync(tray2xPath)) {
          console.log(
            `[Main Process] Found high-DPI tray icon at: ${tray2xPath}`,
          );
        }

        return trayPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.warn("[Main Process] No tray icon found in any expected location");
  return possiblePaths[0]; // fallback
};

// (Removed) Silent background check for app location

const iconPath = getIconPath();

const smoothShow = (win: BrowserWindow | null, fadeMs = 140) => {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(0);
    // Show immediately at 0 opacity to avoid any pre-paint flash
    win.show();
    // Small timeout to ensure first styled frame is committed
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.setOpacity(1);
    }, Math.max(50, Math.min(fadeMs, 300)));
  } catch (e) {
    try { win?.show(); } catch {}
  }
};

const smoothHide = (win: BrowserWindow | null, fadeMs = 140) => {
  if (!win || win.isDestroyed()) return;
  try {
    // Start fade-out by dropping opacity to 0, then hide.
    win.setOpacity(1);
    setTimeout(() => {
      try { win.setOpacity(0); } catch {}
      setTimeout(() => {
        try { win.hide(); } catch {}
      }, Math.max(50, Math.min(fadeMs, 300)));
    }, 0);
  } catch (e) {
    try { win?.hide(); } catch {}
  }
};

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
    mainWindow.setVisibleOnAllWorkspaces(true);
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
      logBounds("ready-to-show -> top-align");
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
      try {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      } catch {}
      console.log(
        "DevTools opened (dev opt-in). Tip: unset SF_DEVTOOLS to suppress overlays on transparent window.",
      );
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
  logBounds("createWindow");
  // Immediately size envelope for display scale and notify renderer
  const sized = ensureEnvelopeForDisplay(cursorDisplay);
  emitActiveDisplayInfo(
    cursorDisplay,
    sized?.scale ?? computeScaleForDisplay(cursorDisplay),
  );

  // Collapse request on blur: if user clicks outside our window, renderer can decide to collapse
  mainWindow.on("blur", () => {
    try {
      mainWindow?.webContents.send("collapse-request");
    } catch {
      // ignore
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      const wsOverride =
        VITE_ENV?.VITE_TRANSCRIBE_WS_URL || process.env.VITE_TRANSCRIBE_WS_URL;
      if (wsOverride && String(wsOverride).trim())
        url.searchParams.set("ws", String(wsOverride).trim());
      mainWindow.loadURL(url.toString());
    } catch {
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    }
  } else {
    const filePath = path.join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    );
    try {
      const u = pathToFileURL(filePath);
      const wsOverride =
        VITE_ENV?.VITE_TRANSCRIBE_WS_URL || process.env.VITE_TRANSCRIBE_WS_URL;
      if (wsOverride && String(wsOverride).trim())
        u.searchParams.set("ws", String(wsOverride).trim());
      mainWindow.loadURL(u.toString());
    } catch {
      mainWindow.loadFile(filePath);
    }
  }

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
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      // Align to current display's safe top before revealing (guard)
      const current = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(current);
      activeDisplayId = currentDisplay.id;
      const targetY = currentDisplay.workArea.y + ISLAND_VISIBLE_Y;
      mainWindow.setBounds(
        { x: current.x, y: targetY, width: current.width, height: current.height },
        false,
      );
      if (process.platform === "darwin") mainWindow.invalidateShadow();
    } catch (e) {
      console.warn("[renderer-ready] Top-align failed:", e);
    }
    try {
      smoothShow(mainWindow);
      logBounds("renderer-ready -> show");
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
    transparent: true, // crucial: no opaque backing store
    backgroundColor: "#00000000", // extra guard against fallback fill
    hasShadow: false,
    resizable: false,
    alwaysOnTop: false,
    focusable: true,
    skipTaskbar: false,
    show: false, // FIX 1: Don't show immediately - wait for content to load
    center: true,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: app.isPackaged ? true : false,
    },
    paintWhenInitiallyHidden: true,
  };

  // Add native macOS vibrancy for true glassmorphic effect
  if (process.platform === "darwin") {
    onboardingWindowOptions.vibrancy = "hud"; // 'sidebar' or 'fullscreen-ui' also work
    onboardingWindowOptions.visualEffectState = "active"; // window remains vibrant when focused
    onboardingWindowOptions.titleBarStyle = "hiddenInset"; // ① keep it frameless — we still get traffic-lights
    onboardingWindowOptions.trafficLightPosition = { x: 14, y: 14 }; // ③ nudge them if your design needs it (same numbers Raycast uses)
  } else {
    // Fallback for non-macOS platforms
    onboardingWindowOptions.backgroundColor = "#0f0f0f";
  }

  console.log(
    "[Debug] Creating BrowserWindow with options:",
    onboardingWindowOptions,
  );
  onboardingWindow = new BrowserWindow(onboardingWindowOptions);
  console.log("[Debug] BrowserWindow created, setting menu bar visibility");
  onboardingWindow.setMenuBarVisibility(false);

  const onboardingUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? (() => {
        try {
          const u = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
          const wsOverride =
            VITE_ENV?.VITE_TRANSCRIBE_WS_URL ||
            process.env.VITE_TRANSCRIBE_WS_URL;
          if (wsOverride && String(wsOverride).trim())
            u.searchParams.set("ws", String(wsOverride).trim());
          return `${u.toString()}#/onboarding`;
        } catch {
          return `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/onboarding`;
        }
      })()
    : (() => {
        try {
          const filePath = path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
          );
          const u = pathToFileURL(filePath);
          const wsOverride =
            VITE_ENV?.VITE_TRANSCRIBE_WS_URL ||
            process.env.VITE_TRANSCRIBE_WS_URL;
          if (wsOverride && String(wsOverride).trim())
            u.searchParams.set("ws", String(wsOverride).trim());
          return `${u.toString()}#/onboarding`;
        } catch {
          return `file://${path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
          )}#/onboarding`;
        }
      })();

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

  // FIX 4: Use did-finish-load to ensure all resources are ready
  onboardingWindow.webContents.once("did-finish-load", () => {
    console.log("[Onboarding] Content finished loading");

    // FIX 8: Force hardware acceleration settings for better vibrancy
    if (process.platform === "darwin") {
      onboardingWindow.webContents
        .executeJavaScript(
          `
        // Ensure proper rendering context
        document.documentElement.style.transform = 'translateZ(0)';
        console.log('[Vibrancy] Hardware acceleration enabled for rendering');
      `,
        )
        .catch((err) => {
          console.warn("[Vibrancy] Could not set hardware acceleration:", err);
        });
    }

    // FIX 5: Add small delay to ensure vibrancy effect is ready
    setTimeout(() => {
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        console.log("[Onboarding] Showing window after vibrancy delay");
        onboardingWindow.show();

        // FIX 6: Force invalidate shadow to clear any artifacts
        if (process.platform === "darwin") {
          onboardingWindow.invalidateShadow();
        }
      }
    }, 100); // Small delay to let vibrancy settle
  });

  // FIX 7: Backup using ready-to-show as fallback
  onboardingWindow.once("ready-to-show", () => {
    console.log("[Onboarding] Ready to show event fired");
    // Auto-open DevTools in packaged staging builds for onboarding UI (compile-time flag)
    if (VITE_ENV?.VITE_SF_DEVTOOLS === "1") {
      try {
        onboardingWindow.webContents.openDevTools({ mode: "detach" });
      } catch {}
      console.log("[Onboarding] DevTools opened (staging)");
    }
    // Only show if not already shown by did-finish-load
    setTimeout(() => {
      if (
        onboardingWindow &&
        !onboardingWindow.isDestroyed() &&
        !onboardingWindow.isVisible()
      ) {
        console.log("[Onboarding] Showing window via ready-to-show fallback");
        onboardingWindow.show();

        if (process.platform === "darwin") {
          onboardingWindow.invalidateShadow();
        }
      }
    }, 150);
  });

  onboardingWindow.on("closed", () => {
    onboardingWindow = null;
  });

  // Enhanced flush pending function with retry capability
  const flushPending = () => {
    try {
      if (
        pendingAuthUrls.length > 0 &&
        onboardingWindow &&
        !onboardingWindow.isDestroyed()
      ) {
        console.log(
          `[Auth] Flushing ${pendingAuthUrls.length} pending auth URLs`,
        );
        const urlsToProcess = [...pendingAuthUrls];
        pendingAuthUrls = [];

        for (const url of urlsToProcess) {
          if (onboardingWindow.webContents.isLoading()) {
            // Re-add to pending if still loading
            console.log(
              `[Auth] Window still loading, re-adding URL to pending`,
            );
            pendingAuthUrls.push(url);
          } else {
            sendAuthCallback(url);
          }
        }

        // Schedule retry if there are still pending URLs
        if (pendingAuthUrls.length > 0) {
          console.log(
            `[Auth] ${pendingAuthUrls.length} URLs still pending, scheduling retry in 1 second`,
          );
          setTimeout(flushPending, 1000); // Retry after 1 second
        }
      }
    } catch (e) {
      console.error("[Auth] Failed to flush pending auth URLs:", e);
    }
  };
  onboardingWindow.webContents.once("did-finish-load", () => {
    setTimeout(flushPending, 0);
  });
}

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  console.log(
    "[Tray Menu] Building tray menu with",
    micDevices.length,
    "devices",
  );
  const selectedMicId = micPreferences.selectedMicId || "default";

  const micSubmenu = buildMicrophoneSubmenu(micDevices, selectedMicId, (id) =>
    selectMicDevice(id),
  );

  return [
    ...buildCommonAppItems(() => {
      console.log("[Tray Menu] Open Settings clicked");
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send("expand-pill");
      }
    }),
    ...buildFloatingBarMenuItems(),
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    ...buildFeedbackAndAboutItems(),
    { type: "separator" },
    {
      label: "Quit Sonic Flow",
      click: () => {
        console.log("[Tray Menu] Quit Sonic Flow clicked");
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function buildPillContextMenu(): Electron.MenuItemConstructorOptions[] {
  console.log(
    "[Pill Menu] Building pill context menu with",
    micDevices.length,
    "devices",
  );
  const selectedMicId = micPreferences.selectedMicId || "default";

  const micSubmenu = buildMicrophoneSubmenu(micDevices, selectedMicId, (id) =>
    selectMicDevice(id),
  );

  return [
    ...buildCommonAppItems(() => {
      console.log("[Pill Menu] Open Settings clicked");
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
    buildCopyTranscriptItem(
      () => lastTranscript,
      () => {
        mainWindow?.webContents.send(
          "notify",
          "Transcript copied to clipboard",
        );
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

    tray.setToolTip("Sonic Flow");

    // Force tray to be visible (macOS sometimes hides it)
    if (process.platform === "darwin") {
      tray.setIgnoreDoubleClickEvents(false);
      // Try to force display the tray
      setTimeout(() => {
        if (tray && !tray.isDestroyed()) {
          console.log("[Tray] Forcing tray visibility on macOS");
          tray.setToolTip("Sonic Flow - AI Dictation");
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
          `[PasteHelper] Sonic Flow Helper binary not found at path: ${helperPath}`,
        );
        mainWindow?.webContents.send(
          "notify",
          "Paste unavailable: binary missing. Copied to clipboard.",
        );
        return { success: false, error: "Paste helper binary not found." };
      }

      // Use pre-spawned helper if available, otherwise fallback to direct spawn
      if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
        console.log(`[PasteHelper] Using pre-spawned paste helper`);
        // Ensure the daemon is ready before sending commands (short timeout)
        try {
          if (preSpawnReady) {
            await Promise.race([
              preSpawnReady,
              new Promise<void>((resolve) => setTimeout(resolve, 300)),
            ]);
          }
        } catch {}
        // Send paste command to daemon
        preSpawnedPasteHelper.stdin?.write("paste\n");
        
        // Wait for paste completion
        await new Promise<void>((resolve) => {
          const onData = (data: Buffer) => {
            const output = data.toString().trim();
            if (output === "paste-done") {
              preSpawnedPasteHelper?.stdout?.off("data", onData);
              console.log(`[PasteHelper] Pre-spawned helper completed paste`);
              resolve();
            }
          };
          preSpawnedPasteHelper?.stdout?.on("data", onData);
          
          // Fallback timeout
          setTimeout(() => {
            preSpawnedPasteHelper?.stdout?.off("data", onData);
            console.log(`[PasteHelper] Pre-spawned helper timeout, assuming success`);
            resolve();
          }, 1000);
        });
      } else {
        // Fallback: spawn new helper if pre-spawn failed
        console.log(`[PasteHelper] Pre-spawn not available, using direct spawn from: ${helperPath}`);
        const proc = spawnHelper(helperPath, ["--mode=paste"], false);
        
        await new Promise<void>((resolve) => {
          let stderrBuffer = "";
          proc.stderr.on("data", (data) => {
            stderrBuffer += data.toString();
          });
          proc.on("close", (code) => {
            if (stderrBuffer)
              console.error(`[PasteHelper stderr]: ${stderrBuffer.trim()}`);
            console.log(`[PasteHelper] fallback paste helper exited with code ${code}`);
            resolve();
          });
          proc.on("error", (error) => {
            console.error("[PasteHelper] Error executing fallback paste-helper:", error);
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

// Preference checking for first run
// Removed onboarding persistence - always show onboarding

app.whenReady().then(async () => {
  try {
    // Register custom protocol for OAuth/magic link callbacks
    const isDev = !app.isPackaged;
    if (isDev) {
      // Always register with explicit exe and app path in dev
      const exe = process.execPath;
      const appPath = path.resolve(process.argv[1] || "");
      const ok = app.setAsDefaultProtocolClient("sonicflow-dev", exe, [
        appPath,
      ]);
      console.log(
        `[Auth] Registered dev protocol handler (sonicflow-dev): ${ok}`,
      );
      console.log(
        `[Auth] isDefaultProtocolClient(dev):`,
        app.isDefaultProtocolClient("sonicflow-dev"),
      );
    } else {
      const ok = app.setAsDefaultProtocolClient("sonicflow");
      console.log(`[Auth] Registered prod protocol handler (sonicflow): ${ok}`);
      console.log(
        `[Auth] isDefaultProtocolClient(prod):`,
        app.isDefaultProtocolClient("sonicflow"),
      );
    }
  } catch (e) {
    console.error("[Auth] Failed to register protocol client:", e);
  }

  // In dev, start a tiny local HTTP server to receive auth callbacks as a fallback
  try {
    const isDev = !app.isPackaged;
    if (isDev) {
      const host = "127.0.0.1";
      const port = 43112;
      const server = http.createServer((req, res) => {
        const url = `http://${host}:${port}${req.url || ""}`;
        try {
          sendAuthCallback(url);
        } catch (err) {
          console.error("[Auth] dev server callback error:", err);
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<html><body><p>Authentication complete. You can close this window.</p></body></html>",
        );
      });
      server.listen(port, host, () => {
        devAuthServerUrl = `http://${host}:${port}/auth/callback`;
        devAuthServer = server;
        console.log("[Auth] Dev auth server listening:", devAuthServerUrl);
      });
    }
  } catch (e) {
    console.error("[Auth] Failed to start dev auth server:", e);
  }

  // Handle protocol URL passed at first launch (Windows/Linux)
  try {
    const firstUrl = process.argv.find(
      (a) =>
        typeof a === "string" &&
        (a.startsWith("sonicflow://") || a.startsWith("sonicflow-dev://")),
    );
    if (firstUrl) {
      sendAuthCallback(firstUrl);
    }
  } catch (e) {
    console.error("[Auth] initial argv scan error:", e);
  }

  // Initialize paths after app is ready to avoid keychain dialog
  micPrefsPath = path.join(app.getPath("userData"), "mic-preferences.json");
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

  const isDev = !app.isPackaged;
  // Log the WebSocket endpoint the app intends to use (terminal)
  try {
    const envWs =
      (import.meta as any)?.env?.VITE_TRANSCRIBE_WS_URL ||
      process.env.VITE_TRANSCRIBE_WS_URL;
    const wsUrlToLog =
      envWs ||
      (isDev ? "ws://127.0.0.1:8787/ws" : "wss://api.sonicflow.app/ws");
    console.log("[Main] WS endpoint", wsUrlToLog);
    console.log("[Main] Flags", {
      VITE_SF_DEVTOOLS: VITE_ENV?.VITE_SF_DEVTOOLS,
      VITE_ALLOW_DEV_WS: VITE_ENV?.VITE_ALLOW_DEV_WS,
      VITE_SENTRY_ENVIRONMENT: VITE_ENV?.VITE_SENTRY_ENVIRONMENT,
    });
  } catch {}
  console.log(
    "[Main Process] Setting up onHeadersReceived listener for COOP/COEP...",
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Loosen CSP for auth flows; explicitly allow Supabase and websockets
    const styleSrc = "style-src 'self' 'unsafe-inline'";
    const fontSrc = "font-src 'self' data:";
    const allowLocal = isDev || VITE_ENV?.VITE_ALLOW_DEV_WS === "1";
    const connect = [
      "connect-src 'self'",
      "https://api.sonicflow.app",
      "wss://api.sonicflow.app",
      // Local development HTTP/WS (dev or staging with flag)
      ...(allowLocal
        ? [
            "http://127.0.0.1:8787",
            "http://localhost:8787",
            "ws://127.0.0.1:8787",
            "ws://localhost:8787",
            // Vite dev server (HMR)
            "http://localhost:*",
            "ws://localhost:*",
          ]
        : []),
      "https://huggingface.co",
      "https://cdn.jsdelivr.net",
      "https://*.supabase.co",
      "https://*.supabase.in",
      // Sentry endpoints for error reporting
      "https://*.sentry.io",
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      "wss://*.supabase.co",
      "wss://*.supabase.in",
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
  console.log("[Main Process] onHeadersReceived listener configured.");

  app.commandLine.appendSwitch("disable-http-cache");

  // macOS dock icon setup
  try {
    // Try to set the dock icon explicitly (fallback if app bundle icon fails)
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
      console.log("[Main Process] Dock icon set successfully");
    }
  } catch (error) {
    console.warn("[Main Process] Failed to set dock icon:", error.message);
  }

  // Startup flow:
  // - FORCE_ONBOARDING => always show onboarding (ignore local flag)
  // - Otherwise, skip onboarding when SKIP_ONBOARDING or local done flag
  if (!FORCE_ONBOARDING && (SKIP_ONBOARDING || onboardingPrefs?.done === true)) {
    console.log("[Startup] SKIP_ONBOARDING enabled — launching main window");
    try {
      createWindow();
      createTray();
      // Start continuous follow, and start helper only if IM already granted
      startFollowCursor();
      pttTarget = "main";
      startHelperIfIMGranted();
      console.log("[Debug] Main window launched (onboarding skipped)");
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

  // Initialize microphone preferences
  console.log("[Main Process] Initializing microphone preferences...");
  micPreferences = loadMicPreferences();
  console.log("[Main Process] Microphone preferences loaded:", micPreferences);

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
        logBounds("prepare-pill -> hide");
      }
      return { success: true };
    } catch (error) {
      console.error("[IPC] Failed to prepare pill:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Generic external URL opener for OAuth and links
  ipcMain.handle("open-external", async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err: any) {
      console.error("[IPC] open-external failed:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Provide renderer with correct redirect URL (one per env)
  ipcMain.handle("auth:get-redirect-url", async () => {
    const isDev = !app.isPackaged;
    if (isDev) {
      // Wait for HTTP server to be ready - no fallback to custom scheme
      if (devAuthServerUrl) {
        return { url: devAuthServerUrl };
      }

      // Wait for server to be ready with timeout
      const timeout = 10000; // 10 seconds timeout
      const startTime = Date.now();

      while (!devAuthServerUrl && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Check every 100ms
      }

      if (devAuthServerUrl) {
        return { url: devAuthServerUrl };
      } else {
        console.error("[Auth] HTTP server failed to start within timeout");
        return { error: "Development auth server failed to start" };
      }
    }
    // In production, use the API site to complete OAuth, then deep-link to the app
    // This improves UX when the provider opens an external browser
    return { url: "https://auth.sonicflow.app/auth/callback" };
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
      onboardingPrefs = { ...onboardingPrefs, done: true };
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

    // Renderer will show any post-sign-in notification; keep main focused on window.
  });

  // (Removed) auth:set-signed-in — rely on Supabase session as source of truth

  ipcMain.handle("auth:show-onboarding", () => {
    try {
      onboardingPrefs = { ...onboardingPrefs };
      fs.writeFileSync(
        onboardingPrefsPath,
        JSON.stringify(onboardingPrefs, null, 2),
        "utf8",
      );
    } catch {}
    // Hide pill/main, show onboarding
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
        smoothHide(mainWindow);
    } catch {}
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      smoothShow(onboardingWindow);
    } else {
      createOnboardingWindow();
    }
    pttTarget = "onboarding";
    return { ok: true };
  });

  // Allow other windows (onboarding) to request the pill to expand without directly moving the window
  ipcMain.handle("pill:expand", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("expand-pill");
      return { ok: true };
    }
    return { ok: false };
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
  screen.on("display-added", () => syncToCurrentDisplay("display-added"));
  screen.on("display-removed", () => syncToCurrentDisplay("display-removed"));
  screen.on("display-metrics-changed", () =>
    syncToCurrentDisplay("display-metrics-changed"),
  );

  // Handle pill expansion requests
  ipcMain.on("expand-pill", () => {
    console.log("[IPC Main] Received expand-pill event");
    if (mainWindow) {
      mainWindow.webContents.send("expand-pill");
    }
  });

  // Mirror pill state from onboarding to pill window during tests
  ipcMain.on("pill:mirror-start", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("pill-mirror-start");
    } catch {}
  });
  ipcMain.on("pill:mirror-stop", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("pill-mirror-stop");
    } catch {}
  });
  ipcMain.on("pill:mirror-complete", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("pill-mirror-complete");
    } catch {}
  });
  ipcMain.on("pill:mirror-cancel", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("pill-mirror-cancel");
    } catch {}
  });

  ipcMain.on(
    "show-notification",
    (event: Electron.IpcMainEvent, message: string) => {
      console.log(
        `[IPC Main] Received show-notification request, forwarding to renderer: ${message}`,
      );
      mainWindow?.webContents.send("notify", message);
    },
  );

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
    return { enabled: floatingBarEnabled };
  });

  // Hide indefinitely without emitting an additional notification (renderer handles UX)
  ipcMain.handle("floating-bar:hide-indefinitely", () => {
    try {
      clearHideTimer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        smoothHide(mainWindow);
      }
      floatingBarEnabled = false;
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
      floatingBarEnabled = true;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
    const selectedId = micPreferences.selectedMicId || "default";
    return { id: selectedId };
  });

  // Handle last transcript updates from renderer
  ipcMain.on("transcript:update", (_event, text: string) => {
    console.log(
      "[IPC] Received transcript update:",
      text.slice(0, 50) + (text.length > 50 ? "..." : ""),
    );
    lastTranscript = text;
  });

  // Onboarding IPC handlers
  ipcMain.handle("check-permissions", async () => {
    try {
      const isDev = !app.isPackaged;
      const needAX = !systemPreferences.isTrustedAccessibilityClient(false);

      // Always use the helper binary for consistent permission checking in both dev and prod
      const helperPath = getHelperPath();

      // Check if the helper exists
      if (!fs.existsSync(helperPath)) {
        console.error(
          "Sonic Flow Helper binary not found at path:",
          helperPath,
        );
        return { needAX, needIM: true, isDev };
      }

      // Run the helper with --check-permissions flag
      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--check-permissions"]);

        let output = "";
        helper.stdout.on("data", (data) => {
          output += data.toString();
        });

        helper.on("close", () => {
          // Parse the output to determine if permissions are granted
          const hasAXPermission = output.includes("ax-granted");
          const hasIMPermission = output.includes("im-granted");
          resolve({
            needAX: !hasAXPermission,
            needIM: !hasIMPermission,
            isDev,
          });
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          helper.kill();
          resolve({ needAX, needIM: true, isDev }); // Assume IM needed on timeout
        }, 5000);
      });
    } catch (error) {
      console.error("Error checking permissions:", error);
      // If we can't determine permissions, assume both are needed
      return { needAX: true, needIM: true, isDev: !app.isPackaged };
    }
  });

  ipcMain.handle("request-accessibility-permission", () => {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
      return { success: true };
    } catch (error) {
      console.error("Error requesting accessibility permission:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("request-microphone-permission", async () => {
    try {
      console.log("[IPC] Requesting microphone permission...");
      const granted = await systemPreferences.askForMediaAccess("microphone");
      console.log("[IPC] Microphone permission result:", granted);
      return { success: true, granted };
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-microphone-permission", () => {
    try {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      console.log("[IPC] Microphone permission status:", status);
      return { status, granted: status === "granted" };
    } catch (error) {
      console.error("Error checking microphone permission:", error);
      return { status: "unknown", granted: false };
    }
  });

  ipcMain.handle("open-system-preferences", async (event, pane: string) => {
    try {
      const { shell } = await import("electron");
      let url = "";

      switch (pane) {
        case "microphone":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
          break;
        case "accessibility":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
          break;
        case "input-monitoring":
          url =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
          break;
        default:
          url = "x-apple.systempreferences:com.apple.preference.security";
      }

      await shell.openExternal(url);
      console.log(`[IPC] Opened System Preferences: ${pane}`);
    } catch (error) {
      console.error("Error opening System Preferences:", error);
    }
  });

  ipcMain.handle("request-input-monitoring-permission", async () => {
    try {
      const isDev = !app.isPackaged;
      console.log(
        `[${isDev ? "Dev" : "Prod"} Mode] Requesting input monitoring permission...`,
      );

      const helperPath = getHelperPath();

      // First check if the helper exists
      if (!fs.existsSync(helperPath)) {
        console.error("Helper binary not found at:", helperPath);
        // Still open System Preferences even if helper is missing
        shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
        );
        return { success: false, error: "Helper binary not found", isDev };
      }

      // Use our new registration functionality
      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--register-input-monitoring"], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: false,
        });

        let stdout = "";
        let stderr = "";

        helper.stdout.on("data", (data) => {
          stdout += data.toString();
          console.log("[Helper Output]:", data.toString());
        });

        helper.stderr.on("data", (data) => {
          stderr += data.toString();
          console.log("[Helper Error]:", data.toString());
        });

        helper.on("close", (code) => {
          console.log(`[Helper] Registration process exited with code ${code}`);

          if (stdout.includes("registered-granted")) {
            console.log("[Helper] Input Monitoring permission already granted");
            resolve({ success: true, isDev, alreadyGranted: true });
          } else if (stdout.includes("registered-denied")) {
            console.log(
              "[Helper] Input Monitoring permission not granted - user needs to enable in Settings",
            );
            // Open System Preferences to Input Monitoring AFTER registration
            console.log(
              "[Helper] Opening System Preferences to Input Monitoring...",
            );
            shell.openExternal(
              "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            );
            console.log("[Helper] System Preferences opened");
            resolve({ success: true, isDev, alreadyGranted: false });
          } else {
            console.error(
              "[Helper] Unexpected output from registration process",
            );
            resolve({
              success: false,
              error: "Unexpected helper output",
              isDev,
            });
          }
        });

        helper.on("error", (error) => {
          console.error("[Helper] Error running registration process:", error);
          resolve({ success: false, error: error.message, isDev });
        });
      });
    } catch (error) {
      console.error("Error requesting input monitoring permission:", error);
      return { success: false, error: error.message, isDev: !app.isPackaged };
    }
  });

  // NEW: Add handler for the proper Input Monitoring request
  ipcMain.handle("ask-im", async () => {
    try {
      const isDev = !app.isPackaged;
      console.log(
        `[${isDev ? "Dev" : "Prod"} Mode] Asking for Input Monitoring permission...`,
      );

      const helperPath = getHelperPath();

      if (!fs.existsSync(helperPath)) {
        console.error("Helper binary not found at:", helperPath);
        return { success: false, error: "Helper binary not found", isDev };
      }

      return new Promise((resolve) => {
        const helper = spawn(helperPath, ["--ask-im"], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: false,
        });

        let stdout = "";
        let stderr = "";

        helper.stdout.on("data", (data) => {
          stdout += data.toString();
          console.log("[Ask-IM Output]:", data.toString());
        });

        helper.stderr.on("data", (data) => {
          stderr += data.toString();
          console.log("[Ask-IM Error]:", data.toString());
        });

        helper.on("close", async (code) => {
          console.log(`[Ask-IM] Process exited with code ${code}`);

          if (stdout.includes("im-granted")) {
            console.log("[Ask-IM] Input Monitoring permission granted");
            try {
              await startHelperIfIMGranted();
            } catch {}
            resolve({ success: true, status: "authorized", isDev });
          } else if (stdout.includes("im-denied")) {
            console.log("[Ask-IM] Input Monitoring permission denied");
            resolve({ success: true, status: "denied", isDev });
          } else {
            console.error("[Ask-IM] Unexpected output from helper");
            resolve({
              success: false,
              error: "Unexpected helper output",
              isDev,
            });
          }
        });

        helper.on("error", (error) => {
          console.error("[Ask-IM] Error running helper:", error);
          resolve({ success: false, error: error.message, isDev });
        });
      });
    } catch (error) {
      console.error("Error asking for Input Monitoring permission:", error);
      return { success: false, error: error.message, isDev: !app.isPackaged };
    }
  });

  ipcMain.handle("reload-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("get-app-path", () => {
    return app.getAppPath();
  });

  // Respond to permission grants without full app restart
  ipcMain.handle(
    "permissions:post-grant",
    async (_event, type: "accessibility" | "microphone") => {
      try {
        if (type === "accessibility") {
          // If paste daemon exists, respawn to pick up AX trust
          try {
            if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
              preSpawnedPasteHelper.stdin?.write("exit\n");
            }
          } catch {}
          preSpawnedPasteHelper = null;
          preSpawnReady = null;
          resolvePreSpawnReady = null;
          // Eagerly pre-spawn again so paste is ready post-grant
          preSpawnPasteHelper();
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
});

// Ensure local dev auth server is closed on quit to avoid EADDRINUSE on restart
app.on("before-quit", () => {
  try {
    devAuthServer?.close();
  } catch {}
});

// Handle deep links like sonicflow://auth/callback?code=...
app.on("open-url", (event, url) => {
  event.preventDefault();
  console.log(`[Auth] Deep link received: ${url}`);
  console.log(`[Auth] App packaged: ${app.isPackaged}`);
  console.log(`[Auth] Onboarding window exists: ${!!onboardingWindow}`);
  console.log(`[Auth] Main window exists: ${!!mainWindow}`);

  try {
    const targetWindow = onboardingWindow || mainWindow;
    if (targetWindow && !targetWindow.isDestroyed()) {
      console.log(
        `[Auth] Target window ready: ${!targetWindow.webContents.isLoading()}`,
      );
      console.log(`[Auth] Window visible: ${targetWindow.isVisible()}`);

      // Check if window content is loaded before sending auth callback
      if (targetWindow.webContents.isLoading()) {
        console.log(
          `[Auth] Window still loading, waiting for did-finish-load event`,
        );
        // Wait for content to finish loading
        targetWindow.webContents.once("did-finish-load", () => {
          console.log(`[Auth] Window finished loading, sending auth callback`);
          sendAuthCallback(url);
        });
      } else {
        console.log(`[Auth] Window ready, sending auth callback immediately`);
        sendAuthCallback(url);
      }

      // Ensure window is visible and focused for auth flow
      if (!targetWindow.isVisible()) {
        console.log(`[Auth] Showing hidden window`);
        targetWindow.show();
      }
      targetWindow.focus();
    } else {
      console.log(
        `[Auth] No ready window, adding to pending (${pendingAuthUrls.length + 1} total)`,
      );
      pendingAuthUrls.push(url);
    }
  } catch (err) {
    console.error("[Auth] Deep link handler error:", err);
    // Fallback: add to pending URLs if direct send fails
    console.log(`[Auth] Adding to pending URLs as fallback`);
    pendingAuthUrls.push(url);
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep app running in dock even when all windows are closed
});

app.on("activate", () => {
  console.log("[App Event] activate: Dock icon clicked or app activated");

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
      if (!FORCE_ONBOARDING && (SKIP_ONBOARDING || onboardingPrefs?.done === true))
        createWindow();
      else createOnboardingWindow();
    }
    // If windows exist but are all destroyed/invalid, recreate main window
    else if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("[App Event] activate: Main window is destroyed, recreating");
      if (!FORCE_ONBOARDING && (SKIP_ONBOARDING || onboardingPrefs?.done === true))
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

  // Clean up pre-spawned paste helper
  if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
    try {
      preSpawnedPasteHelper.stdin?.write("exit\n");
      if (preSpawnedPasteHelper.pid) process.kill(preSpawnedPasteHelper.pid, "SIGKILL");
    } catch (e) {
      // ignore
    }
    preSpawnedPasteHelper = null;
  }

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
    execSync("pkill -9 -f 'Sonic Flow Helper' || true");
  } catch (e) {
    // ignore
  }
  try {
    execSync("pkill -9 -f sonic-helper    || true");
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

  // Clear restart timeout and kill sonic-helper process
  if (fnRestartTimeout) {
    clearTimeout(fnRestartTimeout);
    fnRestartTimeout = null;
  }
  
  // Clean up pre-spawned paste helper
  if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
    try {
      preSpawnedPasteHelper.stdin?.write("exit\n");
      preSpawnedPasteHelper.kill("SIGKILL");
    } catch (e) {
      // ignore
    }
    preSpawnedPasteHelper = null;
  }
  
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
      "[FnListener] Cleaning up existing sonic-helper process before starting new one",
    );
    try {
      fnProc.kill("SIGTERM");
    } catch (error) {
      console.warn(
        "[FnListener] Error killing existing sonic-helper process:",
        error,
      );
    }
    fnProc = null;
  }

  const helperPath = getHelperPath();

  // Check if the helper binary exists before attempting to spawn
  if (!fs.existsSync(helperPath)) {
    console.error(
      `[FnListener] Sonic Flow Helper binary not found at path: ${helperPath}`,
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
      `[FnListener] Starting Sonic Flow Helper helper from: ${helperPath}`,
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
        if (trimmedLine === "ready") {
          // Signal to both windows that PTT is ready
          onboardingWindow?.webContents.send("ptt-ready");
          mainWindow?.webContents.send("ptt-ready");
        // Ignore legacy generic and Fn events; only handle Right Option/Command
        } else if (trimmedLine === "optR-down") {
          // Right Option: primary PTT hotkey (press-and-hold)
          preSpawnPasteHelper();
          targetWindow?.webContents.send("ptt-down");
        } else if (trimmedLine === "optR-up") {
          // End of PTT press-and-hold
          try {
            if (preSpawnedPasteHelper && !preSpawnedPasteHelper.killed) {
              preSpawnedPasteHelper.stdin?.write("exit\n");
            }
          } catch {}
          preSpawnedPasteHelper = null;
          preSpawnReady = null;
          resolvePreSpawnReady = null;
          targetWindow?.webContents.send("ptt-up");
        } else if (trimmedLine === "cmdR-down") {
          // Right Command: visual press state only
          targetWindow?.webContents.send("ptt-cancel-down");
        } else if (trimmedLine === "cmdR-up") {
          // Right Command: trigger cancel on release
          targetWindow?.webContents.send("ptt-cancel");
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
      console.error(
        `[FnListener] Sonic Flow Helper stderr: ${chunk.toString()}`,
      );
    });

    fnProc.on("error", (error: Error) => {
      console.error(
        "[FnListener] Failed to start Sonic Flow Helper helper process:",
        error,
      );
      fnProc = null;

      const targetWindow =
        pttTarget === "main"
          ? mainWindow || onboardingWindow
          : onboardingWindow || mainWindow;
      if (error.message.includes("ENOENT")) {
        console.error(
          "[FnListener] Sonic Flow Helper binary not found or not executable",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: binary not found",
        );
      } else if (error.message.includes("EACCES")) {
        console.error(
          "[FnListener] Sonic Flow Helper binary lacks execution permissions",
        );
        targetWindow?.webContents.send(
          "notify",
          "Hotkey detection unavailable: permission denied",
        );
      } else {
        console.error(
          "[FnListener] Unknown error starting Sonic Flow Helper:",
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
        `[FnListener] Sonic Flow Helper helper process closed with code ${code}, signal ${signal}`,
      );
      fnProc = null;

      // Schedule restart only if not already scheduled and not quitting
      scheduleRestart("close");
    });

    fnProc.on("exit", (code, signal) => {
      console.log(
        `[FnListener] Sonic Flow Helper helper process exited with code ${code}, signal ${signal}`,
      );
    });
  } catch (error) {
    console.error(
      "[FnListener] Exception when spawning Sonic Flow Helper helper:",
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
