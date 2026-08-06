import type { LocalTranscribeResult } from "../types/shared";
import { isPreferredProviderLocal } from "./providerStore";
import {
  getActiveModelId,
  getModelStatus,
  getModelInstallState,
  installModel,
  removeModel,
  setActiveModelId,
} from "./modelManager";
import {
  isSidecarRunning,
  abortLocalTranscription as abortSidecarTranscription,
  killSidecar,
  setAutoRestart,
  spawnSidecar,
  transcribeLocal,
} from "./sidecarEngine";
import { bootTimeline } from "./bootTimeline";
import { correctTranscript } from "./dictionaryCorrection";
import { getVocabularyDictionary } from "./vocabularyService";
import { state } from "./windowState";
import { buildSTTPrompt } from "../../shared/sttPrompt";

export const LOCAL_MODEL_NOT_INSTALLED_MESSAGE =
  "Local model not installed. Open Settings to install it.";

// The sidecar holds hundreds of MB resident for a menu-bar app that is idle
// most of the time. Stop it after a stretch of no dictation activity; a PTT
// key-down re-warms it so the user rarely feels the cold start.
export const SIDECAR_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let prewarmInFlight: Promise<void> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let transcriptionsInFlight = 0;

function buildWhisperPrompt(prompt?: string): string | undefined {
  if (getModelStatus().family !== "whisper") {
    return undefined;
  }

  const dictionary = getVocabularyDictionary();
  // Preserve the old no-metadata request when neither the caller nor the
  // dictionary has anything to add.
  if (!prompt && dictionary.length === 0) {
    return undefined;
  }

  return buildSTTPrompt({
    basePrompt: prompt,
    extraVocab: dictionary,
  });
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * (Re)arm the idle watchdog. Called on every real user-driven sidecar use
 * (prewarm on dictation intent, transcription request and completion) so the
 * countdown restarts on activity and only elapses during genuine idleness.
 */
function armIdleTimer(): void {
  clearIdleTimer();
  // Nothing to reclaim unless a sidecar is actually running.
  if (!isSidecarRunning()) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    // Belt-and-suspenders: never stop mid-transcription. The completion path
    // re-arms the timer, so a request in flight is not orphaned.
    if (transcriptionsInFlight > 0) return;
    if (!isSidecarRunning()) return;
    console.log("[STT] Stopping idle local sidecar after inactivity");
    // stopLocalSidecar disables auto-restart before killing, so the engine's
    // exit handler treats this as intentional and does not respawn.
    stopLocalSidecar();
  }, SIDECAR_IDLE_TIMEOUT_MS);
  // Must not keep the process alive at quit.
  idleTimer.unref?.();
}

export async function ensureLocalSidecarRunning(): Promise<void> {
  if (getModelInstallState() !== "ready") {
    throw new Error(LOCAL_MODEL_NOT_INSTALLED_MESSAGE);
  }

  if (!isSidecarRunning()) {
    await spawnSidecar();
  }

  setAutoRestart(true);
  armIdleTimer();
}

export function prewarmLocalSidecar(reason: string): void {
  if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
    return;
  }

  if (isSidecarRunning()) {
    setAutoRestart(true);
    // A fresh dictation intent resets the idle countdown.
    armIdleTimer();
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
  clearIdleTimer();
  setAutoRestart(false);
  killSidecar();
}

/** Cancel uses this instead of merely invalidating renderer state. */
export function abortLocalSidecarTranscription(): void {
  clearIdleTimer();
  abortSidecarTranscription();
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
  transcriptionsInFlight++;
  // Reset on request; if the timer somehow elapses mid-flight the in-flight
  // guard blocks the stop.
  armIdleTimer();
  try {
    const result = await transcribeLocal(
      pcmBuffer,
      buildWhisperPrompt(prompt),
    );
    const dictionary = state.appPreferences.vocabularyDictionary ?? [];
    return { ...result, text: correctTranscript(result.text, dictionary) };
  } finally {
    transcriptionsInFlight--;
    // Reset on completion so idle time is measured from the last activity.
    armIdleTimer();
  }
}
