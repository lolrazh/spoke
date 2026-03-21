/**
 * Update Controller
 *
 * Manages update checking, state tracking, and user notification for
 * Electron auto-updates. Supports both electron-updater (primary) and
 * manifest-based fallback checking against RELEASES.json.
 */

import https from "node:https";
import { app } from "electron";

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
let manualUpdateCheckInFlight = false;
let pendingUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateBackoffMs: number | null = null;

let callbacks: UpdateCallbacks = {
  sendNotify: () => {},
  rebuildTrayMenu: () => {},
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

function getReleasesUrl(): string {
  return `https://download.spoke.so/darwin/${process.arch}/RELEASES.json`;
}

export function compareSemver(a: string, b: string): number {
  const pa = a
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10));
  const pb = b
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      https
        .get(url, (res) => {
          const { statusCode } = res;
          if (!statusCode || statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode} for ${url}`));
            res.resume();
            return;
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

function jitterMs(baseMs: number, pct = 0.2): number {
  const f = 1 + (Math.random() * 2 - 1) * pct;
  return Math.max(0, Math.round(baseMs * f));
}

// ── Updater event bridge ───────────────────────────────────────────────

function initUpdaterEventBridgeOnce() {
  if (updaterListenersInitialized) return;
  updaterListenersInitialized = true;
  try {
    const req: any = eval("require");
    const mod = req?.("electron-updater");
    const autoUpdater = mod?.autoUpdater as any;
    if (autoUpdater && typeof autoUpdater.on === "function") {
      autoUpdater.on("checking-for-update", () => {
        setUpdateState("checking");
      });
      autoUpdater.on("update-available", (info: any) => {
        const v = info?.version || info?.updateInfo?.version || null;
        updateReadyToInstall = false;
        setUpdateState("available", { version: v || undefined });
        if (v) callbacks.sendNotify(`Update found: v${v}. Downloading…`);
        else callbacks.sendNotify("Update found. Downloading…");
        manualUpdateCheckInFlight = false;
      });
      autoUpdater.on("update-not-available", () => {
        setUpdateState("not-available");
        if (manualUpdateCheckInFlight)
          callbacks.sendNotify("You're up to date.");
        manualUpdateCheckInFlight = false;
      });
      autoUpdater.on("error", (err: any) => {
        const msg =
          (err && (err.message || String(err))) || "Unknown updater error";
        setUpdateState("error", { error: msg });
        if (manualUpdateCheckInFlight)
          callbacks.sendNotify(`Update check failed: ${msg}`);
        manualUpdateCheckInFlight = false;
      });
      autoUpdater.on("download-progress", () => {
        setUpdateState("available");
      });
      autoUpdater.on("update-downloaded", (info: any) => {
        const v =
          info?.version || info?.updateInfo?.version || updateAvailableVersion;
        updateAvailableVersion = v ?? updateAvailableVersion;
        updateReadyToInstall = true;
        setUpdateState("available");
        callbacks.sendNotify("Update ready. Restart to install.");
        manualUpdateCheckInFlight = false;
      });
    }
  } catch {
    // electron-updater may not be directly resolvable
  }
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

  // Try to delegate to electron-updater if present
  try {
    const req: any = eval("require");
    const mod = req?.("electron-updater");
    const autoUpdater = mod?.autoUpdater as any;
    if (autoUpdater && typeof autoUpdater.checkForUpdates === "function") {
      setUpdateState("checking");
      manualUpdateCheckInFlight = !silent;
      if (!silent) callbacks.sendNotify("Checking for updates…");
      try {
        await autoUpdater.checkForUpdates();
        return;
      } catch (e: any) {
        console.warn(
          "[auto-update] Delegated check failed, falling back:",
          e?.message || e,
        );
      }
    }
  } catch {
    // fall back below
  }

  // Fallback: probe manifest directly
  try {
    setUpdateState("checking");
    const url = getReleasesUrl();
    const manifest = await fetchJson(url);
    let latest: string | null = null;
    if (manifest?.currentRelease) {
      latest = String(manifest.currentRelease);
    } else if (
      Array.isArray(manifest?.releases) &&
      manifest.releases.length > 0
    ) {
      latest =
        manifest.releases
          .map((r: any) => r?.version || r?.updateTo?.version)
          .filter(Boolean)
          .map(String)
          .sort((a: string, b: string) => compareSemver(a, b))
          .pop() || null;
    }
    const current = app.getVersion();
    if (latest && compareSemver(latest, current) > 0) {
      setUpdateState("available", { version: latest });
      if (!silent)
        callbacks.sendNotify(
          `Update available: v${latest}. It will download automatically.`,
        );
    } else {
      setUpdateState("not-available");
      if (!silent) callbacks.sendNotify("You're up to date.");
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    setUpdateState("error", { error: msg });
    if (!silent) callbacks.sendNotify(`Update check failed: ${msg}`);
  }
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
