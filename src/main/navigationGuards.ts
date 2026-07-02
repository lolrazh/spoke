/**
 * Navigation Guards
 *
 * Restricts renderer windows to the app's own origin and routes any
 * external-link requests through a single, scheme-allowlisted opener rather
 * than letting Electron spawn arbitrary new windows or navigate in-place to
 * untrusted URLs.
 */

import { shell, type WebContents } from "electron";

// Only these URL schemes may be handed to the OS default handler.
// Note: macOS System Settings deep links (x-apple.systempreferences:) are
// opened directly from the main process in src/main/permissions.ts and never
// travel through this path, so they are deliberately not allowlisted here.
const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export async function openExternalUrlSafely(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn(`[OpenExternal] Blocked malformed URL: ${url}`);
    return false;
  }

  if (!ALLOWED_EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
    console.warn(
      `[OpenExternal] Blocked URL with disallowed scheme '${parsed.protocol}': ${url}`,
    );
    return false;
  }

  await shell.openExternal(parsed.toString());
  return true;
}

export function isAllowedAppNavigation(url: string): boolean {
  try {
    const target = new URL(url);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devOrigin = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
      if (target.origin === devOrigin) return true;
    }
    // Packaged builds load the renderer from the bundled file:// entry.
    return target.protocol === "file:";
  } catch {
    return false;
  }
}

// Deny all new windows and lock in-window navigation to the app's own origin.
// External http(s) links requested via window.open are routed to the
// validated opener instead of spawning a BrowserWindow.
export function applyNavigationGuards(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      openExternalUrlSafely(url).catch((err) => {
        console.error("[Navigation] Failed to open external URL:", err);
      });
    } else {
      console.warn(`[Navigation] Blocked window.open for: ${url}`);
    }
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    console.warn(`[Navigation] Blocked navigation to: ${url}`);
  });
}
