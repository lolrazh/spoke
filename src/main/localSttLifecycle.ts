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
  // Installing never activates by itself, but if the active model is unusable
  // (e.g. it was removed and the fallback landed on something not installed),
  // dictation would stay broken with a freshly ready model one click away.
  // Promote the just-installed model in that case; the stt:install-model
  // handler's scheduled prewarm then spawns the right family.
  if (
    modelId &&
    getModelInstallState() !== "ready" &&
    getModelInstallState(modelId) === "ready"
  ) {
    await setActiveModelAndResync(modelId);
  }
  await syncLocalSidecarForCurrentProvider();
}

export async function removeLocalModelAndStopSidecar(
  modelId?: string,
): Promise<void> {
  // Only disturb the running sidecar if we're removing the active model.
  const wasActive = !modelId || modelId === getActiveModelId();
  if (wasActive) {
    stopLocalSidecar();
  }
  await removeModel(modelId);
  // removeModel may auto-promote a different installed model to active when the
  // active one is uninstalled. If that newly active model is ready and local is
  // the preferred provider, prewarm it so transcription stays available without
  // a cold start. prewarmLocalSidecar self-guards on provider/ready/in-flight.
  if (wasActive && getModelInstallState() === "ready") {
    prewarmLocalSidecar("post-remove");
  }
}

/**
 * Switch the active model and restart the sidecar so the new family is loaded.
 *
 * We deliberately only stop the old sidecar here and do NOT prewarm — the
 * `stt:set-active-model` IPC handler schedules a single delayed prewarm. Doing
 * both an immediate prewarm here and a scheduled one in the handler briefly ran
 * two sidecars from different families at once, each holding GPU/MLX memory
 * while the old process worked through its SIGKILL grace period. Consolidating
 * to the single scheduled prewarm guarantees at most one sidecar at a time.
 */
export async function setActiveModelAndResync(modelId: string): Promise<void> {
  setActiveModelId(modelId);
  stopLocalSidecar();
}

export async function transcribeWithLocalSidecar(
  pcmBuffer: Buffer,
  prompt?: string,
): Promise<LocalTranscribeResult> {
  await ensureLocalSidecarRunning();
  return transcribeLocal(pcmBuffer, prompt);
}
