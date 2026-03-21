/**
 * Preferences
 *
 * File-backed preference management for microphone, pill, and app settings.
 * Each preference set is stored as a JSON file in the user data directory.
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type {
  MicPreferences,
  PillPreferences,
  AppPreferences,
} from "../types/shared";
import { logger } from "../utils/logger";

// ── Internal state ─────────────────────────────────────────────────────

let micPrefsPath = "";
let pillPrefsPath = "";
let appPrefsPath = "";

// ── Initialization ─────────────────────────────────────────────────────

export function initPreferences(userDataDir: string): void {
  micPrefsPath = path.join(userDataDir, "mic-preferences.json");
  pillPrefsPath = path.join(userDataDir, "pill-preferences.json");
  appPrefsPath = path.join(userDataDir, "app-preferences.json");
}

// ── Generic helpers ────────────────────────────────────────────────────

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Microphone preferences ─────────────────────────────────────────────

export function loadMicPreferences(): MicPreferences {
  try {
    if (fs.existsSync(micPrefsPath)) {
      const data = fs.readFileSync(micPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      console.log("[MicPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    console.error("[MicPrefs] Failed to load preferences:", error);
  }

  const defaultPrefs = { selectedMicId: "default" };
  console.log("[MicPrefs] Using default preferences:", defaultPrefs);
  return defaultPrefs;
}

export function saveMicPreferences(prefs: MicPreferences): void {
  try {
    ensureDir(micPrefsPath);
    fs.writeFileSync(micPrefsPath, JSON.stringify(prefs, null, 2));
    console.log("[MicPrefs] Saved preferences:", prefs);
  } catch (error) {
    console.error("[MicPrefs] Failed to save preferences:", error);
  }
}

// ── Pill preferences ───────────────────────────────────────────────────

export function loadPillPreferences(): PillPreferences {
  try {
    if (fs.existsSync(pillPrefsPath)) {
      const data = fs.readFileSync(pillPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      logger.main.info("[PillPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    logger.main.error("[PillPrefs] Failed to load preferences:", error);
  }

  logger.main.info("[PillPrefs] No stored preferences found");
  return {};
}

export function savePillPreferences(prefs: PillPreferences): void {
  try {
    ensureDir(pillPrefsPath);
    fs.writeFileSync(pillPrefsPath, JSON.stringify(prefs, null, 2));
    logger.main.info("[PillPrefs] Saved preferences:", prefs);
  } catch (error) {
    logger.main.error("[PillPrefs] Failed to save preferences:", error);
  }
}

// ── App preferences ────────────────────────────────────────────────────

export function loadAppPreferences(): AppPreferences {
  try {
    if (fs.existsSync(appPrefsPath)) {
      const data = fs.readFileSync(appPrefsPath, "utf8");
      const prefs = JSON.parse(data);
      logger.main.info("[AppPrefs] Loaded preferences:", prefs);
      return prefs;
    }
  } catch (error) {
    logger.main.error("[AppPrefs] Failed to load preferences:", error);
  }

  logger.main.info("[AppPrefs] No stored preferences found");
  return {};
}

export function saveAppPreferences(prefs: AppPreferences): void {
  try {
    ensureDir(appPrefsPath);
    fs.writeFileSync(appPrefsPath, JSON.stringify(prefs, null, 2));
    logger.main.info("[AppPrefs] Saved preferences:", prefs);
  } catch (error) {
    logger.main.error("[AppPrefs] Failed to save preferences:", error);
  }
}
