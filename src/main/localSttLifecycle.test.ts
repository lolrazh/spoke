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
  startLocalStream: vi.fn(),
  streamingPush: vi.fn(),
  streamingFinish: vi.fn(),
  streamingCancel: vi.fn(),
  getModelFamily: vi.fn(),
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
  startLocalStream: mocks.startLocalStream,
}));

vi.mock("./localModelContract", () => ({
  getModelFamily: mocks.getModelFamily,
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
    mocks.streamingPush.mockResolvedValue(undefined);
    mocks.streamingFinish.mockResolvedValue({ text: "hello", metrics: {} });
    mocks.startLocalStream.mockResolvedValue({
      push: mocks.streamingPush,
      finish: mocks.streamingFinish,
      cancel: mocks.streamingCancel,
    });
    mocks.getModelFamily.mockReturnValue("nemotron");
    mocks.state.appPreferences = {};
  });

  it("throws without spawning when the local model is not ready", async () => {
    mocks.getModelInstallState.mockReturnValue("not_installed");
    const { transcribeWithLocalSidecar, LOCAL_MODEL_NOT_INSTALLED_MESSAGE } =
      await importLifecycle();

    await expect(
      transcribeWithLocalSidecar("current-model", Buffer.from([])),
    ).rejects.toThrow(
      LOCAL_MODEL_NOT_INSTALLED_MESSAGE,
    );

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.transcribeLocal).not.toHaveBeenCalled();
  });

  it("spawns once and enables auto-restart before local transcription", async () => {
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);

    await expect(
      transcribeWithLocalSidecar("current-model", pcmBuffer),
    ).resolves.toEqual({
      text: "hello",
      metrics: {},
    });

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("current-model");
    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer, undefined);
  });

  it("uses the dictation's pinned model after the active selection changes", async () => {
    mocks.getActiveModelId.mockReturnValue("newer-selection");
    const { transcribeWithLocalSidecar } = await importLifecycle();

    await transcribeWithLocalSidecar("pinned-model", Buffer.from([1, 2]));

    expect(mocks.spawnSidecar).toHaveBeenCalledWith("pinned-model");
  });

  it("passes an optional prompt through to the sidecar engine", async () => {
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);
    const prompt = "Your vocabulary includes: Spoke, Sandeep";

    await transcribeWithLocalSidecar("current-model", pcmBuffer, prompt);

    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer, prompt);
  });

  it("adds the saved dictionary to the Whisper prompt", async () => {
    mocks.state.appPreferences = {
      vocabularyDictionary: ["GitHub", "MacBook Pro"],
    };
    const { transcribeWithLocalSidecar } = await importLifecycle();
    const pcmBuffer = Buffer.from([1, 2, 3]);
    const prompt = "Your vocabulary includes: Spoke";

    await transcribeWithLocalSidecar("current-model", pcmBuffer, prompt);

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
      "current-model",
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
      transcribeWithLocalSidecar("current-model", Buffer.from([1, 2, 3])),
    ).resolves.toEqual({ text: "GitHub", metrics: {} });
  });

  it("passes the transcript through unchanged when no dictionary is set", async () => {
    mocks.transcribeLocal.mockResolvedValue({ text: "github", metrics: {} });
    const { transcribeWithLocalSidecar } = await importLifecycle();

    await expect(
      transcribeWithLocalSidecar("current-model", Buffer.from([1, 2, 3])),
    ).resolves.toEqual({ text: "github", metrics: {} });
  });

  it("holds one lifecycle lease across a live stream and corrects its final text", async () => {
    mocks.state.appPreferences = { vocabularyDictionary: ["GitHub"] };
    mocks.streamingFinish.mockResolvedValue({ text: "github", metrics: {} });
    const { beginLocalStreamingSession } = await importLifecycle();
    const onPartial = vi.fn();

    const session = await beginLocalStreamingSession("current-model", onPartial);
    await session.push(Buffer.from([1, 0]));
    await expect(session.finish()).resolves.toEqual({
      text: "GitHub",
      metrics: {},
    });

    expect(mocks.startLocalStream).toHaveBeenCalledWith(onPartial);
    expect(mocks.streamingPush).toHaveBeenCalledWith(Buffer.from([1, 0]));
  });

  it("rejects live streaming for a batch-only active model", async () => {
    mocks.getModelFamily.mockReturnValue("parakeet");
    const { beginLocalStreamingSession } = await importLifecycle();

    await expect(
      beginLocalStreamingSession("current-model", vi.fn()),
    ).rejects.toThrow(
      "does not support live streaming",
    );
    expect(mocks.startLocalStream).not.toHaveBeenCalled();
  });

  it("abandons a pending stream after renderer reload without killing the loaded model", async () => {
    let finishStartup!: () => void;
    mocks.spawnSidecar.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishStartup = resolve)),
    );
    const abortController = new AbortController();
    const { beginLocalStreamingSession } = await importLifecycle();

    const pending = beginLocalStreamingSession(
      "current-model",
      vi.fn(),
      abortController.signal,
    );
    await Promise.resolve();
    abortController.abort();
    finishStartup();

    await expect(pending).rejects.toThrow("cancelled during startup");
    expect(mocks.startLocalStream).not.toHaveBeenCalled();
    expect(mocks.killSidecar).not.toHaveBeenCalled();
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
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledWith("new-model");
    });
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

  it("does not enqueue work when the active sidecar is already warm", async () => {
    mocks.isSidecarRunning.mockReturnValue(true);
    const { prewarmLocalSidecar } = await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    await flushLifecycle();

    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.killSidecar).not.toHaveBeenCalled();
    expect(mocks.setAutoRestart).not.toHaveBeenCalled();
  });

  it("coalesces repeated prewarm requests while startup is queued", async () => {
    const { prewarmLocalSidecar } = await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    prewarmLocalSidecar("renderer");
    prewarmLocalSidecar("ptt-down");

    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    });

    expect(mocks.spawnSidecar).toHaveBeenCalledWith("current-model");
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

  it("persists rapid model selections immediately and only loads the latest", async () => {
    let active = "old-model";
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    const { selectActiveModel } = await importLifecycle();

    selectActiveModel("model-a");
    selectActiveModel("model-b");

    expect(active).toBe("model-b");
    expect(mocks.setActiveModelId.mock.calls.map(([modelId]) => modelId)).toEqual([
      "model-a",
      "model-b",
    ]);
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    });

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
    const { prewarmLocalSidecar, selectActiveModel } =
      await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    await flushLifecycle();
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("old-model");

    selectActiveModel("model-b");
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
    });

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
    const { prewarmLocalSidecar, selectActiveModel } =
      await importLifecycle();

    prewarmLocalSidecar("ptt-down");
    selectActiveModel("model-b");
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    });

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
  });

  it("keeps a selection when its background load fails", async () => {
    mocks.spawnSidecar.mockRejectedValue(new Error("model load failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { selectActiveModel } = await importLifecycle();

    expect(() => selectActiveModel("model-b")).not.toThrow();
    expect(mocks.setActiveModelId).toHaveBeenCalledWith("model-b");
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("model load failed"),
      );
    });

    warn.mockRestore();
  });

  it("rejects an unready model before it changes selection or lifecycle", async () => {
    mocks.getModelInstallState.mockImplementation((modelId?: string) =>
      modelId === "model-b" ? "not_installed" : "ready",
    );
    const { selectActiveModel, LOCAL_MODEL_NOT_INSTALLED_MESSAGE } =
      await importLifecycle();

    expect(() => selectActiveModel("model-b")).toThrow(
      LOCAL_MODEL_NOT_INSTALLED_MESSAGE,
    );

    expect(mocks.killSidecar).not.toHaveBeenCalled();
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setActiveModelId).not.toHaveBeenCalled();
  });

  it("persists a ready model without touching the sidecar for a cloud provider", async () => {
    mocks.isPreferredProviderLocal.mockReturnValue(false);
    const { selectActiveModel } = await importLifecycle();

    selectActiveModel("model-b");

    expect(mocks.setActiveModelId).toHaveBeenCalledWith("model-b");
    expect(mocks.killSidecar).not.toHaveBeenCalled();
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
    expect(mocks.setAutoRestart).not.toHaveBeenCalled();
  });

  it("rechecks readiness before the background load starts", async () => {
    let targetReady = true;
    let active = "model-a";
    mocks.getModelInstallState.mockImplementation((modelId?: string) =>
      modelId === "model-b"
        ? targetReady
          ? "ready"
          : "not_installed"
        : "ready",
    );
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    const { selectActiveModel } = await importLifecycle();

    selectActiveModel("model-b");
    targetReady = false;
    await flushLifecycle();

    expect(active).toBe("model-b");
    expect(mocks.killSidecar).not.toHaveBeenCalled();
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
  });

  it("persists now but waits for an active transcription before replacing its model", async () => {
    let active = "model-a";
    let runningModel = "model-a";
    let running = true;
    let resolveTranscribe: (value: {
      text: string;
      metrics: Record<string, never>;
    }) => void = () => undefined;
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    mocks.isSidecarRunning.mockImplementation(() => running);
    mocks.getSidecarModelId.mockImplementation(() => runningModel);
    mocks.killSidecar.mockImplementation(async () => {
      running = false;
    });
    mocks.spawnSidecar.mockImplementation(async (modelId: string) => {
      running = true;
      runningModel = modelId;
    });
    mocks.transcribeLocal.mockReturnValue(
      new Promise((resolve) => {
        resolveTranscribe = resolve;
      }),
    );
    const { selectActiveModel, transcribeWithLocalSidecar } =
      await importLifecycle();

    const transcription = transcribeWithLocalSidecar(
      "model-a",
      Buffer.from([1]),
    );
    await flushLifecycle();
    selectActiveModel("model-b");
    expect(active).toBe("model-b");
    await flushLifecycle();
    expect(mocks.killSidecar).not.toHaveBeenCalled();

    resolveTranscribe({ text: "done", metrics: {} });
    await transcription;
    await vi.waitFor(() => {
      expect(mocks.spawnSidecar).toHaveBeenCalledWith("model-b");
    });

    expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
  });

  it("retries the selected model when dictation follows a failed prewarm", async () => {
    let active = "model-a";
    mocks.getActiveModelId.mockImplementation(() => active);
    mocks.setActiveModelId.mockImplementation((modelId: string) => {
      active = modelId;
    });
    mocks.spawnSidecar
      .mockRejectedValueOnce(new Error("background load failed"))
      .mockResolvedValueOnce(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { selectActiveModel, transcribeWithLocalSidecar } =
      await importLifecycle();

    selectActiveModel("model-b");
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });

    await expect(
      transcribeWithLocalSidecar("model-b", Buffer.from([1])),
    ).resolves.toMatchObject({ text: "hello" });
    expect(mocks.spawnSidecar).toHaveBeenNthCalledWith(1, "model-b");
    expect(mocks.spawnSidecar).toHaveBeenNthCalledWith(2, "model-b");

    warn.mockRestore();
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

      await transcribeWithLocalSidecar("current-model", Buffer.from([1]));
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

      await transcribeWithLocalSidecar("current-model", Buffer.from([1]));
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

      const inflight = transcribeWithLocalSidecar(
        "current-model",
        Buffer.from([1]),
      );
      // Let queued sidecar startup settle so the request is registered.
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

      await transcribeWithLocalSidecar("current-model", Buffer.from([1]));
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

      await transcribeWithLocalSidecar("current-model", Buffer.from([1]));
      await vi.advanceTimersByTimeAsync(SIDECAR_IDLE_TIMEOUT_MS);

      expect(errorSpy).toHaveBeenCalledWith(
        "[STT] Idle sidecar shutdown failed: shutdown timeout",
      );
      errorSpy.mockRestore();
    });
  });
});
