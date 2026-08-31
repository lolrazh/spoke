/**
 * Notch Reporter
 *
 * Spawns the native notch-reporter binary to detect MacBook notch dimensions
 * across all connected displays. Sanitizes the raw JSON output into typed
 * DisplayNotchInfo structures.
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { promisify } from "util";
import { execFile } from "child_process";
import type { DisplayNotchInfo } from "../types/shared";
import { logger } from "../utils/logger";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export type NotchReport = {
  timestamp: number;
  screens: DisplayNotchInfo[];
};

type NotchRawRect = {
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
};

type NotchRawEdgeInsets = {
  top: unknown;
  left: unknown;
  bottom: unknown;
  right: unknown;
};

type NotchRawScreen = {
  id: unknown;
  isBuiltIn: unknown;
  hasNotch: unknown;
  notchWidth: unknown;
  notchCenterX: unknown;
  menuBarHeight: unknown;
  frame: NotchRawRect;
  visibleFrame: NotchRawRect;
  safeAreaInsets: NotchRawEdgeInsets;
  auxiliaryLeft: NotchRawRect | null;
  auxiliaryRight: NotchRawRect | null;
  scaleFactor: unknown;
};

type NotchRawReport = {
  timestamp: unknown;
  screens: unknown;
};

// ── Sanitization ───────────────────────────────────────────────────────

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeRect(raw: NotchRawRect | null | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const x = toNumber(raw.x, 0);
  const y = toNumber(raw.y, 0);
  const width = toNumber(raw.width, 0);
  const height = toNumber(raw.height, 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x, y, width, height };
}

function sanitizeEdgeInsets(raw: NotchRawEdgeInsets | null | undefined): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  if (!raw || typeof raw !== "object") {
    return { top: 0, left: 0, bottom: 0, right: 0 };
  }
  return {
    top: toNumber(raw.top, 0),
    left: toNumber(raw.left, 0),
    bottom: toNumber(raw.bottom, 0),
    right: toNumber(raw.right, 0),
  };
}

function sanitizeScreen(
  raw: NotchRawScreen,
  timestamp: number,
): DisplayNotchInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const id = Math.trunc(toNumber(raw.id, -1));
  if (id < 0) return null;

  const frame = sanitizeRect(raw.frame);
  const visibleFrame = sanitizeRect(raw.visibleFrame);
  if (!frame || !visibleFrame) return null;

  const safeAreaInsets = sanitizeEdgeInsets(raw.safeAreaInsets);
  const auxiliaryLeft = sanitizeRect(raw.auxiliaryLeft ?? null);
  const auxiliaryRight = sanitizeRect(raw.auxiliaryRight ?? null);

  return {
    id,
    isBuiltIn: Boolean(raw.isBuiltIn),
    hasNotch: Boolean(raw.hasNotch),
    notchWidth: toNumber(raw.notchWidth, 0),
    notchCenterX: toNumber(raw.notchCenterX, frame.x + frame.width / 2),
    menuBarHeight: toNumber(raw.menuBarHeight, 0),
    frame,
    visibleFrame,
    safeAreaInsets,
    auxiliaryLeft,
    auxiliaryRight,
    scaleFactor: toNumber(raw.scaleFactor, 1),
    timestamp,
  };
}

function sanitizeNotchReport(
  raw: NotchRawReport | null | undefined,
): NotchReport | null {
  if (!raw || typeof raw !== "object") return null;
  const timestamp = toNumber(raw.timestamp, Date.now() / 1000);
  const screensRaw = Array.isArray(raw.screens)
    ? (raw.screens as NotchRawScreen[])
    : [];
  const screens: DisplayNotchInfo[] = [];
  for (const item of screensRaw) {
    const screen = sanitizeScreen(item, timestamp);
    if (screen) screens.push(screen);
  }
  return { timestamp, screens };
}

export function cloneDisplayNotchInfo(
  info: DisplayNotchInfo,
): DisplayNotchInfo {
  return {
    ...info,
    frame: { ...info.frame },
    visibleFrame: { ...info.visibleFrame },
    safeAreaInsets: { ...info.safeAreaInsets },
    auxiliaryLeft: info.auxiliaryLeft ? { ...info.auxiliaryLeft } : null,
    auxiliaryRight: info.auxiliaryRight ? { ...info.auxiliaryRight } : null,
  };
}

// ── Path resolution ────────────────────────────────────────────────────

function getNotchReporterPath(): string {
  if (process.platform !== "darwin") return "";
  return app.isPackaged
    ? path.join(process.resourcesPath, "notch-reporter")
    : path.join(app.getAppPath(), "native", "bin", "notch-reporter");
}

// ── Reporter execution ─────────────────────────────────────────────────

let notchReport: NotchReport | null = null;
let notchReporterMissingWarned = false;

export function getNotchReport(): NotchReport | null {
  return notchReport;
}

export function getNotchInfoForDisplay(
  displayId: number,
): DisplayNotchInfo | null {
  if (!notchReport) return null;
  return notchReport.screens.find((s) => s.id === displayId) ?? null;
}

export async function refreshNotchInfo(reason: string): Promise<void> {
  if (process.platform !== "darwin") {
    notchReport = null;
    return;
  }
  const reporterPath = getNotchReporterPath();
  if (!reporterPath || !fs.existsSync(reporterPath)) {
    if (!notchReporterMissingWarned) {
      logger.main.warn(`[Notch] Reporter binary missing at ${reporterPath}`);
      notchReporterMissingWarned = true;
    }
    notchReport = null;
    return;
  }

  try {
    const { stdout } = await execFileAsync(reporterPath, [], {
      timeout: 2000,
      maxBuffer: 512 * 1024,
    });
    const raw =
      typeof stdout === "string" ? stdout : (stdout as Buffer).toString("utf8");
    const parsed = sanitizeNotchReport(JSON.parse(raw) as NotchRawReport);
    notchReport = parsed;
    notchReporterMissingWarned = false;
    const summary = parsed
      ? parsed.screens
          .map((screen) => {
            const width =
              screen.hasNotch &&
              screen.notchWidth > 0 &&
              Number.isFinite(screen.notchWidth)
                ? `${screen.notchWidth.toFixed(2)}px`
                : "no-notch";
            return `id=${screen.id}:${width}`;
          })
          .join(", ")
      : null;
    logger.main.info(
      `[Notch] refresh ${reason}: ${summary && summary.length > 0 ? summary : "no valid screens"}`,
    );
  } catch (err) {
    logger.main.warn(
      `[Notch] Failed to refresh notch info (${reason}): ${String(err)}`,
    );
  }
}
