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
const UPDATE_CHECK_TIMEOUT_MS = 60_000;
const UPDATE_FEED_PREFLIGHT_TIMEOUT_MS = 8_000;

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
let updateAvailableNotificationSent = false;
let pendingUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateBackoffMs: number | null = null;
let updateCheckWatchdog: NodeJS.Timeout | null = null;

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

function clearUpdateCheckWatchdog() {
  if (!updateCheckWatchdog) return;
  try {
    clearTimeout(updateCheckWatchdog);
  } catch {}
  updateCheckWatchdog = null;
}

function startUpdateCheckWatchdog(silent: boolean) {
  clearUpdateCheckWatchdog();
  updateCheckWatchdog = setTimeout(() => {
    updateCheckWatchdog = null;
    if (updateStatus !== "checking") return;

    const msg = `No updater response after ${Math.round(
      UPDATE_CHECK_TIMEOUT_MS / 1000,
    )}s`;
    console.warn("[auto-update] timed out:", msg);
    setUpdateState("error", { error: msg });
    if (!silent || manualUpdateCheckInFlight)
      callbacks.sendNotify("Update check timed out. Try again in a moment.");
    manualUpdateCheckInFlight = false;
  }, UPDATE_CHECK_TIMEOUT_MS);
  updateCheckWatchdog.unref?.();
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

type UpdateFeedPreflightResult =
  | { status: "available"; version: string | null }
  | { status: "not-available" }
  | { status: "unknown"; error: string };

async function preflightUpdateFeed(
  feedUrl: string,
): Promise<UpdateFeedPreflightResult> {
  if (typeof fetch !== "function") {
    return { status: "unknown", error: "fetch is not available" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPDATE_FEED_PREFLIGHT_TIMEOUT_MS,
  );
  timeout.unref?.();

  try {
    const response = await fetch(feedUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (response.status === 204) return { status: "not-available" };

    if (response.status === 200) {
      let version: string | null = null;
      try {
        const body = (await response.json()) as { name?: unknown };
        if (typeof body?.name === "string" && body.name.trim()) {
          version = body.name;
        }
      } catch (err) {
        console.warn("[auto-update] feed preflight JSON parse failed:", err);
      }
      return { status: "available", version };
    }

    return {
      status: "unknown",
      error: `feed responded ${response.status} ${response.statusText}`,
    };
  } catch (err: unknown) {
    return {
      status: "unknown",
      error: getErrorMessage(err, "feed request failed"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function ensureFeedConfigured(): boolean {
  if (feedConfigured) return true;
  try {
    const feedUrl = getFeedUrl();
    console.log("[auto-update] configuring feed:", feedUrl);
    autoUpdater.setFeedURL({ url: feedUrl });
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

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

function notifyUpdateDownloadStarted() {
  if (updateAvailableNotificationSent) return;
  callbacks.sendNotify("Update found. Downloading…");
  updateAvailableNotificationSent = true;
}

// ── Updater event bridge ───────────────────────────────────────────────

function initUpdaterEventBridgeOnce() {
  if (updaterListenersInitialized) return;
  updaterListenersInitialized = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-update] checking-for-update");
    if (updateStatus !== "available") setUpdateState("checking");
  });

  // Squirrel.Mac auto-downloads after finding an update; there is no
  // download-progress event, just update-available then update-downloaded.
  autoUpdater.on("update-available", () => {
    console.log("[auto-update] update-available");
    clearUpdateCheckWatchdog();
    updateReadyToInstall = false;
    setUpdateState("available");
    notifyUpdateDownloadStarted();
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-update] update-not-available");
    clearUpdateCheckWatchdog();
    setUpdateState("not-available");
    if (manualUpdateCheckInFlight) callbacks.sendNotify("You're up to date.");
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("error", (err: Error) => {
    clearUpdateCheckWatchdog();
    const msg = err?.message || String(err) || "Unknown updater error";
    // Log even on silent background checks — an invisible error here is exactly
    // what makes a stuck updater impossible to tell apart from "up to date".
    console.error("[auto-update] error:", msg);
    setUpdateState("error", { error: msg });
    if (manualUpdateCheckInFlight)
      callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  });

  // Signature: (event, releaseNotes, releaseName, releaseDate, updateURL)
  autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
    console.log("[auto-update] update-downloaded:", releaseName);
    clearUpdateCheckWatchdog();
    if (releaseName) updateAvailableVersion = String(releaseName);
    updateReadyToInstall = true;
    setUpdateState("available");
    callbacks.sendNotify("Update ready. Restart to install.");
    updateAvailableNotificationSent = false;
    manualUpdateCheckInFlight = false;
  });
}

// ── Public API ─────────────────────────────────────────────────────────

export async function manualCheckForUpdates(silent = false): Promise<void> {
  if (!app.isPackaged) {
    if (!silent)
      callbacks.sendNotify("Updates are only available in packaged builds.");
    return;
  }
  if (updateReadyToInstall) {
    if (!silent) callbacks.sendNotify("Update ready. Restart to install.");
    return;
  }
  if (updateStatus === "available") {
    if (!silent) callbacks.sendNotify("Update found. Downloading…");
    return;
  }
  if (updateStatus === "checking") {
    if (!silent) callbacks.sendNotify("Still checking for updates…");
    return;
  }

  initUpdaterEventBridgeOnce();
  if (!ensureFeedConfigured()) {
    setUpdateState("error", { error: "Could not configure update feed" });
    if (!silent) callbacks.sendNotify("Update check failed.");
    return;
  }

  try {
    setUpdateState("checking");
    manualUpdateCheckInFlight = !silent;
    updateAvailableNotificationSent = false;
    if (!silent) callbacks.sendNotify("Checking for updates…");
    const feedUrl = getFeedUrl();
    console.log("[auto-update] checkForUpdates requested", {
      manual: !silent,
      feed: feedUrl,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    });
    startUpdateCheckWatchdog(silent);

    const preflight = await preflightUpdateFeed(feedUrl);
    if (preflight.status === "available") {
      updateReadyToInstall = false;
      setUpdateState("available", { version: preflight.version ?? undefined });
      if (!silent) notifyUpdateDownloadStarted();
    } else if (preflight.status === "not-available") {
      clearUpdateCheckWatchdog();
      setUpdateState("not-available");
      if (!silent) callbacks.sendNotify("You're up to date.");
      manualUpdateCheckInFlight = false;
      return;
    } else {
      console.warn("[auto-update] feed preflight inconclusive:", preflight.error);
    }

    // checkForUpdates emits the events wired above; it does not return a value.
    autoUpdater.checkForUpdates();
  } catch (err: unknown) {
    clearUpdateCheckWatchdog();
    const msg = getErrorMessage(err, "Unknown updater error");
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
      const nextBackoffMs = Math.min(
        prevBackoff ? prevBackoff * 2 : 15 * 60 * 1000,
        24 * 60 * 60 * 1000,
      );
      updateBackoffMs = nextBackoffMs;
      console.log(
        `[auto-update] Error during check; scheduling backoff in ${Math.round(nextBackoffMs / 60000)}m`,
      );
      scheduleUpdateCheck(nextBackoffMs, "backoff-retry", true);
    } else {
      updateBackoffMs = null;
    }
  }, delayMs);
}

// Re-export jitterMs for tray menu scheduling
export { jitterMs };
