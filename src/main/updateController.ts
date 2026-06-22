/**
 * Update Controller
 *
 * Wires Electron's built-in Squirrel.Mac autoUpdater to the free
 * update.electronjs.org service, which serves a Squirrel feed straight from
 * the public GitHub Releases of this repo. Tracks state for the tray UI and
 * surfaces notifications. Updates only work in a signed, packaged build.
 */

import { app, autoUpdater } from "electron";

// ── Config ─────────────────────────────────────────────────────────────

const GITHUB_OWNER = "lolrazh";
const GITHUB_REPO = "spoke";

// ── Types ──────────────────────────────────────────────────────────────

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "error";

export interface UpdateCallbacks {
  sendNotify: (message: string) => void;
  rebuildTrayMenu: () => void;
}

// ── Internal state ─────────────────────────────────────────────────────

let updateStatus: UpdateStatus = "idle";
let updateAvailableVersion: string | null = null;
let updateReadyToInstall = false;
let updateError: string | null = null;
let updaterListenersInitialized = false;
let feedConfigured = false;
let manualUpdateCheckInFlight = false;
let pendingUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateBackoffMs: number | null = null;

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
let callbacks: UpdateCallbacks = {
  sendNotify: noop,
  rebuildTrayMenu: noop,
};

// ── Initialization ─────────────────────────────────────────────────────

export function initUpdateController(cbs: UpdateCallbacks): void {
  callbacks = cbs;
}

// ── State accessors ────────────────────────────────────────────────────

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export function getUpdateAvailableVersion(): string | null {
  return updateAvailableVersion;
}

export function isUpdateReadyToInstall(): boolean {
  return updateReadyToInstall;
}

export function getUpdateError(): string | null {
  return updateError;
}

// ── State management ───────────────────────────────────────────────────

function setUpdateState(
  next: UpdateStatus,
  opts?: { version?: string; error?: string },
) {
  updateStatus = next;
  updateAvailableVersion = opts?.version ?? updateAvailableVersion;
  updateError =
    opts?.error ?? (next === "error" ? opts?.error || "Unknown error" : null);
  try {
    callbacks.rebuildTrayMenu();
  } catch {}
}

// ── Utilities ──────────────────────────────────────────────────────────

function getFeedUrl(): string {
  // update.electronjs.org maps a bare "darwin" platform to darwin-x64. This is
  // an Apple-Silicon-only build, so we must request the arch-specific channel
  // (darwin-arm64) or the service finds no matching asset and 404s.
  // Format: /OWNER/REPO/PLATFORM-ARCH/CURRENT_VERSION
  const platform = `${process.platform}-${process.arch}`;
  return `https://update.electronjs.org/${GITHUB_OWNER}/${GITHUB_REPO}/${platform}/${app.getVersion()}`;
}

function ensureFeedConfigured(): boolean {
  if (feedConfigured) return true;
  try {
    autoUpdater.setFeedURL({ url: getFeedUrl() });
    feedConfigured = true;
    return true;
  } catch (e) {
    console.warn("[auto-update] setFeedURL failed:", e);
    return false;
  }
}

function jitterMs(baseMs: number, pct = 0.2): number {
  const f = 1 + (Math.random() * 2 - 1) * pct;
  return Math.max(0, Math.round(baseMs * f));
}

// ── Updater event bridge ───────────────────────────────────────────────

function initUpdaterEventBridgeOnce() {
  if (updaterListenersInitialized) return;
  updaterListenersInitialized = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState("checking");
  });

  // Squirrel.Mac auto-downloads after finding an update; there is no
  // download-progress event, just update-available then update-downloaded.
  autoUpdater.on("update-available", () => {
    updateReadyToInstall = false;
    setUpdateState("available");
    callbacks.sendNotify("Update found. Downloading…");
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState("not-available");
    if (manualUpdateCheckInFlight) callbacks.sendNotify("You're up to date.");
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("error", (err: Error) => {
    const msg = err?.message || String(err) || "Unknown updater error";
    setUpdateState("error", { error: msg });
    if (manualUpdateCheckInFlight)
      callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  });

  // Signature: (event, releaseNotes, releaseName, releaseDate, updateURL)
  autoUpdater.on(
    "update-downloaded",
    (_event, _releaseNotes, releaseName) => {
      if (releaseName) updateAvailableVersion = String(releaseName);
      updateReadyToInstall = true;
      setUpdateState("available");
      callbacks.sendNotify("Update ready. Restart to install.");
      manualUpdateCheckInFlight = false;
    },
  );
}

// ── Public API ─────────────────────────────────────────────────────────

export async function manualCheckForUpdates(silent = false): Promise<void> {
  if (!app.isPackaged) {
    if (!silent)
      callbacks.sendNotify("Updates are only available in packaged builds.");
    return;
  }
  if (updateStatus === "checking") return;

  initUpdaterEventBridgeOnce();
  if (!ensureFeedConfigured()) {
    setUpdateState("error", { error: "Could not configure update feed" });
    if (!silent) callbacks.sendNotify("Update check failed.");
    return;
  }

  try {
    setUpdateState("checking");
    manualUpdateCheckInFlight = !silent;
    if (!silent) callbacks.sendNotify("Checking for updates…");
    // checkForUpdates emits the events wired above; it does not return a value.
    autoUpdater.checkForUpdates();
  } catch (err: any) {
    const msg = err?.message || String(err);
    setUpdateState("error", { error: msg });
    if (!silent) callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  }
}

export function quitAndInstallUpdate(): void {
  try {
    console.log("[Updater] quitAndInstall invoked");
    autoUpdater.quitAndInstall();
  } catch (e) {
    console.warn(
      "[Updater] quitAndInstall failed; relaunching as fallback:",
      e,
    );
    try {
      app.relaunch();
      app.quit();
    } catch (relaunchErr) {
      console.warn("[Updater] Fallback relaunch failed:", relaunchErr);
    }
    return;
  }

  // Squirrel.Mac (ShipIt) only swaps the bundle once THIS process exits. By the
  // time quitAndInstall returns ShipIt is already armed and waiting on our PID,
  // but on a menu-bar app quitAndInstall doesn't reliably terminate us
  // (window-all-closed keeps the app alive), so the install hangs indefinitely.
  // Drive the same clean-quit path the "Quit Spoke" menu uses — it runs the
  // before-quit cleanup that kills the sidecar/helpers — then hard-backstop with
  // exit() if even that stalls.
  app.quit();
  setTimeout(() => {
    console.warn("[Updater] still alive after quitAndInstall; forcing exit");
    app.exit(0);
  }, 4000).unref();
}

export function scheduleUpdateCheck(
  delayMs: number,
  reason: string,
  silent = true,
) {
  try {
    if (pendingUpdateCheckTimer) clearTimeout(pendingUpdateCheckTimer);
  } catch {}
  pendingUpdateCheckTimer = setTimeout(async () => {
    pendingUpdateCheckTimer = null;
    console.log(`[auto-update] Triggered background check: ${reason}`);
    const prevBackoff = updateBackoffMs;
    await manualCheckForUpdates(silent);
    if (updateStatus === "error") {
      updateBackoffMs = Math.min(
        prevBackoff ? prevBackoff * 2 : 15 * 60 * 1000,
        24 * 60 * 60 * 1000,
      );
      console.log(
        `[auto-update] Error during check; scheduling backoff in ${Math.round((updateBackoffMs || 0) / 60000)}m`,
      );
      scheduleUpdateCheck(updateBackoffMs!, "backoff-retry", true);
    } else {
      updateBackoffMs = null;
    }
  }, delayMs);
}

// Re-export jitterMs for tray menu scheduling
export { jitterMs };
