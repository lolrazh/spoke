/**
 * Window Animation
 *
 * Smooth show/hide transitions for BrowserWindows using opacity fading.
 * Prevents the white flash that occurs when showing transparent windows
 * by setting opacity to 0 before showing, then fading in.
 */

import type { BrowserWindow } from "electron";

/**
 * Show a window with a smooth fade-in. Sets opacity to 0, shows immediately,
 * then transitions to full opacity after a brief frame commit delay.
 */
export const smoothShow = (win: BrowserWindow | null, fadeMs = 140): void => {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(0);
    win.show();
    setTimeout(
      () => {
        if (!win || win.isDestroyed()) return;
        win.setOpacity(1);
      },
      Math.max(50, Math.min(fadeMs, 300)),
    );
  } catch (e) {
    try {
      win?.show();
    } catch {}
  }
};

/**
 * Hide a window with a smooth fade-out. Drops opacity to 0, then hides
 * after the transition completes.
 */
export const smoothHide = (win: BrowserWindow | null, fadeMs = 140): void => {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(1);
    setTimeout(() => {
      try {
        win.setOpacity(0);
      } catch {}
      setTimeout(
        () => {
          try {
            win.hide();
          } catch {}
        },
        Math.max(50, Math.min(fadeMs, 300)),
      );
    }, 0);
  } catch (e) {
    try {
      win?.hide();
    } catch {}
  }
};
