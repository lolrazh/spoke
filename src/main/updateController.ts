/**
 * Update Controller
 *
 * Wires electron-updater to the public GitHub Releases of this repo. Unlike
 * Squirrel.Mac, electron-updater downloads the release zip itself and emits
 * download-progress events, so it is the single authoritative source of truth
 * for the whole flow (check, download, ready). It also lets us show real
 * download percentage and detect a stalled download. Tracks state for the tray
 * UI and surfaces notifications. Updates only work in a signed, packaged build.
 *
 * Forge note: Electron Forge does not generate an app-update.yml inside the
 * packaged app (electron-builder would), so electron-updater has no embedded
 * feed config. We configure the GitHub provider in code via setFeedURL().
 */

import { app } from "electron";
import { autoUpdater } from "electron-updater";

// ── Config ─────────────────────────────────────────────────────────────

const GITHUB_OWNER = "lolrazh";
const GITHUB_REPO = "spoke";
// How long a check may sit in "checking" with no result before we give up.
const UPDATE_CHECK_TIMEOUT_MS = 60_000;
// How long the download phase may go without a progress event before we treat
// it as stalled. Full-zip mac downloads are large, but a healthy connection
// emits progress every few hundred ms, so a 90s gap means something is wrong.
const UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 90_000;
// Long-lived menu-bar app: re-check on a slow cadence so a build released while
// the app stays open eventually gets picked up without a restart.
const PERIODIC_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "not-available"
  | "error";

export interface UpdateCallbacks {
  sendNotify: (message: string) => void;
  rebuildTrayMenu: () => void;
  onStateChange?: (snapshot: UpdateSnapshot) => void;
}

export interface UpdateSnapshot {
  status: UpdateStatus;
  version: string | null;
  readyToInstall: boolean;
  error: string | null;
  // 0..100 while a download is in flight, 100 once ready, null otherwise.
  downloadPercent: number | null;
}

export type DevUpdateState = UpdateStatus | "ready";

// ── Internal state ─────────────────────────────────────────────────────

let updateStatus: UpdateStatus = "idle";
let updateAvailableVersion: string | null = null;
let updateReadyToInstall = false;
let updateError: string | null = null;
let updateDownloadPercent: number | null = null;
let updaterListenersInitialized = false;
let feedConfigured = false;
let manualUpdateCheckInFlight = false;
let updateAvailableNotificationSent = false;
let pendingUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateBackoffMs: number | null = null;
let updateCheckWatchdog: NodeJS.Timeout | null = null;
let updateDownloadWatchdog: NodeJS.Timeout | null = null;

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

export function getUpdateSnapshot(): UpdateSnapshot {
  return {
    status: updateStatus,
    version: updateAvailableVersion,
    readyToInstall: updateReadyToInstall,
    error: updateError,
    downloadPercent: updateDownloadPercent,
  };
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
  try {
    callbacks.onStateChange?.(getUpdateSnapshot());
  } catch {}
}

// ── Watchdogs ──────────────────────────────────────────────────────────
// Two phases can hang: the check (no result) and the download (no progress).
// Each has its own timer; both are cleared on any terminal event.

function clearUpdateCheckWatchdog() {
  if (!updateCheckWatchdog) return;
  try {
    clearTimeout(updateCheckWatchdog);
  } catch {}
  updateCheckWatchdog = null;
}

function clearUpdateDownloadWatchdog() {
  if (!updateDownloadWatchdog) return;
  try {
    clearTimeout(updateDownloadWatchdog);
  } catch {}
  updateDownloadWatchdog = null;
}

function clearAllWatchdogs() {
  clearUpdateCheckWatchdog();
  clearUpdateDownloadWatchdog();
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

// Armed when the download begins and re-armed on every progress event, so it
// only fires if progress actually stops. This is the fix for the worst legacy
// bug: a download that silently wedged showed a permanent "downloading" state.
function startUpdateDownloadWatchdog() {
  clearUpdateDownloadWatchdog();
  updateDownloadWatchdog = setTimeout(() => {
    updateDownloadWatchdog = null;
    if (updateReadyToInstall) return;
    if (updateStatus !== "downloading" && updateStatus !== "available") return;

    const msg = `Download stalled (no progress for ${Math.round(
      UPDATE_DOWNLOAD_STALL_TIMEOUT_MS / 1000,
    )}s)`;
    console.warn("[auto-update] download stalled:", msg);
    setUpdateState("error", { error: msg });
    callbacks.sendNotify("Update download stalled. Try again in a moment.");
    manualUpdateCheckInFlight = false;
  }, UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
  updateDownloadWatchdog.unref?.();
}

// ── Utilities ──────────────────────────────────────────────────────────

function ensureFeedConfigured(): boolean {
  if (feedConfigured) return true;
  try {
    // No app-update.yml under Forge, so point the GitHub provider at the repo
    // in code. electron-updater resolves latest-mac.yml from its Releases.
    console.log("[auto-update] configuring github feed:", {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    autoUpdater.setFeedURL({
      provider: "github",
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
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

  // Auto-download in the background once found (Raycast-style), but now it is
  // observable via download-progress. Install on the next quit if not sooner.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-update] checking-for-update");
    if (updateStatus !== "available" && updateStatus !== "downloading")
      setUpdateState("checking");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[auto-update] update-available:", info?.version);
    clearUpdateCheckWatchdog();
    updateReadyToInstall = false;
    updateDownloadPercent = null;
    if (info?.version) updateAvailableVersion = String(info.version);
    setUpdateState("available", { version: updateAvailableVersion ?? undefined });
    notifyUpdateDownloadStarted();
    // The download starts now; watch for it stalling.
    startUpdateDownloadWatchdog();
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("download-progress", (progress) => {
    const raw = typeof progress?.percent === "number" ? progress.percent : 0;
    updateDownloadPercent = Math.max(0, Math.min(100, Math.round(raw)));
    // Re-arm the stall watchdog on every chunk so it only fires on real stalls.
    startUpdateDownloadWatchdog();
    setUpdateState("downloading");
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-update] update-not-available");
    clearAllWatchdogs();
    updateDownloadPercent = null;
    setUpdateState("not-available");
    if (manualUpdateCheckInFlight) callbacks.sendNotify("You're up to date.");
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("error", (err: Error) => {
    clearAllWatchdogs();
    const msg = err?.message || String(err) || "Unknown updater error";
    // Log even on silent background checks. An invisible error here is exactly
    // what makes a stuck updater impossible to tell apart from "up to date".
    console.error("[auto-update] error:", msg);
    setUpdateState("error", { error: msg });
    if (manualUpdateCheckInFlight)
      callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[auto-update] update-downloaded:", info?.version);
    clearAllWatchdogs();
    if (info?.version) updateAvailableVersion = String(info.version);
    updateReadyToInstall = true;
    updateDownloadPercent = 100;
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
  if (updateStatus === "available" || updateStatus === "downloading") {
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
    updateDownloadPercent = null;
    setUpdateState("checking");
    manualUpdateCheckInFlight = !silent;
    updateAvailableNotificationSent = false;
    // No "checking" notification. A manual check conveys only its result (up to
    // date, update found, or failed), so there is one notification per action
    // instead of a redundant "checking" then "result" pair. The tray menu item
    // still shows "Checking for Updates…" as live feedback while it runs.
    console.log("[auto-update] checkForUpdates requested", {
      manual: !silent,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    });
    startUpdateCheckWatchdog(silent);

    // checkForUpdates drives the events wired above. With autoDownload it also
    // kicks off the download. We don't need its return value; events are the
    // source of truth. Errors surface via the "error" event; the catch below
    // is only a backstop for a synchronous/rejecting throw with no event.
    await autoUpdater.checkForUpdates();
  } catch (err: unknown) {
    if (updateStatus === "error") return;
    clearAllWatchdogs();
    const msg = getErrorMessage(err, "Unknown updater error");
    setUpdateState("error", { error: msg });
    if (!silent) callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  }
}

export function setDevUpdateStateForTesting(
  next: DevUpdateState,
): { ok: boolean; snapshot: UpdateSnapshot; error?: string } {
  if (app.isPackaged) {
    return {
      ok: false,
      snapshot: getUpdateSnapshot(),
      error: "Dev update state is unavailable in packaged builds",
    };
  }

  updateReadyToInstall = next === "ready";
  updateAvailableNotificationSent = next === "available";
  updateAvailableVersion =
    next === "available" || next === "ready" || next === "downloading"
      ? `v${app.getVersion()}-dev`
      : null;
  updateDownloadPercent =
    next === "ready" ? 100 : next === "downloading" ? 42 : null;

  if (next === "ready") {
    setUpdateState("available");
  } else if (next === "error") {
    setUpdateState("error", { error: "Dev update preview" });
  } else {
    setUpdateState(next);
  }

  return { ok: true, snapshot: getUpdateSnapshot() };
}

export function quitAndInstallUpdate(): void {
  try {
    console.log("[Updater] quitAndInstall invoked");
    // isSilent=false (show the installer UX), isForceRunAfter=true (relaunch
    // the new build once installed instead of just quitting).
    autoUpdater.quitAndInstall(false, true);
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

  // The installer only swaps the bundle once THIS process exits. On a menu-bar
  // app quitAndInstall doesn't reliably terminate us (window-all-closed keeps
  // the app alive), so the install would hang indefinitely. Drive the same
  // clean-quit path the "Quit Spoke" menu uses (it runs the before-quit cleanup
  // that kills the sidecar/helpers), then hard-backstop with exit() if it stalls.
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
      // Self-perpetuating slow cadence. There is only ever one pending timer,
      // so a startup/resume-triggered check simply replaces this one. That is
      // what keeps resume from double-scheduling.
      scheduleUpdateCheck(
        jitterMs(PERIODIC_UPDATE_CHECK_INTERVAL_MS),
        "periodic",
        true,
      );
    }
  }, delayMs);
  pendingUpdateCheckTimer.unref?.();
}

// Re-export jitterMs for tray menu scheduling
export { jitterMs };
