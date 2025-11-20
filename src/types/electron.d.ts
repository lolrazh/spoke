/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

import type { SelectionInspectSnapshot, ActiveDisplayPayload, TranscriptionItem } from "./shared";

declare global {
  interface Window {
    /** Safari/WebKit fallback for AudioContext */
    webkitAudioContext?: typeof AudioContext;
    app: {
      getVersion: () => Promise<string>;
    };
    devFlags: {
      skipAuth: boolean;
      skipOnboarding: boolean;
      forceOnboarding: boolean;
      devConsoleLogs: boolean;
    };
    contextMenu: {
      showPill: () => void;
    };
    transcript: {
      update: (text: string) => void;
      subscribe: (cb: (text: string) => void) => () => void;
    };
    clipboard: {
      insertText: (
        text: string,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    selection: {
      inspect: (options?: { contextChars?: number }) => Promise<SelectionInspectSnapshot>;
    };
    notifications: {
      send: (message: string, actionId?: string | null) => void;
      on: (
        callback: (payload: { message: string; actionId: string | null }) => void,
      ) => () => void;
    };
    ptt: {
      onDown: (cb: () => void) => () => void;
      onUp: (cb: () => void) => () => void;
      onReady: (cb: () => void) => () => void;
      onCancelDown: (cb: () => void) => () => void;
      onCancel: (cb: () => void) => () => void;
    };
    island: {
      slideTo: (y: number) => void;
    };
    electron: {
      setClickThrough: (clickThrough: boolean) => void;
      setFocusable: (focusable: boolean) => void;
      focusWindow: () => void;
      expandPill: (callback: () => void) => void;
      requestExpandPill: () => Promise<{ ok: boolean }>;
      revealPill: () => Promise<{ ok: boolean }>;
      revealPillForTest?: () => Promise<{ ok: boolean }>;
      checkPermissions: () => Promise<{
        needAX: boolean;
        needIM: boolean;
        isDev: boolean;
      }>;
      requestAccessibilityPermission: () => Promise<void>;
      requestInputMonitoringPermission: () => Promise<{
        success: boolean;
        isDev: boolean;
        alreadyGranted?: boolean;
        error?: string;
      }>;
      askIM: () => Promise<{
        success: boolean;
        status?: string;
        isDev: boolean;
        error?: string;
      }>;
      requestMicrophonePermission: () => Promise<{
        success: boolean;
        granted?: boolean;
        error?: string;
      }>;
      checkMicrophonePermission: () => Promise<{
        status: string;
        granted: boolean;
      }>;
      openSystemPreferences: (pane: string) => Promise<void>;
      startHelper: () => Promise<void>;
      preparePill: () => Promise<{ success: boolean; error?: string } | void>;
      setPttTarget: (
        target: "auto" | "onboarding" | "main",
      ) => Promise<{ success: boolean }>;
      reloadApp: () => void;
      onboardingComplete: () => Promise<void>;
      getAppPath: () => Promise<string>;
      // Permission lifecycle helpers
      postPermissionGrant?: (
        type: "accessibility" | "microphone",
      ) => Promise<void> | void;
      // Window controls
      showOnboarding: () => Promise<{ ok: boolean }>;
      closeOnboarding: () => Promise<void>;
      minimizeOnboarding: () => Promise<void>;
      maximizeOnboarding: () => Promise<void>;
      // Floating bar visibility helpers
      isFloatingBarVisible: () => Promise<{ visible: boolean }>;
      getFloatingBarEnabled: () => Promise<{ enabled: boolean }>;
      hideFloatingBarIndefinitely: () => Promise<{
        ok: boolean;
        error?: string;
      }>;
      showFloatingBar: () => Promise<{ ok: boolean; error?: string }>;
      // Dock visibility helpers (macOS only)
      getDockVisible: () => Promise<{ visible: boolean }>;
      setDockVisible: (visible: boolean) => Promise<{ ok: boolean; error?: string }>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      getAuthRedirectUrl: () => Promise<{ url: string }>;
      // Renderer lifecycle
      rendererReady: () => void;
      // Auth helpers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke?: (channel: string, ...args: any[]) => Promise<unknown>;
    };
    /** Receive active display information and computed UI scale from main */
    onActiveDisplay?: (cb: (payload: ActiveDisplayPayload) => void) => void;
    mic: {
      updateDevices: (
        devices: Array<{ id: string; label: string }>,
        selectedId?: string,
      ) => void;
      select: (id: string) => Promise<{ ok: boolean }>;
      getSelected: () => Promise<{ id: string }>;
      onSelectedChanged: (cb: (payload: { id: string }) => void) => () => void;
      onRefreshRequest: (cb: () => void) => () => void;
    };
    auth: {
      onCallback: (cb: (payload: { url: string }) => void) => () => void;
    };
    transcriptions: {
      getAll: () => Promise<TranscriptionItem[]>;
      save: (payload: { text: string; timestamp: number; mode: "dictation" | "edit" }) => Promise<TranscriptionItem>;
      delete: (id: string) => Promise<boolean>;
      clear: () => Promise<{ ok: boolean }>;
    };
  }
}

export {};
