/**
 * Window & App State
 *
 * Centralized mutable state for the pill/onboarding window references and a
 * handful of app-wide flags (PTT target, quitting flag, dock/notch tracking,
 * persisted preference blobs, etc). These values are read and written from
 * many places across the main process — window creation, the tray, and the
 * various IPC handler groups — so they live here as a single shared module
 * rather than as private `let` bindings inside main.ts. This lets the
 * decomposed modules (windows.ts, tray.ts, ipc/*.ts, fnListener.ts, ...)
 * import this state directly instead of importing main.ts back.
 */

import type { BrowserWindow } from "electron";
import type {
  PttTarget,
  PillPreferences,
  AppPreferences,
} from "../types/shared";

export interface OnboardingPrefs {
  done?: boolean;
  currentStep?: string;
}

export interface AppWindowState {
  mainWindow: BrowserWindow | null;
  onboardingWindow: BrowserWindow | null;
  isQuitting: boolean;
  pttTarget: PttTarget;
  activeDisplayId: number | null;
  dockOperationInProgress: boolean;
  lastTranscript: string;
  pillPreferences: PillPreferences;
  appPreferences: AppPreferences;
  mainWindowPostReadyWorkScheduled: boolean;
  installUpdateWhenReady: boolean;
  onboardingPrefsPath: string;
  onboardingPrefs: OnboardingPrefs;
}

export const state: AppWindowState = {
  mainWindow: null,
  onboardingWindow: null,
  isQuitting: false,
  pttTarget: "auto",
  activeDisplayId: null,
  dockOperationInProgress: false,
  lastTranscript: "",
  pillPreferences: {},
  appPreferences: {},
  mainWindowPostReadyWorkScheduled: false,
  installUpdateWhenReady: false,
  onboardingPrefsPath: "",
  onboardingPrefs: {},
};
