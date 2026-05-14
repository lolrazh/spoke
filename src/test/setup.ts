// Minimal test environment shims for DOM, media, and Electron bridges
import { vi } from "vitest";

// Enable React 18 act() environment across the suite
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// MediaDevices shim
if (typeof globalThis.navigator === "undefined") {
  // @ts-ignore
  globalThis.navigator = {};
}
// @ts-ignore
if (!globalThis.navigator.mediaDevices) {
  // @ts-ignore
  globalThis.navigator.mediaDevices = {
    addEventListener: (_: string, __: any): void => {},
    removeEventListener: (_: string, __: any): void => {},
    enumerateDevices: async (): Promise<MediaDeviceInfo[]> => [],
    getUserMedia: async (_: MediaStreamConstraints) =>
      ({
        getTracks: (): Array<{ stop: () => undefined }> => [
          { stop: (): undefined => undefined },
        ],
      }) as unknown as MediaStream,
  } as any;
}

// Electron bridge shim (only what tests might touch indirectly)
// @ts-ignore
if (!globalThis.window) {
  // @ts-ignore
  globalThis.window = {};
}
// @ts-ignore
if (!globalThis.window.electron) {
  // @ts-ignore
  globalThis.window.electron = {
    getFloatingBarEnabled: async () => ({ enabled: true }),
    isFloatingBarVisible: async () => ({ visible: true }),
    checkPermissions: async () => ({
      needAX: false,
      needIM: false,
      isDev: true,
    }),
    checkMicrophonePermission: async () => ({
      status: "granted",
      granted: true,
    }),
    openSystemPreferences: async () => {},
  } as any;
}

// Clipboard shim
// @ts-ignore
if (!globalThis.window.clipboard) {
  // @ts-ignore
  globalThis.window.clipboard = {
    insertText: async (_text: string) => ({ success: true }),
  } as any;
}

// STT bridge shim
// @ts-ignore
if (!globalThis.window.stt) {
  // @ts-ignore
  globalThis.window.stt = {
    transcribeLocal: vi.fn(async () => ({ text: "", metrics: {} })),
    transcribeApiKeyProvider: vi.fn(async () => ({ text: "", metrics: {} })),
    getProviderSettings: vi.fn(async () => ({
      preferredProviderId: "local-stt",
      providers: [],
    })),
    getPreferredProvider: vi.fn(async () => "local-stt"),
    setPreferredProvider: vi.fn(async () => {}),
    setProviderApiKey: vi.fn(async () => ({
      preferredProviderId: "local-stt",
      providers: [],
    })),
    clearProviderApiKey: vi.fn(async () => ({
      preferredProviderId: "local-stt",
      providers: [],
    })),
    getModelStatus: vi.fn(async () => ({
      state: "not_installed",
      family: "whisper",
      modelId: "mlx-community/whisper-large-v3-turbo-4bit",
      displayName: "Whisper large-v3 turbo 4-bit",
      version: "0f058d38170d183f9fdee07908f5b515d91793a8",
      manifestVersion: 1,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 464_280_053,
      error: null,
    })),
    installModel: vi.fn(async () => {}),
    removeModel: vi.fn(async () => {}),
    onModelProgress: vi.fn(() => () => {}),
    enhance: vi.fn(async (payload: any) => ({
      text: payload.text,
      bypassed: true,
    })),
    extractOcr: vi.fn(async () => ({ words: [] })),
  } as any;
}

// Mic bridge shim used by utils/components
// @ts-ignore
if (!globalThis.window.mic) {
  let selected = "default";
  // @ts-ignore
  globalThis.window.mic = {
    updateDevices: (_d: any, _s?: string) => {},
    select: async (id: string) => {
      selected = id;
      return { ok: true };
    },
    getSelected: async () => ({ id: selected }),
    onSelectedChanged: (_cb: (p: { id: string }) => void) => {
      // return unsubscribe
      return (): undefined => undefined;
    },
    onRefreshRequest: (_cb: () => void) => (): undefined => undefined,
  } as any;
}

// Transcription history bridge shim
// @ts-ignore
if (!globalThis.window.transcriptions) {
  // @ts-ignore
  globalThis.window.transcriptions = {
    getAll: vi.fn(async () => []),
    save: vi.fn(
      async (payload: {
        text: string;
        timestamp: number;
        mode: "dictation" | "edit";
      }) => ({
        id: "test-transcription",
        ...payload,
      }),
    ),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => ({ ok: true })),
  } as any;
}

// Dev flags default
// @ts-ignore
if (!globalThis.window.devFlags) {
  // @ts-ignore
  globalThis.window.devFlags = {
    skipOnboarding: false,
    forceOnboarding: false,
    devConsoleLogs: false,
  };
}
