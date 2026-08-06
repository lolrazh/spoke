import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveModelId: vi.fn(),
  getModelStatus: vi.fn(),
  getModelInstallState: vi.fn(),
  installModel: vi.fn(),
  removeModel: vi.fn(),
  setActiveModelId: vi.fn(),
  isPreferredProviderLocal: vi.fn(),
  getSidecarModelId: vi.fn(),
  isSidecarRunning: vi.fn(),
  killSidecar: vi.fn(),
  setAutoRestart: vi.fn(),
  spawnSidecar: vi.fn(),
  transcribeLocal: vi.fn(),
  state: { appPreferences: {} as { vocabularyDictionary?: string[] } },
}));

vi.mock("./modelManager", () => ({
  getActiveModelId: mocks.getActiveModelId,
  getModelStatus: mocks.getModelStatus,
  getModelInstallState: mocks.getModelInstallState,
  installModel: mocks.installModel,
  removeModel: mocks.removeModel,
  setActiveModelId: mocks.setActiveModelId,
}));

vi.mock("./providerStore", () => ({
  isPreferredProviderLocal: mocks.isPreferredProviderLocal,
}));

vi.mock("./sidecarEngine", () => ({
  getSidecarModelId: mocks.getSidecarModelId,
  isSidecarRunning: mocks.isSidecarRunning,
  killSidecar: mocks.killSidecar,
  setAutoRestart: mocks.setAutoRestart,
  spawnSidecar: mocks.spawnSidecar,
  transcribeLocal: mocks.transcribeLocal,
}));

vi.mock("./windowState", () => ({ state: mocks.state }));

async function importLifecycle() {
  return import("./localSttLifecycle");
}

async function flushLifecycle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("localSttLifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getActiveModelId.mockReturnValue("current-model");
    mocks.getModelStatus.mockReturnValue({ family: "whisper" });
    mocks.getModelInstallState.mockReturnValue("ready");
    mocks.installModel.mockResolvedValue(undefined);
    mocks.removeModel.mockResolvedValue(undefined);
    mocks.isPreferredProviderLocal.mockReturnValue(true);
    mocks.getSidecarModelId.mockReturnValue("current-model");
    mocks.isSidecarRunning.mockReturnValue(false);
    mocks.killSidecar.mockResolvedValue(undefined);
    mocks.spawnSidecar.mockResolvedValue(undefined);
    mocks.transcribeLocal.mockResolvedValue({ text: "hello", metrics: {} });
    mocks.state.appPreferences = {};
  });

  it("throws without spawning when the local model is not ready", async () => {
    mocks.getModelInstallState.mockReturnValue("not_installed");
    const { transcribeWithLocalSidecar, LOCAL_MODEL_NOT_INSTALLED_MESSAGE } =
      await importLifecycle();

    await expect(transcribeWithLocalSidecar(Buffer.from([]))).rejects.toThrow(
      LOCAL_MODEL_NOT_INSTALLED_MESSAGE,
    );

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.transcribeLocal).not.toHaveBeenCalled();
  });

  it("spawns once and enables auto-restart before local transcription", async () => {
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);

    await expect(transcribeWithLocalSidecar(pcmBuffer)).resolves.toEqual({
      text: "hello",
      metrics: {},
    });

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("current-model");
    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer, undefined);
  });

  it("passes an optional prompt through to the sidecar engine", async () => {
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);
    const prompt = "Your vocabulary includes: Spoke, Sandeep";

    await transcribeWithLocalSidecar(pcmBuffer, prompt);

    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer, prompt);
  });

  it("adds the saved dictionary to the Whisper prompt", async () => {
    mocks.state.appPreferences = {
      vocabularyDictionary: ["GitHub", "MacBook Pro"],
    };
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);
    const prompt = "Your vocabulary includes: Spoke";

    await transcribeWithLocalSidecar(pcmBuffer, prompt);

    expect(mocks.transcribeLocal).toHaveBeenCalledWith(
      pcmBuffer,
      "Your vocabulary includes: Spoke, GitHub, MacBook Pro",
    );
  });

  it("does not pass a prompt to non-Whisper local models", async () => {
    mocks.getModelStatus.mockReturnValue({ family: "parakeet" });
    mocks.state.appPreferences = {
      vocabularyDictionary: ["GitHub"],
    };
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);

    await transcribeWithLocalSidecar(
      pcmBuffer,
      "Your vocabulary includes: Spoke, OCRWord",
    );

    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer, undefined);
  });

  it("applies dictionary correction to the transcript", async () => {
    mocks.state.appPreferences = { vocabularyDictionary: ["GitHub"] };
    mocks.transcribeLocal.mockResolvedValue({ text: "github", metrics: {} });
    const { transcribeWithLocalSidecar } = await importLifecycle();

    await expect(
      transcribeWithLocalSidecar(Buffer.from([1, 2, 3])),
    ).resolves.toEqual({ text: "GitHub", metrics: {} });
  });

  it("passes the transcript through unchanged when no dictionary is set", async () => {
    mocks.transcribeLocal.mockResolvedValue({ text: "github", metrics: {} });
    const { transcribeWithLocalSidecar } = await importLifecycle();

    await expect(
      transcribeWithLocalSidecar(Buffer.from([1, 2, 3])),
    ).resolves.toEqual({ text: "github", metrics: {} });
  });

  it("does not spawn when the sidecar is already running", async () => {
    mocks.isSidecarRunning.mockReturnValue(true);
    const { ensureLocalSidecarRunning } = await importLifecycle();

    await ensureLocalSidecarRunning();

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
  });

  it("stops a running sidecar for the wrong model before starting the active one", async () => {
    mocks.isSidecarRunning
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mocks.getSidecarModelId.mockReturnValue("old-model");
    const { ensureLocalSidecarRunning } = await importLifecycle();

    await ensureLocalSidecarRunning();

    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("current-model");
    expect(mocks.killSidecar.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawnSidecar.mock.invocationCallOrder[0],
    );
  });

  it("stops the sidecar when syncing a non-local provider", async () => {
    mocks.isPreferredProviderLocal.mockReturnValue(false);
    const { syncLocalSidecarForCurrentProvider } = await importLifecycle();

    await syncLocalSidecarForCurrentProvider();

    expect(mocks.setAutoRestart).toHaveBeenCalledWith(false);
    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
  });

  it("stops the sidecar when local is selected but the model is not ready", async () => {
    mocks.getModelInstallState.mockReturnValue("broken");
    const { syncLocalSidecarForCurrentProvider } = await importLifecycle();

    await syncLocalSidecarForCurrentProvider();

    expect(mocks.setAutoRestart).toHaveBeenCalledWith(false);
    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
  });

  it("does not pre-spawn when local is selected and the model is ready", async () => {
    const { syncLocalSidecarForCurrentProvider } = await importLifecycle();

    await syncLocalSidecarForCurrentProvider();

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setAutoRestart).not.toHaveBeenCalled();
    expect(mocks.killSidecar).not.toHaveBeenCalled();
  });

  it("does not pre-spawn after model installation", async () => {
    const { installLocalModelAndSyncSidecar } = await importLifecycle();

    await installLocalModelAndSyncSidecar();

    expect(mocks.installModel).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setAutoRestart).not.toHaveBeenCalled();
  });

  it("auto-activates the installed model when the active model is not ready", async () => {
    // Active model starts out uninstalled (e.g. removed earlier, fallback
    // landed on a not-installed default); the newly installed model is ready.
    let active = "ghost-model";
    mocks.getModelInstallState.mockImplementation((modelId?: string) =>
      (modelId ?? active) === "new-model" ? "ready" : "not_installed",
    );
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    mocks.getActiveModelId.mockImplementation(() => active);
    const { installLocalModelAndSyncSidecar } = await importLifecycle();

    await installLocalModelAndSyncSidecar("new-model");

    expect(mocks.setActiveModelId).toHaveBeenCalledWith("new-model");
    // Activation is a single transaction: the stale process exits before the
    // selected model is reported ready.
    expect(mocks.killSidecar).toHaveBeenCalled();
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("new-model");
  });

  it("does not steal activation when the active model is ready", async () => {
    const { installLocalModelAndSyncSidecar } = await importLifecycle();

    await installLocalModelAndSyncSidecar("secondary-model");

    expect(mocks.setActiveModelId).not.toHaveBeenCalled();
    expect(mocks.killSidecar).not.toHaveBeenCalled();
  });

  it("prewarms the sidecar when local model is ready", async () => {
    const { prewarmLocalSidecar } = await importLifecycle();

    prewarmLocalSidecar("test");
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    });

    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
  });

  it("does not prewarm when provider is not local", async () => {
    mocks.isPreferredProviderLocal.mockReturnValue(false);
    const { prewarmLocalSidecar } = await importLifecycle();

    prewarmLocalSidecar("test");

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
  });

  it("does not prewarm when local model is not ready", async () => {
    mocks.getModelInstallState.mockReturnValue("not_installed");
    const { prewarmLocalSidecar } = await importLifecycle();

    prewarmLocalSidecar("test");

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
  });

  it("stops the sidecar before model removal", async () => {
    const { removeLocalModelAndStopSidecar } = await importLifecycle();

    await removeLocalModelAndStopSidecar();

    expect(mocks.setAutoRestart).toHaveBeenCalledWith(false);
    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.removeModel).toHaveBeenCalledTimes(1);
    expect(mocks.killSidecar.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeModel.mock.invocationCallOrder[0],
    );
  });

  it("lets a later model switch supersede one still waiting in the lifecycle queue", async () => {
    let active = "old-model";
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    const { setActiveModelAndResync } = await importLifecycle();

    const first = setActiveModelAndResync("model-a");
    const second = setActiveModelAndResync("model-b");
    await Promise.all([first, second]);

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
  });

  it("cancels an in-flight prewarm before switching models", async () => {
    let rejectStartup: ((error: Error) => void) | null = null;
    let active = "old-model";
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    mocks.spawnSidecar.mockImplementation((modelId: string) => {
      if (modelId === "old-model") {
        return new Promise<void>((_resolve, reject) => {
          rejectStartup = reject;
        });
      }
      return Promise.resolve();
    });
    mocks.killSidecar.mockImplementation(async () => {
      rejectStartup?.(new Error("prewarm cancelled"));
      rejectStartup = null;
    });
    const { prewarmLocalSidecar, setActiveModelAndResync } =
      await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    await flushLifecycle();
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("old-model");

    await setActiveModelAndResync("model-b");

    expect(mocks.spawnSidecar.mock.calls.map(([modelId]) => modelId)).toEqual([
      "old-model",
      "model-b",
    ]);
    expect(mocks.killSidecar).toHaveBeenCalled();
    expect(mocks.killSidecar.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawnSidecar.mock.invocationCallOrder[1],
    );
  });

  it("skips a queued prewarm once a model switch is requested", async () => {
    let active = "old-model";
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    const { prewarmLocalSidecar, setActiveModelAndResync } =
      await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    await setActiveModelAndResync("model-b");

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
  });

  it("keeps the previous model selected when the replacement fails to load", async () => {
    mocks.spawnSidecar.mockRejectedValue(new Error("model load failed"));
    const { setActiveModelAndResync } = await importLifecycle();

    await expect(setActiveModelAndResync("model-b")).rejects.toThrow(
      "model load failed",
    );

    expect(mocks.setActiveModelId).not.toHaveBeenCalled();
  });

  it("does not stop or persist an unready model selection", async () => {
    mocks.getModelInstallState.mockImplementation((modelId?: string) =>
      modelId === "model-b" ? "not_installed" : "ready",
    );
    const { setActiveModelAndResync } = await importLifecycle();

    await setActiveModelAndResync("model-b");

    expect(mocks.killSidecar).not.toHaveBeenCalled();
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setActiveModelId).not.toHaveBeenCalled();
  });

  it("rechecks target readiness after stopping before spawning or persisting", async () => {
    let targetReady = true;
    mocks.getModelInstallState.mockImplementation((modelId?: string) =>
      modelId === "model-b" ? (targetReady ? "ready" : "not_installed") : "ready",
    );
    mocks.killSidecar.mockImplementation(async () => {
      targetReady = false;
    });
    const { setActiveModelAndResync } = await importLifecycle();

    await setActiveModelAndResync("model-b");

    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setActiveModelId).not.toHaveBeenCalled();
  });

  it("waits for an active transcription before replacing its model", async () => {
    let active = "model-a";
    let resolveTranscribe: (value: {
      text: string;
      metrics: Record<string, never>;
    }) => void = () => undefined;
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    mocks.isSidecarRunning
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    mocks.getSidecarModelId.mockReturnValue("model-a");
    mocks.transcribeLocal.mockReturnValue(
      new Promise((resolve) => {
        resolveTranscribe = resolve;
      }),
    );
    const { setActiveModelAndResync, transcribeWithLocalSidecar } =
      await importLifecycle();

    const transcription = transcribeWithLocalSidecar(Buffer.from([1]));
    await flushLifecycle();
    const switching = setActiveModelAndResync("model-b");
    await flushLifecycle();
    expect(mocks.killSidecar).not.toHaveBeenCalled();

    resolveTranscribe({ text: "done", metrics: {} });
    await transcription;
    await switching;

    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
  });

  describe("idle watchdog", () => {
    beforeEach(() => {
      // The idle timer only arms while a sidecar is actually running.
      mocks.isSidecarRunning.mockReturnValue(true);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops the sidecar after the idle timeout with no activity", async () => {
      const { transcribeWithLocalSidecar, SIDECAR_IDLE_TIMEOUT_MS } =
        await importLifecycle();

      await transcribeWithLocalSidecar(Buffer.from([1]));
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);

      expect(mocks.setAutoRestart).toHaveBeenLastCalledWith(false);
      expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    });

    it("resets the idle timer when new activity arrives", async () => {
      const {
        transcribeWithLocalSidecar,
        prewarmLocalSidecar,
        SIDECAR_IDLE_TIMEOUT_MS,
      } = await importLifecycle();

      await transcribeWithLocalSidecar(Buffer.from([1]));
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS - 1000);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      // A dictation intent (PTT prewarm) resets the countdown.
      prewarmLocalSidecar("ptt-down");
      await flushLifecycle();
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS - 1000);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    });

    it("never stops while a transcription is in flight", async () => {
      let resolveTranscribe: (value: {
        text: string;
        metrics: Record<string, never>;
      }) => void = () => {};
      mocks.transcribeLocal.mockReturnValue(
        new Promise((resolve) => {
          resolveTranscribe = resolve;
        }),
      );
      const { transcribeWithLocalSidecar, SIDECAR_IDLE_TIMEOUT_MS } =
        await importLifecycle();

      const inflight = transcribeWithLocalSidecar(Buffer.from([1]));
      // Let ensureLocalSidecarRunning settle so the request is registered.
      await Promise.resolve();
      await Promise.resolve();

      // The timer elapses mid-transcription but must not stop the sidecar.
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      resolveTranscribe({ text: "ok", metrics: {} });
      await inflight;

      // Completion re-arms the timer; now the idle timeout stops it.
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);
      expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    });

    it("treats an idle stop as intentional so auto-restart does not respawn", async () => {
      const { transcribeWithLocalSidecar, SIDECAR_IDLE_TIMEOUT_MS } =
        await importLifecycle();

      await transcribeWithLocalSidecar(Buffer.from([1]));
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);

      // Auto-restart is disabled before the kill, so the engine's exit handler
      // will not respawn on the idle-driven shutdown.
      const disableOrder = mocks.setAutoRestart.mock.invocationCallOrder.at(-1);
      const killOrder = mocks.killSidecar.mock.invocationCallOrder[0];
      expect(mocks.setAutoRestart).toHaveBeenLastCalledWith(false);
      expect(disableOrder).toBeLessThan(killOrder);
    });

    it("logs an idle shutdown rejection instead of leaving it unhandled", async () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mocks.killSidecar.mockRejectedValueOnce(new Error("shutdown timeout"));
      const { transcribeWithLocalSidecar, SIDECAR_IDLE_TIMEOUT_MS } =
        await importLifecycle();

      await transcribeWithLocalSidecar(Buffer.from([1]));
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);

      expect(errorSpy).toHaveBeenCalledWith(
        "[STT] Idle sidecar shutdown failed: shutdown timeout",
      );
      errorSpy.mockRestore();
    });
  });
});
