import {
  DEFAULT_MICROPHONE,
  discoverMicrophoneDevices,
  type MicrophoneDevice,
} from "../utils/microphoneDevices";
import {
  SettingsPanelChunk,
  SfIconChunk,
  TranscriptionHistoryViewChunk,
} from "../components/panelChunks";
import { initTranscriptionHistory } from "./transcriptionHistory";

/**
 * Everything the settings panel needs for a correct first frame. Loaded once
 * at idle after boot and refreshed whenever the panel mounts, so opening the
 * panel never waits on the bridge and never paints placeholder values.
 */
export type SettingsSnapshot = {
  appVersion: string;
  showFloatingBar: boolean;
  showInDock: boolean;
  autoSpace: boolean;
};

export type MicSnapshot = {
  devices: MicrophoneDevice[];
  selectedId: string;
};

let settingsSnapshot: SettingsSnapshot | null = null;
let micSnapshot: MicSnapshot | null = null;
let prefetchPromise: Promise<void> | null = null;

export function getSettingsSnapshot(): SettingsSnapshot | null {
  return settingsSnapshot;
}

export function getMicSnapshot(): MicSnapshot | null {
  return micSnapshot;
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  const [appVersion, showFloatingBar, showInDock, autoSpace] =
    await Promise.all([
      window.app?.getVersion?.().then(
        (value) => (typeof value === "string" ? value : ""),
        () => "",
      ) ?? "",
      (async () => {
        try {
          // Prefer persisted intent if available; fallback to current visibility.
          const pref = await window.electron?.getFloatingBarEnabled?.();
          if (pref && typeof pref.enabled === "boolean") return pref.enabled;
          const vis = await window.electron?.isFloatingBarVisible?.();
          return vis && typeof vis.visible === "boolean" ? vis.visible : true;
        } catch {
          return true;
        }
      })(),
      (async () => {
        try {
          const result = await window.electron?.getDockVisible?.();
          return result && typeof result.visible === "boolean"
            ? result.visible
            : true;
        } catch {
          return true;
        }
      })(),
      (async () => {
        try {
          const result = await window.electron?.getAutoSpaceEnabled?.();
          return result && typeof result.enabled === "boolean"
            ? result.enabled
            : true;
        } catch {
          return true;
        }
      })(),
    ]);
  settingsSnapshot = { appVersion, showFloatingBar, showInDock, autoSpace };
  return settingsSnapshot;
}

export async function loadMicSnapshot(): Promise<MicSnapshot> {
  const [devices, selectedId] = await Promise.all([
    discoverMicrophoneDevices().catch(() => [DEFAULT_MICROPHONE]),
    window.mic
      ?.getSelected?.()
      .then((res) => (res?.id ? res.id : DEFAULT_MICROPHONE.id))
      .catch(() => DEFAULT_MICROPHONE.id) ?? DEFAULT_MICROPHONE.id,
  ]);
  micSnapshot = { devices, selectedId };
  return micSnapshot;
}

/**
 * Pull the panel's code and data into memory so a later double-click renders
 * synchronously, without a chunk read, a Suspense frame, or a bridge wait.
 */
export function prefetchPanel(): Promise<void> {
  if (prefetchPromise) return prefetchPromise;
  prefetchPromise = Promise.all([
    SettingsPanelChunk.preload(),
    TranscriptionHistoryViewChunk.preload(),
    SfIconChunk.preload(),
    loadSettingsSnapshot(),
    loadMicSnapshot(),
    initTranscriptionHistory(),
  ]).then(
    () => undefined,
    (error) => {
      // A failed prefetch must not poison later opens; they load on demand.
      prefetchPromise = null;
      console.warn("[PanelPrefetch] Failed:", error);
    },
  );
  return prefetchPromise;
}

/** Prefetch once the renderer is idle after boot; never on the boot path. */
export function schedulePanelPrefetch(): () => void {
  const run = () => void prefetchPanel();
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 1500 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, 500);
  return () => clearTimeout(timer);
}
