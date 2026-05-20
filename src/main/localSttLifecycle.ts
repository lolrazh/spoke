import type { LocalTranscribeResult } from "../types/shared";
import { isPreferredProviderLocal } from "./providerStore";
import {
  getModelInstallState,
  installModel,
  removeModel,
} from "./modelManager";
import {
  isSidecarRunning,
  killSidecar,
  setAutoRestart,
  spawnSidecar,
  transcribeLocal,
} from "./sidecarEngine";

export const LOCAL_MODEL_NOT_INSTALLED_MESSAGE =
  "Local model not installed. Open Settings to install it.";

let prewarmInFlight: Promise<void> | null = null;

export async function ensureLocalSidecarRunning(): Promise<void> {
  if (getModelInstallState() !== "ready") {
    throw new Error(LOCAL_MODEL_NOT_INSTALLED_MESSAGE);
  }

  if (!isSidecarRunning()) {
    await spawnSidecar();
  }

  setAutoRestart(true);
}

export function prewarmLocalSidecar(reason: string): void {
  if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
    return;
  }

  if (isSidecarRunning()) {
    setAutoRestart(true);
    return;
  }

  if (prewarmInFlight) {
    return;
  }

  console.log(`[STT] Prewarming local sidecar (${reason})`);
  prewarmInFlight = ensureLocalSidecarRunning()
    .then(() => {
      console.log(`[STT] Local sidecar prewarmed (${reason})`);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[STT] Local sidecar prewarm failed (${reason}): ${msg}`);
    })
    .finally(() => {
      prewarmInFlight = null;
    });
}

export function stopLocalSidecar(): void {
  setAutoRestart(false);
  killSidecar();
}

export async function syncLocalSidecarForCurrentProvider(): Promise<void> {
  if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
    stopLocalSidecar();
  }
}

export async function installLocalModelAndSyncSidecar(): Promise<void> {
  await installModel();
  await syncLocalSidecarForCurrentProvider();
}

export async function removeLocalModelAndStopSidecar(): Promise<void> {
  stopLocalSidecar();
  await removeModel();
}

export async function transcribeWithLocalSidecar(
  pcmBuffer: Buffer,
): Promise<LocalTranscribeResult> {
  await ensureLocalSidecarRunning();
  return transcribeLocal(pcmBuffer);
}
