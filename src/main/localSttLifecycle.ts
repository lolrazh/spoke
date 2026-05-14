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

export async function ensureLocalSidecarRunning(): Promise<void> {
  if (getModelInstallState() !== "ready") {
    throw new Error(LOCAL_MODEL_NOT_INSTALLED_MESSAGE);
  }

  if (!isSidecarRunning()) {
    await spawnSidecar();
  }

  setAutoRestart(true);
}

export function stopLocalSidecar(): void {
  setAutoRestart(false);
  killSidecar();
}

export async function syncLocalSidecarForCurrentProvider(): Promise<void> {
  if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
    stopLocalSidecar();
    return;
  }

  await ensureLocalSidecarRunning();
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
