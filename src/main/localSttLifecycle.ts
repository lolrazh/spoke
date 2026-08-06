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
  getSidecarModelId,
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

let idleTimer: NodeJS.Timeout | null = null;
let transcriptionsInFlight = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();
const transcriptionDrainWaiters = new Set<() => void>();

function buildWhisperPrompt(
  modelId: string,
  prompt?: string,
): string | undefined {
  if (getModelStatus(modelId).family !== "whisper") {
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

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const queued = lifecycleQueue.then(operation, operation);
  lifecycleQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function waitForTranscriptionsToDrain(): Promise<void> {
  if (transcriptionsInFlight === 0) return Promise.resolve();
  return new Promise((resolve) => transcriptionDrainWaiters.add(resolve));
}

function releaseTranscriptionLease(): void {
  transcriptionsInFlight = Math.max(0, transcriptionsInFlight - 1);
  if (transcriptionsInFlight !== 0) return;
  for (const resolve of transcriptionDrainWaiters) resolve();
  transcriptionDrainWaiters.clear();
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
    void stopLocalSidecar();
  }, SIDECAR_IDLE_TIMEOUT_MS);
  // Must not keep the process alive at quit.
  idleTimer.unref?.();
}

async function ensureLocalSidecarRunningOnce(modelId: string): Promise<void> {
  if (getModelInstallState() !== "ready") {
    throw new Error(LOCAL_MODEL_NOT_INSTALLED_MESSAGE);
  }

  if (isSidecarRunning() && getSidecarModelId() !== modelId) {
    setAutoRestart(false);
    await killSidecar();
  }

  if (!isSidecarRunning()) {
    await spawnSidecar(modelId);
  }

  setAutoRestart(true);
  armIdleTimer();
}

export async function ensureLocalSidecarRunning(): Promise<void> {
  await enqueueLifecycle(() =>
    ensureLocalSidecarRunningOnce(getActiveModelId()),
  );
}

export function prewarmLocalSidecar(reason: string): void {
  void enqueueLifecycle(async () => {
    if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
      return;
    }

    if (!isSidecarRunning()) {
      console.log(`[STT] Prewarming local sidecar (${reason})`);
      bootTimeline.mark("sidecar-prewarm:start", { reason });
    }
    try {
      await ensureLocalSidecarRunningOnce(getActiveModelId());
      console.log(`[STT] Local sidecar prewarmed (${reason})`);
      bootTimeline.mark("sidecar-prewarm:ready", { reason });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[STT] Local sidecar prewarm failed (${reason}): ${msg}`);
      bootTimeline.mark("sidecar-prewarm:failed", { reason, error: msg });
    }
  });
}

export function stopLocalSidecar(): Promise<void> {
  clearIdleTimer();
  setAutoRestart(false);
  return enqueueLifecycle(async () => {
    await waitForTranscriptionsToDrain();
    await killSidecar();
  });
}

/** Cancel uses this instead of merely invalidating renderer state. */
export function abortLocalSidecarTranscription(): void {
  clearIdleTimer();
  abortSidecarTranscription();
}

export async function syncLocalSidecarForCurrentProvider(): Promise<void> {
  if (!isPreferredProviderLocal() || getModelInstallState() !== "ready") {
    await stopLocalSidecar();
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
    await stopLocalSidecar();
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
 * The whole transition is serialized: an active request drains, the old PID
 * exits, and only the latest selected model is then allowed to start. This
 * avoids both transient double-model residency and the stale-prewarm race that
 * could leave no sidecar running after a rapid switch.
 */
export async function setActiveModelAndResync(modelId: string): Promise<void> {
  setActiveModelId(modelId);
  clearIdleTimer();
  setAutoRestart(false);
  await enqueueLifecycle(async () => {
    await waitForTranscriptionsToDrain();
    // A later click superseded this transition while it waited in the queue.
    if (getActiveModelId() !== modelId) return;
    await killSidecar();
    if (
      getActiveModelId() === modelId &&
      isPreferredProviderLocal() &&
      getModelInstallState(modelId) === "ready"
    ) {
      await ensureLocalSidecarRunningOnce(modelId);
    }
  });
}

export async function transcribeWithLocalSidecar(
  pcmBuffer: Buffer,
  prompt?: string,
): Promise<LocalTranscribeResult> {
  const modelId = await enqueueLifecycle(async () => {
    const activeModelId = getActiveModelId();
    await ensureLocalSidecarRunningOnce(activeModelId);
    transcriptionsInFlight++;
    return activeModelId;
  });
  // Reset on request; if the timer somehow elapses mid-flight the in-flight
  // guard blocks the stop.
  armIdleTimer();
  try {
    const result = await transcribeLocal(
      pcmBuffer,
      buildWhisperPrompt(modelId, prompt),
    );
    const dictionary = state.appPreferences.vocabularyDictionary ?? [];
    return { ...result, text: correctTranscript(result.text, dictionary) };
  } finally {
    releaseTranscriptionLease();
    // Reset on completion so idle time is measured from the last activity.
    armIdleTimer();
  }
}
