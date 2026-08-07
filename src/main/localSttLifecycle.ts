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
let latestRequestedModelId: string | null = null;
let prewarmGeneration = 0;
let activePrewarm: {
  generation: number;
  cancelled: boolean;
  stopPromise: Promise<void> | null;
} | null = null;
const transcriptionDrainWaiters = new Set<() => void>();

function logSidecarShutdownFailure(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[STT] ${context}: ${message}`);
}

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

/**
 * Invalidate a prewarm before a model transition enters the lifecycle queue.
 *
 * A prewarm can be waiting inside spawnSidecar() for the full startup timeout.
 * Merely enqueueing the model transition behind it would first load the old
 * model, then tear it down, and only then load the selected model. If startup
 * is already in progress, stop it now; the transition waits for that stop
 * before it is allowed to start a replacement.
 */
function cancelPendingPrewarm(): Promise<void> {
  prewarmGeneration += 1;
  const task = activePrewarm;
  if (!task) return Promise.resolve();

  task.cancelled = true;
  if (!task.stopPromise) {
    task.stopPromise = waitForTranscriptionsToDrain().then(() => killSidecar());
  }
  return task.stopPromise;
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
    void stopLocalSidecar().catch((error) =>
      logSidecarShutdownFailure("Idle sidecar shutdown failed", error),
    );
  }, SIDECAR_IDLE_TIMEOUT_MS);
  // Must not keep the process alive at quit.
  idleTimer.unref?.();
}

async function ensureLocalSidecarRunningOnce(modelId: string): Promise<void> {
  if (getModelInstallState(modelId) !== "ready") {
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
  const generation = prewarmGeneration;
  void enqueueLifecycle(async () => {
    if (generation !== prewarmGeneration) return;

    const modelId = getActiveModelId();
    if (
      !isPreferredProviderLocal() ||
      getModelInstallState(modelId) !== "ready"
    ) {
      return;
    }

    const task = {
      generation,
      cancelled: false,
      stopPromise: null as Promise<void> | null,
    };
    activePrewarm = task;
    try {
      if (task.cancelled || generation !== prewarmGeneration) return;
      if (!isSidecarRunning()) {
        console.log(`[STT] Prewarming local sidecar (${reason})`);
        bootTimeline.mark("sidecar-prewarm:start", { reason });
      }
      await ensureLocalSidecarRunningOnce(modelId);
      if (task.cancelled || generation !== prewarmGeneration) return;
      console.log(`[STT] Local sidecar prewarmed (${reason})`);
      bootTimeline.mark("sidecar-prewarm:ready", { reason });
    } catch (err) {
      if (task.cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[STT] Local sidecar prewarm failed (${reason}): ${msg}`);
      bootTimeline.mark("sidecar-prewarm:failed", { reason, error: msg });
    } finally {
      if (activePrewarm === task) activePrewarm = null;
    }
  });
}

export function stopLocalSidecar(): Promise<void> {
  clearIdleTimer();
  setAutoRestart(false);
  const stalePrewarmStop = cancelPendingPrewarm();
  return enqueueLifecycle(async () => {
    await stalePrewarmStop;
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
 * Switch the active model and resync the sidecar when the local provider is
 * selected so the new model family is loaded. Cloud provider selection still
 * persists a ready local model, but does not touch the local sidecar.
 *
 * The whole transition is serialized: an active request drains, the old PID
 * exits, and only the latest selected model is then allowed to start. This
 * avoids both transient double-model residency and the stale-prewarm race that
 * could leave no sidecar running after a rapid switch.
 */
export async function setActiveModelAndResync(modelId: string): Promise<void> {
  latestRequestedModelId = modelId;
  const isTargetReady = () => getModelInstallState(modelId) === "ready";
  const stalePrewarmStop = isTargetReady() && isPreferredProviderLocal()
    ? cancelPendingPrewarm()
    : Promise.resolve();
  await enqueueLifecycle(async () => {
    await stalePrewarmStop;
    await waitForTranscriptionsToDrain();
    // A later click superseded this transition while it waited in the queue.
    // Validate before touching the current sidecar; a direct IPC call or a
    // removal race must not leave the old process stopped for an unready model.
    if (latestRequestedModelId !== modelId || !isTargetReady()) return;
    if (!isPreferredProviderLocal()) {
      setActiveModelId(modelId);
      return;
    }
    clearIdleTimer();
    setAutoRestart(false);
    await killSidecar();
    // Recheck after shutdown as the model can be removed while the old
    // process drains. Do not spawn or persist a now-invalid selection.
    if (latestRequestedModelId !== modelId || !isTargetReady()) return;
    if (!isPreferredProviderLocal()) {
      setActiveModelId(modelId);
      return;
    }
    await ensureLocalSidecarRunningOnce(modelId);
    // Persist only after the replacement is running and readiness still holds.
    // If spawn throws, the previous model remains selected and the renderer
    // refreshes back to truthful state.
    if (
      latestRequestedModelId === modelId &&
      isTargetReady() &&
      isPreferredProviderLocal()
    ) {
      setActiveModelId(modelId);
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
