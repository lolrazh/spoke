/**
 * TypeScript declarations for the Electron API exposed to the renderer process
 */

import type {
  SelectionInspectSnapshot,
  ActiveDisplayPayload,
  TranscriptionItem,
  LocalTranscribeResult,
} from "./shared";
import type {
  ApiKeyTranscriptionProviderId,
  TranscriptionProviderSettingsSnapshot,
} from "../core/transcription/providerCatalog";
import type { PreferredTranscriptionProviderId } from "../core/transcription/providerPreferences";
import type {
  TranscriptionContext,
  TranscriptionResult,
} from "../core/transcription/sessionTypes";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "not-available"
  | "error";

interface UpdateSnapshot {
  status: UpdateStatus;
  version: string | null;
  readyToInstall: boolean;
  error: string | null;
  // 0..100 while downloading, 100 when ready, null otherwise.
  downloadPercent: number | null;
}

declare global {
  interface Window {
    /** Safari/WebKit fallback for AudioContext */
    webkitAudioContext?: typeof AudioContext;
    app: {
      getVersion: () => Promise<string>;
    };
    update: {
      getState: () => Promise<UpdateSnapshot>;
      check: () => Promise<UpdateSnapshot>;
      restart: () => Promise<{ ok: boolean }>;
      installWhenReady: () => Promise<{
        ok: boolean;
        snapshot: UpdateSnapshot;
      }>;
      devSetState?: (state: UpdateStatus | "ready") => Promise<{
        ok: boolean;
        snapshot: UpdateSnapshot;
        error?: string;
      }>;
      onStateChanged: (cb: (snapshot: UpdateSnapshot) => void) => () => void;
    };
    devFlags: {
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
      writeText: (text: string) => Promise<{ ok: boolean; error?: string }>;
    };
    selection: {
      inspect: (options?: {
        contextChars?: number;
      }) => Promise<SelectionInspectSnapshot>;
    };
    notifications: {
      send: (message: string, actionId?: string | null) => void;
      on: (
        callback: (payload: {
          message: string;
          actionId: string | null;
        }) => void,
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
      expandPill: (callback: () => void) => () => void;
      onPasteShortcutPressed: (callback: () => void) => () => void;
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
      requestScreenRecordingPermission: () => Promise<{
        success: boolean;
        granted?: boolean;
        error?: string;
      }>;
      checkScreenRecordingPermission: () => Promise<{
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
      resetOnboardingFlag: () => Promise<{ ok: boolean }>;
      getOnboardingStep: () => Promise<string | null>;
      setOnboardingStep: (step: string) => Promise<{ ok: boolean }>;
      getAppPath: () => Promise<string>;
      // Permission lifecycle helpers
      postPermissionGrant?: (
        type: "accessibility" | "microphone",
      ) => Promise<void> | void;
      // Window controls
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
      setDockVisible: (
        visible: boolean,
      ) => Promise<{ ok: boolean; error?: string }>;
      // Auto-space helpers (trailing space after inserted dictation)
      getAutoSpaceEnabled: () => Promise<{ enabled: boolean }>;
      setAutoSpaceEnabled: (
        enabled: boolean,
      ) => Promise<{ ok: boolean; error?: string }>;
      // Vocabulary dictionary (words/phrases used to correct transcripts)
      getVocabularyDictionary: () => Promise<{ dictionary: string[] }>;
      addVocabularyEntry: (value: string) => Promise<{
        ok: boolean;
        dictionary: string[];
        error?: string;
      }>;
      updateVocabularyEntry: (
        currentValue: string,
        nextValue: string,
      ) => Promise<{ ok: boolean; dictionary: string[]; error?: string }>;
      removeVocabularyEntry: (value: string) => Promise<{
        ok: boolean;
        dictionary: string[];
        error?: string;
      }>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      // Renderer lifecycle
      rendererReady: () => void;
      bootMark?: (label: string) => void;
      // Screenshot capture (Phase 1 OCR)
      takeScreenshot: (options?: {
        display?: "active" | number;
        quality?: number;
        maxDimension?: number;
      }) => Promise<{
        success: boolean;
        imageBase64?: string;
        captureTimeMs?: number;
        sizeKb?: number;
        displayId?: number;
        displayBounds?: { x: number; y: number; width: number; height: number };
        error?: string;
      }>;
      testScreenshot: () => Promise<{
        success: boolean;
        metrics?: {
          captureTimeMs: number;
          sizeKb: number;
          displayId: number;
          resolution: string;
        };
        error?: string;
      }>;
    };
    /** Receive active display information and computed UI scale from main */
    onActiveDisplay?: (
      cb: (payload: ActiveDisplayPayload) => void,
    ) => () => void;
    stt: {
      transcribeLocal: (
        pcmBuffer: ArrayBuffer,
        prompt?: string,
      ) => Promise<LocalTranscribeResult>;
      cancelLocalTranscription: () => Promise<void>;
      transcribeApiKeyProvider: (
        providerId: ApiKeyTranscriptionProviderId,
        payload: {
          audioBuffer: ArrayBuffer;
          mimeType?: string;
          context: TranscriptionContext;
        },
      ) => Promise<TranscriptionResult>;
      getProviderSettings: () => Promise<TranscriptionProviderSettingsSnapshot>;
      getPreferredProvider: () => Promise<PreferredTranscriptionProviderId>;
      setPreferredProvider: (
        providerId: PreferredTranscriptionProviderId,
      ) => Promise<void>;
      setProviderApiKey: (
        providerId: ApiKeyTranscriptionProviderId,
        apiKey: string,
      ) => Promise<TranscriptionProviderSettingsSnapshot>;
      clearProviderApiKey: (
        providerId: ApiKeyTranscriptionProviderId,
      ) => Promise<TranscriptionProviderSettingsSnapshot>;
      getModelStatus: () => Promise<import("./shared").ModelStatus>;
      getModelStatuses: () => Promise<import("./shared").ModelStatus[]>;
      getModelInfos: () => Promise<import("./shared").LocalModelInfo[]>;
      getActiveModel: () => Promise<string>;
      setActiveModel: (modelId: string) => Promise<void>;
      installModel: (modelId?: string) => Promise<void>;
      removeModel: (modelId?: string) => Promise<void>;
      cancelInstall: (modelId?: string) => Promise<void>;
      prewarmLocal: () => Promise<{ ok: boolean }>;
      onModelProgress: (
        cb: (payload: {
          modelId: string;
          progress: number;
          downloadedBytes: number;
          totalBytes: number;
        }) => void,
      ) => () => void;
      enhance: (payload: {
        text: string;
        vocabulary?: string[];
        mode?: "dictation" | "edit";
        selectionText?: string;
      }) => Promise<{
        text: string;
        bypassed: boolean;
        tier?: string;
        provider?: string;
        model?: string;
      }>;
      extractOcr: (imageBase64: string) => Promise<{ words: string[] }>;
    };
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
    audioCapture?: {
      isAvailable: () => Promise<boolean>;
      listDevices: () => Promise<Array<{ id: string; label: string }>>;
      start: () => Promise<{ ok: boolean }>;
      stop: () => Promise<{ ok: boolean }>;
      cancel: () => Promise<{ ok: boolean }>;
      onFrame: (cb: (payload: Uint8Array) => void) => () => void;
      onStopped: (cb: () => void) => () => void;
      onError: (cb: (message: string) => void) => () => void;
    };
    transcriptions: {
      getAll: () => Promise<TranscriptionItem[]>;
      save: (payload: {
        text: string;
        timestamp: number;
        mode: "dictation" | "edit";
      }) => Promise<TranscriptionItem>;
      delete: (id: string) => Promise<boolean>;
      clear: () => Promise<{ ok: boolean }>;
    };
  }
}

export {};
