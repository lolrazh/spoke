import type { LocalTranscribeResult } from "../types/shared";
import { isPreferredProviderLocal } from "./providerStore";
import {
  getActiveModelId,
  getModelInstallState,
  installModel,
  removeModel,
  setActiveModelId,
} from "./modelManager";
import {
  isSidecarRunning,
  killSidecar,
  setAutoRestart,
  spawnSidecar,
  transcribeLocal,
} from "./sidecarEngine";
import { bootTimeline } from "./bootTimeline";

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
  bootTimeline.mark("sidecar-prewarm:start", { reason });
  prewarmInFlight = ensureLocalSidecarRunning()
    .then(() => {
      console.log(`[STT] Local sidecar prewarmed (${reason})`);
      bootTimeline.mark("sidecar-prewarm:ready", { reason });
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[STT] Local sidecar prewarm failed (${reason}): ${msg}`);
      bootTimeline.mark("sidecar-prewarm:failed", { reason, error: msg });
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

export async function installLocalModelAndSyncSidecar(
  modelId?: string,
): Promise<void> {
  await installModel(modelId);
  await syncLocalSidecarForCurrentProvider();
}

export async function removeLocalModelAndStopSidecar(
  modelId?: string,
): Promise<void> {
  // Only disturb the running sidecar if we're removing the active model.
  if (!modelId || modelId === getActiveModelId()) {
    stopLocalSidecar();
  }
  await removeModel(modelId);
}

/**
 * Switch the active model and restart the sidecar so the new family is loaded.
 * Prewarm only kicks in if the newly active model is installed and local
 * transcription is the preferred provider.
 */
export async function setActiveModelAndResync(modelId: string): Promise<void> {
  setActiveModelId(modelId);
  stopLocalSidecar();
  prewarmLocalSidecar("active-model-change");
}

export async function transcribeWithLocalSidecar(
  pcmBuffer: Buffer,
): Promise<LocalTranscribeResult> {
  await ensureLocalSidecarRunning();
  return transcribeLocal(pcmBuffer);
}
