/**
 * Tray & Menus
 *
 * Builds the macOS menu-bar tray icon plus the tray context menu and the
 * pill's right-click context menu. Both menus share the same building
 * blocks (microphone submenu, common app items, paste-last-transcript item,
 * floating-bar visibility controls, feedback/about items).
 */

import {
  app,
  Menu,
  nativeImage,
  systemPreferences,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
} from "electron";

import {
  buildMicrophoneSubmenu,
  buildCommonAppItems,
  buildFeedbackAndAboutItems,
  buildPasteTranscriptItem,
} from "../utils/menuBuilders";
import { bootTimeline } from "./bootTimeline";
import { getTrayIconPath } from "./iconPaths";
import {
  getMicDevices,
  getSelectedMicId,
  selectMicDevice,
} from "./micManager";
import {
  clearHideTimer,
  hideFloatingBarWithTimer,
  isHideTimerActive,
  getHideEndTime,
  setFloatingBarEnabled,
} from "./floatingBar";
import { smoothShow } from "./windowAnimation";
import {
  getUpdateStatus,
  getUpdateSnapshot,
  isUpdateReadyToInstall,
  manualCheckForUpdates,
  quitAndInstallUpdate,
  downloadUpdate,
  type UpdateSnapshot,
} from "./updateController";
import { pasteLastTranscript } from "./pasteOrchestrator";
import { state } from "./windowState";
import {
  alphaFromBGRA,
  ICON_PX,
  maskToBGRA,
  type AlphaMask,
} from "./trayIconFrames";
import {
  createTrayIndicator,
  deriveVisual,
  type IndicatorVisual,
  type TrayIndicator,
} from "./trayIndicator";

// ── Internal state ─────────────────────────────────────────────────────

let tray: Tray | null = null;
let trayBaseIcon: NativeImage | null = null;
let indicator: TrayIndicator | null = null;
let installHandoff = false;
let demoRunning = false;
let demoTimers: ReturnType<typeof setTimeout>[] = [];

// ── Floating bar submenu ───────────────────────────────────────────────

function buildFloatingBarMenuItems(): MenuItemConstructorOptions[] {
  if (!state.mainWindow) {
    return [];
  }

  const isVisible = state.mainWindow.isVisible();

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
              hideFloatingBarWithTimer(state.mainWindow, 5);
            },
          },
          {
            label: "For 30 minutes",
            click: () => {
              console.log("[Menu] Hide floating bar for 30 minutes");
              hideFloatingBarWithTimer(state.mainWindow, 30);
            },
          },
          {
            label: "For 1 hour",
            click: () => {
              console.log("[Menu] Hide floating bar for 1 hour");
              hideFloatingBarWithTimer(state.mainWindow, 60);
            },
          },
          { type: "separator" },
          {
            label: "Indefinitely",
            click: () => {
              console.log("[Menu] Hide floating bar indefinitely");
              hideFloatingBarWithTimer(state.mainWindow, null);
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
          if (state.mainWindow) {
            smoothShow(state.mainWindow);
            console.log("[Menu] Floating bar shown");
          }
          setFloatingBarEnabled(true);
        },
      },
    ];
  }
}

// ── Menu builders ───────────────────────────────────────────────────────

function buildTrayMenu(): MenuItemConstructorOptions[] {
  const selectedMicId = getSelectedMicId();

  const micSubmenu = buildMicrophoneSubmenu(
    getMicDevices(),
    selectedMicId,
    (id) => selectMicDevice(id),
  );

  function restartToInstallUpdate() {
    quitAndInstallUpdate();
  }
  async function downloadAvailableUpdate() {
    // Updates download on their own, so this is mostly a retry after a failed
    // download. Download completion only enables the separate restart action.
    downloadUpdate();

    if (
      getUpdateStatus() !== "downloading" &&
      getUpdateStatus() !== "checking"
    ) {
      // Nothing cached to resume. The check starts the download itself;
      // downloadUpdate() then marks it as user-driven.
      await manualCheckForUpdates(true);
      downloadUpdate();
    }
  }

  const updateStatus = getUpdateStatus();
  const downloadPercent = getUpdateSnapshot().downloadPercent;
  const downloadingLabel =
    downloadPercent != null
      ? `Downloading Update (${downloadPercent}%)`
      : "Downloading Update";

  const updateItems: MenuItemConstructorOptions[] = isUpdateReadyToInstall()
    ? [
        {
          label: "Restart to Update",
          click: () => restartToInstallUpdate(),
        },
      ]
    : updateStatus === "available"
      ? [
          {
            label: "Download Update",
            click: () => {
              downloadAvailableUpdate().catch((err) => {
                console.error("[TrayMenu] Error starting update download:", err);
              });
            },
          },
        ]
      : [
          {
            label:
              updateStatus === "checking"
                ? "Checking for Updates"
                : updateStatus === "downloading"
                  ? downloadingLabel
                  : "Check for Updates",
            enabled:
              updateStatus !== "checking" && updateStatus !== "downloading",
            click: () => {
              manualCheckForUpdates();
            },
          },
        ];

  return [
    ...buildCommonAppItems(() => {
      console.log("[Tray Menu] Settings clicked");
      if (state.mainWindow) {
        state.mainWindow.show();
        state.mainWindow.webContents.send("expand-pill");
      }
    }),
    // Update controls
    ...updateItems,
    { type: "separator" },
    buildPasteTranscriptItem(
      () => state.lastTranscript,
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
        state.isQuitting = true;
        app.quit();
      },
    },
  ];
}

export function buildPillContextMenu(): MenuItemConstructorOptions[] {
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
      if (state.mainWindow) {
        state.mainWindow.show();
        state.mainWindow.webContents.send("expand-pill");
      }
    }),
    {
      label: "Select Microphone",
      submenu: micSubmenu,
    },
    { type: "separator" },
    buildPasteTranscriptItem(
      () => state.lastTranscript,
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

// ── Tray lifecycle ─────────────────────────────────────────────────────

export function rebuildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
}

// ── Update indicator ───────────────────────────────────────────────────

export function updateIndicatorTooltip(snapshot: UpdateSnapshot): string {
  if (snapshot.readyToInstall) {
    return snapshot.version
      ? `Spoke ${snapshot.version} is ready. Restart to update.`
      : "Spoke update is ready. Restart to update.";
  }
  if (snapshot.status === "downloading") {
    return snapshot.downloadPercent != null
      ? `Spoke: downloading update, ${snapshot.downloadPercent}%`
      : "Spoke: downloading update";
  }
  if (snapshot.status === "error") return "Spoke: update failed";
  return "Spoke";
}

// Tooltip half of the menu-bar indicator. The update controller calls this on
// phase changes and coarse download progress, alongside menu rebuilds.
export function applyUpdateIndicator(snapshot: UpdateSnapshot): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(updateIndicatorTooltip(snapshot));
}

// Icon half of the indicator. Fed on every published update change so the
// download bar moves smoothly; the indicator only swaps images.
export function applyUpdateIcon(snapshot: UpdateSnapshot): void {
  if (demoRunning) return;
  indicator?.show(deriveVisual(snapshot, installHandoff));
}

export function setUpdateInstalling(installing: boolean): void {
  installHandoff = installing;
  applyUpdateIcon(getUpdateSnapshot());
}

export function disposeTrayIndicator(): void {
  stopTrayDemo();
  indicator?.dispose();
  indicator = null;
}

function loadLogoAlpha(): AlphaMask | null {
  const onePx = getTrayIconPath();
  for (const file of [onePx.replace(/\.png$/, "@2x.png"), onePx]) {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) continue;
    for (const scaleFactor of [2, 1]) {
      const bitmap = img.toBitmap({ scaleFactor });
      if (bitmap.length === ICON_PX * ICON_PX * 4) return alphaFromBGRA(bitmap);
    }
  }
  console.warn("[Tray] Could not read the 32px tray logo; update icons disabled");
  return null;
}

function createIndicator(): TrayIndicator {
  let logo: AlphaMask | null | undefined;
  return createTrayIndicator<NativeImage>({
    baseImage: () => trayBaseIcon ?? nativeImage.createEmpty(),
    logoAlpha: () => {
      if (logo === undefined) logo = loadLogoAlpha();
      return logo;
    },
    toImage: (mask) => {
      const img = nativeImage.createFromBitmap(maskToBGRA(mask), {
        width: ICON_PX,
        height: ICON_PX,
        scaleFactor: 2,
      });
      img.setTemplateImage(true);
      return img;
    },
    setImage: (img) => {
      if (tray && !tray.isDestroyed()) tray.setImage(img);
    },
    prefersReducedMotion: () => {
      try {
        return systemPreferences.getAnimationSettings().prefersReducedMotion;
      } catch {
        return false;
      }
    },
  });
}

// ── Dev-only state preview ─────────────────────────────────────────────
// SPOKE_TRAY_DEMO=1 npm run dev cycles every update state in the menu bar
// without a real update. Never runs in a packaged build.

function stopTrayDemo() {
  for (const t of demoTimers) clearTimeout(t);
  demoTimers = [];
  demoRunning = false;
}

function startTrayDemo() {
  if (app.isPackaged || process.env.SPOKE_TRAY_DEMO !== "1" || !indicator) return;
  console.log("[Tray] SPOKE_TRAY_DEMO: cycling update states");
  demoRunning = true;
  const at = (ms: number, fn: () => void) => demoTimers.push(setTimeout(fn, ms));
  const cycle = () => {
    demoTimers = [];
    const show = (visual: IndicatorVisual) => indicator?.show(visual);
    at(0, () => show({ kind: "idle" }));
    const downloadStart = 1500;
    const downloadMs = 8000;
    for (let p = 0; p <= 100; p++)
      at(downloadStart + (downloadMs * p) / 100, () => show({ kind: "download", percent: p }));
    const readyAt = downloadStart + downloadMs + 100;
    at(readyAt, () => show({ kind: "ready" }));
    at(readyAt + 3500, () => show({ kind: "failed" }));
    at(readyAt + 5500, () => show({ kind: "installing" }));
    at(readyAt + 8500, () => show({ kind: "idle" }));
    at(readyAt + 10000, cycle);
  };
  cycle();
}

export const createTray = () => {
  try {
    bootTimeline.mark("tray:create:start");
    console.log("[Tray] Starting tray creation...");

    // Check if tray already exists
    if (tray) {
      console.log("[Tray] Tray already exists, skipping creation");
      bootTimeline.mark("tray:create:skipped-existing");
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

    tray.setToolTip(updateIndicatorTooltip(getUpdateSnapshot()));

    if (process.platform === "darwin") {
      tray.setIgnoreDoubleClickEvents(false);
    }

    console.log("[Tray] Tooltip set");

    // Create enhanced native context menu with dynamic microphone list
    console.log("[Tray] Building context menu...");
    const menuTemplate = buildTrayMenu();
    const contextMenu = Menu.buildFromTemplate(menuTemplate);

    // Set the native context menu
    console.log("[Tray] Setting context menu...");
    tray.setContextMenu(contextMenu);
    trayBaseIcon = icon;
    indicator = createIndicator();
    applyUpdateIcon(getUpdateSnapshot());
    startTrayDemo();
    console.log("[Tray] ✅ Tray created successfully with enhanced menu!");
    bootTimeline.mark("tray:create:done");
  } catch (error) {
    console.error("[Tray] ❌ Failed to create tray:", error);
    console.error(
      "[Tray] Error stack:",
      error instanceof Error ? error.stack : undefined,
    );
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
