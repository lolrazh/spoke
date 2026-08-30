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

import { app, autoUpdater as nativeSquirrelUpdater } from "electron";

type ElectronUpdater = typeof import("electron-updater").autoUpdater;

let autoUpdater: ElectronUpdater | null = null;
let autoUpdaterLoadPromise: Promise<ElectronUpdater> | null = null;

/** Load the heavy updater package only when an update operation needs it. */
async function loadAutoUpdater(): Promise<ElectronUpdater> {
  if (autoUpdater) return autoUpdater;
  if (!autoUpdaterLoadPromise) {
    autoUpdaterLoadPromise = import("electron-updater")
      .then(({ autoUpdater: loadedUpdater }) => {
        autoUpdater = loadedUpdater;
        return loadedUpdater;
      })
      .catch((error) => {
        autoUpdaterLoadPromise = null;
        throw error;
      });
  }
  return autoUpdaterLoadPromise;
}

// ── Config ─────────────────────────────────────────────────────────────

const GITHUB_OWNER = "lolrazh";
const GITHUB_REPO = "spoke";
// How long a check may sit in "checking" with no result before we give up.
const UPDATE_CHECK_TIMEOUT_MS = 60_000;
// How long the download phase may go without a progress event before we treat
// it as stalled. Full-zip mac downloads are large, but a healthy connection
// emits progress every few hundred ms, so a 90s gap means something is wrong.
const UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 90_000;
// After quitAndInstall() the native updater should begin the update quit
// sequence promptly. If it does not, keep the app alive and let the user retry.
const UPDATE_INSTALL_HANDOFF_TIMEOUT_MS = 120_000;
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
// Which version "Update available" was last announced for. Background checks
// re-run every few hours; the same version must only be announced once.
let lastNotifiedAvailableVersion: string | null = null;
// True from downloadUpdate() until a terminal download event. Lets the shared
// "error" handler tell a failed download (always user-driven, always worth a
// notification) apart from a failed background check.
let downloadInFlight = false;
// Which phase the last error came from. A download failure keeps the checked
// update info cached in electron-updater, so a retry can restart the transfer
// directly instead of dropping back to a fresh check.
let lastFailedPhase: "check" | "download" | null = null;
let pendingUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateBackoffMs: number | null = null;
let updateCheckWatchdog: NodeJS.Timeout | null = null;
let updateDownloadWatchdog: NodeJS.Timeout | null = null;
let quitAndInstallInvoked = false;
let updateInstallHandoffWatchdog: NodeJS.Timeout | null = null;
let updateInstallHandoffListener: (() => void) | null = null;

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

export function isUpdateReadyToInstall(): boolean {
  return updateReadyToInstall;
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

function clearUpdateInstallHandoffWatchdog() {
  if (!updateInstallHandoffWatchdog) return;
  try {
    clearTimeout(updateInstallHandoffWatchdog);
  } catch {}
  updateInstallHandoffWatchdog = null;
}

function clearUpdateInstallHandoffTracking() {
  clearUpdateInstallHandoffWatchdog();
  if (!updateInstallHandoffListener) return;
  try {
    nativeSquirrelUpdater?.removeListener?.(
      "before-quit-for-update",
      updateInstallHandoffListener,
    );
  } catch {}
  updateInstallHandoffListener = null;
}

function clearAllWatchdogs() {
  clearUpdateCheckWatchdog();
  clearUpdateDownloadWatchdog();
  clearUpdateInstallHandoffTracking();
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
    if (updateStatus !== "downloading") return;

    const msg = `Download stalled (no progress for ${Math.round(
      UPDATE_DOWNLOAD_STALL_TIMEOUT_MS / 1000,
    )}s)`;
    console.warn("[auto-update] download stalled:", msg);
    downloadInFlight = false;
    lastFailedPhase = "download";
    setUpdateState("error", { error: msg });
    callbacks.sendNotify("Update download stalled. Try again in a moment.");
    manualUpdateCheckInFlight = false;
  }, UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
  updateDownloadWatchdog.unref?.();
}

function startUpdateInstallHandoffWatchdog() {
  clearUpdateInstallHandoffWatchdog();
  updateInstallHandoffWatchdog = setTimeout(() => {
    updateInstallHandoffWatchdog = null;
    if (!quitAndInstallInvoked) return;

    const msg = `Install handoff did not begin after ${Math.round(
      UPDATE_INSTALL_HANDOFF_TIMEOUT_MS / 1000,
    )}s`;
    console.warn("[auto-update] install handoff timed out:", msg);
    quitAndInstallInvoked = false;
    clearUpdateInstallHandoffTracking();
    setUpdateState("error", { error: msg });
    callbacks.sendNotify("Update install did not start. Try again.");
  }, UPDATE_INSTALL_HANDOFF_TIMEOUT_MS);
  updateInstallHandoffWatchdog.unref?.();
}

// ── Utilities ──────────────────────────────────────────────────────────

function ensureFeedConfigured(updater: ElectronUpdater): boolean {
  if (feedConfigured) return true;
  try {
    // No app-update.yml under Forge, so point the GitHub provider at the repo
    // in code. electron-updater resolves latest-mac.yml from its Releases.
    console.log("[auto-update] configuring github feed:", {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    updater.setFeedURL({
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

function notifyUpdateAvailable() {
  if (
    updateAvailableVersion != null &&
    updateAvailableVersion === lastNotifiedAvailableVersion
  )
    return;
  callbacks.sendNotify("Update available");
  lastNotifiedAvailableVersion = updateAvailableVersion;
}

// ── Updater event bridge ───────────────────────────────────────────────

async function initUpdaterEventBridgeOnce(): Promise<ElectronUpdater> {
  const updater = await loadAutoUpdater();
  if (updaterListenersInitialized) return updater;
  updaterListenersInitialized = true;

  // The download is driven by a user action (the "available" capsule / tray
  // item calls downloadUpdate), not started automatically, so the available
  // state is a real beat the user taps. autoInstallOnAppQuit still applies a
  // finished download on the next quit.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;

  updater.on("checking-for-update", () => {
    console.log("[auto-update] checking-for-update");
    if (updateStatus !== "available" && updateStatus !== "downloading")
      setUpdateState("checking");
  });

  updater.on("update-available", (info) => {
    console.log("[auto-update] update-available:", info?.version);
    clearUpdateCheckWatchdog();
    updateReadyToInstall = false;
    updateDownloadPercent = null;
    lastFailedPhase = null;
    if (info?.version) updateAvailableVersion = String(info.version);
    setUpdateState("available", { version: updateAvailableVersion ?? undefined });
    // autoDownload is off: we only announce the update here. The download (and
    // its stall watchdog) starts when the user taps it, via downloadUpdate.
    // A manual check must always answer, even about a version announced
    // before; background checks announce each version once.
    if (manualUpdateCheckInFlight) {
      callbacks.sendNotify("Update available");
      lastNotifiedAvailableVersion = updateAvailableVersion;
    } else {
      notifyUpdateAvailable();
    }
    manualUpdateCheckInFlight = false;
  });

  updater.on("download-progress", (progress) => {
    const raw = typeof progress?.percent === "number" ? progress.percent : 0;
    updateDownloadPercent = Math.max(0, Math.min(100, Math.round(raw)));
    // Re-arm the stall watchdog on every chunk so it only fires on real stalls.
    startUpdateDownloadWatchdog();
    setUpdateState("downloading");
  });

  updater.on("update-not-available", () => {
    console.log("[auto-update] update-not-available");
    clearAllWatchdogs();
    updateDownloadPercent = null;
    lastFailedPhase = null;
    setUpdateState("not-available");
    if (manualUpdateCheckInFlight) callbacks.sendNotify("You're up to date.");
    manualUpdateCheckInFlight = false;
  });

  updater.on("error", (err: Error) => {
    clearAllWatchdogs();
    const failedDownload = downloadInFlight;
    downloadInFlight = false;
    quitAndInstallInvoked = false;
    lastFailedPhase = failedDownload ? "download" : "check";
    const msg = err?.message || String(err) || "Unknown updater error";
    // Log even on silent background checks. An invisible error here is exactly
    // what makes a stuck updater impossible to tell apart from "up to date".
    console.error("[auto-update] error:", msg);
    setUpdateState("error", { error: msg });
    // A download only ever starts from a user tap, so its failure always
    // deserves a notification. Check failures notify only on manual checks.
    if (failedDownload) callbacks.sendNotify(`Update download failed: ${msg}`);
    else if (manualUpdateCheckInFlight)
      callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  });

  updater.on("update-downloaded", (info) => {
    console.log("[auto-update] update-downloaded:", info?.version);
    clearAllWatchdogs();
    downloadInFlight = false;
    quitAndInstallInvoked = false;
    lastFailedPhase = null;
    if (info?.version) updateAvailableVersion = String(info.version);
    updateReadyToInstall = true;
    updateDownloadPercent = 100;
    setUpdateState("available");
    callbacks.sendNotify("Update ready. Restart to update");
    manualUpdateCheckInFlight = false;
  });

  return updater;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function manualCheckForUpdates(silent = false): Promise<void> {
  if (!app.isPackaged) {
    if (!silent)
      callbacks.sendNotify("Updates are only available in packaged builds.");
    return;
  }
  if (updateReadyToInstall) {
    if (!silent) callbacks.sendNotify("Update ready. Restart to update");
    return;
  }
  if (updateStatus === "available") {
    if (!silent) callbacks.sendNotify("Update available");
    return;
  }
  if (updateStatus === "downloading") {
    if (!silent) callbacks.sendNotify("Downloading update");
    return;
  }
  if (updateStatus === "checking") {
    if (!silent) callbacks.sendNotify("Already checking for updates");
    return;
  }

  let updater: ElectronUpdater;
  try {
    updater = await initUpdaterEventBridgeOnce();
  } catch (err: unknown) {
    const msg = getErrorMessage(err, "Could not load updater");
    setUpdateState("error", { error: msg });
    if (!silent) callbacks.sendNotify(`Update check failed: ${msg}`);
    return;
  }

  if (!ensureFeedConfigured(updater)) {
    setUpdateState("error", { error: "Could not configure update feed" });
    if (!silent) callbacks.sendNotify("Update check failed.");
    return;
  }

  try {
    updateDownloadPercent = null;
    setUpdateState("checking");
    manualUpdateCheckInFlight = !silent;
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

    // checkForUpdates drives the events wired above. autoDownload is off, so it
    // only finds the update; downloadUpdate starts the transfer later. We don't
    // need its return value; events are the source of truth. Errors surface via
    // the "error" event; the catch below is only a backstop for a
    // synchronous/rejecting throw with no event.
    await updater.checkForUpdates();
  } catch (err: unknown) {
    if (updateStatus === "error") return;
    clearAllWatchdogs();
    const msg = getErrorMessage(err, "Unknown updater error");
    setUpdateState("error", { error: msg });
    if (!silent) callbacks.sendNotify(`Update check failed: ${msg}`);
    manualUpdateCheckInFlight = false;
  }
}

// Start downloading the update the last check found. autoDownload is off, so
// this is the user-driven step behind the "available" capsule / tray tap. The
// download stall watchdog is armed here and re-armed on every progress chunk.
export function downloadUpdate(): void {
  if (!app.isPackaged) return;
  if (updateReadyToInstall) return;
  // A failed download leaves the checked update info cached in
  // electron-updater, so a retry can restart the transfer directly instead of
  // bouncing the user through another check.
  const resumableAfterError =
    updateStatus === "error" &&
    lastFailedPhase === "download" &&
    updateAvailableVersion != null;
  if (updateStatus !== "available" && !resumableAfterError) return;
  const updater = autoUpdater;
  if (!updater) return;

  const failDownload = (err: unknown) => {
    downloadInFlight = false;
    lastFailedPhase = "download";
    clearUpdateDownloadWatchdog();
    const msg = getErrorMessage(err, "Unknown updater error");
    setUpdateState("error", { error: msg });
    callbacks.sendNotify(`Update download failed: ${msg}`);
  };

  try {
    updateDownloadPercent = null;
    downloadInFlight = true;
    setUpdateState("downloading");
    startUpdateDownloadWatchdog();
    // electron-updater downloads the update info cached by the last check. On
    // failure it both emits "error" and rejects this promise; the rejection
    // handler is only the backstop for a failure that never emitted (the
    // in-flight flag keeps the two paths from double-reporting).
    Promise.resolve(updater.downloadUpdate()).catch((err: unknown) => {
      if (!downloadInFlight) return;
      failDownload(err);
    });
  } catch (err: unknown) {
    failDownload(err);
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
  updateAvailableVersion =
    next === "available" || next === "ready" || next === "downloading"
      ? `v${app.getVersion()}-dev`
      : null;
  lastNotifiedAvailableVersion =
    next === "available" ? updateAvailableVersion : null;
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

function quitAndInstallWithUpdater(updater: ElectronUpdater): void {
  // A second tap during the native handoff must not stack another install
  // attempt on top of the first.
  if (quitAndInstallInvoked) {
    console.log("[Updater] quitAndInstall already in progress; ignoring");
    return;
  }

  const onBeforeQuitForUpdate = () => {
    console.log("[Updater] before-quit-for-update received");
    clearUpdateInstallHandoffWatchdog();
    updateInstallHandoffListener = null;
  };

  try {
    console.log("[Updater] quitAndInstall invoked");
    // Listen before quitAndInstall() so a synchronous native event cannot be
    // missed. The event means the update quit sequence has started, not that
    // staging is complete.
    nativeSquirrelUpdater?.once?.(
      "before-quit-for-update",
      onBeforeQuitForUpdate,
    );
    updateInstallHandoffListener = onBeforeQuitForUpdate;
    quitAndInstallInvoked = true;
    startUpdateInstallHandoffWatchdog();

    // On macOS electron-updater hands the install to Squirrel.Mac through
    // Electron's native autoUpdater. Do not call app.quit() or app.exit() here:
    // native quitAndInstall() closes windows and quits the app itself, and an
    // early forced exit can kill the updater handoff.
    // isSilent=false (show the installer UX), isForceRunAfter=true (relaunch
    // the new build once installed instead of just quitting).
    updater.quitAndInstall(false, true);
  } catch (e) {
    quitAndInstallInvoked = false;
    clearUpdateInstallHandoffTracking();
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
}

export function quitAndInstallUpdate(): void {
  if (autoUpdater) {
    quitAndInstallWithUpdater(autoUpdater);
    return;
  }

  void loadAutoUpdater()
    .then((updater) => {
      if (!quitAndInstallInvoked) quitAndInstallWithUpdater(updater);
    })
    .catch((error) => {
      console.warn("[Updater] Failed to load updater:", error);
    });
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
