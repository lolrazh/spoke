/**
 * Window IPC
 *
 * Pill window controls: expand/reveal, the pill's right-click context menu,
 * slide/bounds updates, click-through & focusable toggles, floating-bar
 * visibility, and dock icon visibility.
 */

import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";

import { ISLAND_HIDDEN_Y, ISLAND_VISIBLE_Y } from "../../constants/window";
import { logger } from "../../utils/logger";
import { state } from "../windowState";
import { createWindow, getActiveDisplay, coalescedSetBounds } from "../windows";
import { rebuildTrayMenu, buildPillContextMenu } from "../tray";
import { smoothShow, smoothHide } from "../windowAnimation";
import {
  clearHideTimer,
  isFloatingBarEnabled,
  setFloatingBarEnabled,
} from "../floatingBar";
import { saveAppPreferences } from "../preferences";

export function registerWindowIpc(): void {
  // Allow other windows (onboarding) to request the pill to expand without directly moving the window
  ipcMain.handle("pill:expand", () => {
    try {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!state.mainWindow) return { ok: false };

      // Bring pill to visible top-aligned position and reveal
      const current = state.mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      const needMove = current.y !== targetY;
      if (needMove) {
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
      }
      // Only run fade-in if currently hidden to avoid flicker
      if (!state.mainWindow.isVisible()) {
        smoothShow(state.mainWindow);
      }

      // Ask renderer to expand the pill UI
      state.mainWindow.webContents.send("expand-pill");
      return { ok: true };
    } catch (e) {
      console.warn("[pill:expand] Failed to expand pill:", e);
      return { ok: false };
    }
  });

  // Reveal the pill without expanding (used by onboarding test steps)
  ipcMain.handle("pill:reveal", () => {
    try {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!state.mainWindow) return { ok: false };

      // During onboarding, ensure pill stays hidden and below the top edge
      if (state.pttTarget === "onboarding") {
        const current = state.mainWindow.getBounds();
        const display = screen.getDisplayMatching(current);
        const hideY = display.bounds.y + ISLAND_HIDDEN_Y;
        if (current.y !== hideY) {
          state.mainWindow.setBounds(
            {
              x: current.x,
              y: hideY,
              width: current.width,
              height: current.height,
            },
            false,
          );
          if (process.platform === "darwin")
            state.mainWindow.invalidateShadow();
        }
        // Do not show the window while onboarding owns the flow
        return { ok: true };
      }

      const current = state.mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      const needMove = current.y !== targetY;
      if (needMove) {
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
      }
      if (!state.mainWindow.isVisible()) {
        smoothShow(state.mainWindow);
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
      if (!state.mainWindow || state.mainWindow.isDestroyed()) {
        createWindow();
      }
      if (!state.mainWindow) return { ok: false };

      // Allow reveal only during onboarding test steps; keep compact and at visible Y
      const current = state.mainWindow.getBounds();
      const display = screen.getDisplayMatching(current);
      const targetY = display.workArea.y + ISLAND_VISIBLE_Y;
      if (current.y !== targetY) {
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
      }
      if (!state.mainWindow.isVisible()) {
        smoothShow(state.mainWindow);
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
    if (state.mainWindow) {
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
      contextMenu.popup({ window: state.mainWindow });
    }
  });

  // Handle pill expansion requests
  ipcMain.on("expand-pill", () => {
    console.log("[IPC Main] Received expand-pill event");
    if (state.mainWindow) {
      state.mainWindow.webContents.send("expand-pill");
    }
  });

  // Removed legacy explicit show/hide handlers in favor of island-slide and state-driven visibility

  ipcMain.on("island-slide", (_e, y) => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      const display = getActiveDisplay();
      const current = state.mainWindow.getBounds();
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

  // Floating bar visibility controls for renderer-driven UX flows
  ipcMain.handle("floating-bar:is-visible", () => {
    try {
      const visible = !!(
        state.mainWindow &&
        !state.mainWindow.isDestroyed() &&
        state.mainWindow.isVisible()
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
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        smoothHide(state.mainWindow);
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
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        smoothShow(state.mainWindow);
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
    const visible = state.appPreferences.showInDock ?? true;
    return { visible };
  });

  ipcMain.handle(
    "dock:set-visible",
    async (_event, payload: { visible: boolean }) => {
      try {
        const { visible } = payload;

        // Set flag to prevent blur-triggered collapse during dock operation
        state.dockOperationInProgress = true;

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
        state.appPreferences.showInDock = visible;
        saveAppPreferences(state.appPreferences);

        // Clear flag after a brief delay to allow focus to settle
        setTimeout(() => {
          state.dockOperationInProgress = false;
        }, 300);

        return { ok: true };
      } catch (e) {
        state.dockOperationInProgress = false; // Clear flag on error
        logger.main.error("[Dock] Failed to set visibility:", e);
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // Handle dynamic click-through control
  ipcMain.on("set-click-through", (event, clickThrough: boolean) => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    }
  });

  // Allow renderer to toggle focusable during expanded settings mode
  ipcMain.on("set-focusable", (event, focusable: boolean) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        // setFocusable is a no-op on some platforms; call defensively
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (state.mainWindow as any).setFocusable?.(focusable);
      }
    } catch (e) {
      // ignore
    }
  });

  // Allow renderer to focus the window (needed for proper cursor hover states)
  ipcMain.on("focus-window", () => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.focus();
      }
    } catch (e) {
      // ignore
    }
  });
}
