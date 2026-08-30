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
  startLocalStream,
  transcribeLocal,
  type LocalStreamingSession,
} from "./sidecarEngine";
import { bootTimeline } from "./bootTimeline";
import { getVocabularyDictionary } from "./vocabularyService";
import { state } from "./windowState";
import { buildSTTPrompt } from "../../shared/sttPrompt";
import { getModelFamily } from "./localModelContract";

export const LOCAL_MODEL_NOT_INSTALLED_MESSAGE =
  "Local model not installed. Open Settings to install it.";

// The sidecar holds hundreds of MB resident for a menu-bar app that is idle
// most of the time. Stop it after a stretch of no dictation activity; a PTT
// key-down re-warms it so the user rarely feels the cold start.
export const SIDECAR_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let idleTimer: NodeJS.Timeout | null = null;
let transcriptionsInFlight = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();
let prewarmGeneration = 0;
let activePrewarm: {
  generation: number;
  cancelled: boolean;
  stopPromise: Promise<void> | null;
} | null = null;
const transcriptionDrainWaiters = new Set<() => void>();

async function correctTranscriptIfNeeded(
  text: string,
  dictionary: readonly string[],
): Promise<string> {
  if (!Array.isArray(dictionary) || dictionary.length === 0) return text;
  const { correctTranscript } = await import("./dictionaryCorrection");
  return correctTranscript(text, dictionary);
}

function logSidecarShutdownFailure(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[STT] ${context}: ${message}`);
}

function logPrewarmFailure(reason: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[STT] Local sidecar prewarm failed (${reason}): ${message}`);
  bootTimeline.mark("sidecar-prewarm:failed", { reason, error: message });
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

function queueLocalSidecarPrewarm(
  reason: string,
  generation: number,
  waitBeforeStart: Promise<void>,
): void {
  void enqueueLifecycle(async () => {
    try {
      await waitBeforeStart;
    } catch (error) {
      logPrewarmFailure(reason, error);
      return;
    }
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
      await waitForTranscriptionsToDrain();
      if (
        task.cancelled ||
        generation !== prewarmGeneration ||
        getActiveModelId() !== modelId ||
        !isPreferredProviderLocal() ||
        getModelInstallState(modelId) !== "ready"
      ) {
        return;
      }
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
      logPrewarmFailure(reason, err);
    } finally {
      if (activePrewarm === task) activePrewarm = null;
    }
  });
}

export function prewarmLocalSidecar(reason: string): void {
  queueLocalSidecarPrewarm(reason, prewarmGeneration, Promise.resolve());
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
    selectActiveModel(modelId);
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
 * Persist a ready model now, then load and warm it behind the renderer. The
 * lifecycle queue keeps the old process alive until any pinned dictation has
 * finished. A later dictation joins that queue and retries if prewarm failed.
 */
export function selectActiveModel(modelId: string): void {
  if (getModelInstallState(modelId) !== "ready") {
    throw new Error(LOCAL_MODEL_NOT_INSTALLED_MESSAGE);
  }

  setActiveModelId(modelId);
  if (!isPreferredProviderLocal()) return;

  clearIdleTimer();
  const stalePrewarmStop = cancelPendingPrewarm();
  queueLocalSidecarPrewarm(
    "model-switch",
    prewarmGeneration,
    stalePrewarmStop,
  );
}

export async function transcribeWithLocalSidecar(
  modelId: string,
  pcmBuffer: Buffer,
  prompt?: string,
): Promise<LocalTranscribeResult> {
  await enqueueLifecycle(async () => {
    await ensureLocalSidecarRunningOnce(modelId);
    transcriptionsInFlight++;
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
    return {
      ...result,
      text: await correctTranscriptIfNeeded(result.text, dictionary),
    };
  } finally {
    releaseTranscriptionLease();
    // Reset on completion so idle time is measured from the last activity.
    armIdleTimer();
  }
}

export interface ManagedLocalStreamingSession {
  push(pcmBuffer: Buffer): Promise<void>;
  finish(): Promise<LocalTranscribeResult>;
  cancel(): void;
}

/** Acquire one lifecycle lease for a full live Nemotron dictation. */
export async function beginLocalStreamingSession(
  modelId: string,
  onPartial: (text: string) => void,
  signal?: AbortSignal,
): Promise<ManagedLocalStreamingSession> {
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new Error("Local streaming session was cancelled during startup.");
    }
  };

  await enqueueLifecycle(async () => {
    throwIfAborted();
    if (getModelFamily(modelId) !== "nemotron") {
      throw new Error(
        "The active local model does not support live streaming.",
      );
    }
    await ensureLocalSidecarRunningOnce(modelId);
    // A renderer reload can occur while the model is loading. Preserve the
    // now-ready sidecar, but do not acquire a lease for the stale document.
    throwIfAborted();
    transcriptionsInFlight++;
  });
  armIdleTimer();

  let sidecarSession: LocalStreamingSession;
  try {
    throwIfAborted();
    sidecarSession = await startLocalStream(onPartial);
    if (signal?.aborted) {
      sidecarSession.cancel();
      throwIfAborted();
    }
  } catch (error) {
    releaseTranscriptionLease();
    armIdleTimer();
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseTranscriptionLease();
    armIdleTimer();
  };

  return {
    push: (pcmBuffer) => sidecarSession.push(pcmBuffer),
    async finish() {
      try {
        const result = await sidecarSession.finish();
        const dictionary = state.appPreferences.vocabularyDictionary ?? [];
        return {
          ...result,
          text: await correctTranscriptIfNeeded(result.text, dictionary),
        };
      } finally {
        release();
      }
    },
    cancel() {
      sidecarSession.cancel();
      release();
    },
  };
}
