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
  BrowserWindow,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
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
} from "./updateController";
import { pasteLastTranscript } from "./pasteOrchestrator";
import { state } from "./windowState";

// ── Internal state ─────────────────────────────────────────────────────

let tray: Tray | null = null;

// ── Floating bar submenu ───────────────────────────────────────────────

export function buildFloatingBarMenuItems(): MenuItemConstructorOptions[] {
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

export function buildTrayMenu(): MenuItemConstructorOptions[] {
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

  function restartToInstallUpdate() {
    quitAndInstallUpdate();
  }
  function downloadAndInstallUpdate() {
    // Arm auto-restart, then start the download for the available update.
    state.installUpdateWhenReady = true;
    downloadUpdate();
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
            click: () => downloadAndInstallUpdate(),
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
