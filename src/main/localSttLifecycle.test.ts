import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveModelId: vi.fn(),
  getModelStatus: vi.fn(),
  getModelInstallState: vi.fn(),
  installModel: vi.fn(),
  removeModel: vi.fn(),
  setActiveModelId: vi.fn(),
  isPreferredProviderLocal: vi.fn(),
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

describe("localSttLifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getModelStatus.mockReturnValue({ family: "whisper" });
    mocks.getModelInstallState.mockReturnValue("ready");
    mocks.installModel.mockResolvedValue(undefined);
    mocks.removeModel.mockResolvedValue(undefined);
    mocks.isPreferredProviderLocal.mockReturnValue(true);
    mocks.isSidecarRunning.mockReturnValue(false);
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
    const { installLocalModelAndSyncSidecar } = await importLifecycle();

    await installLocalModelAndSyncSidecar("new-model");

    expect(mocks.setActiveModelId).toHaveBeenCalledWith("new-model");
    // Activation goes through the resync path: stop any stale sidecar and
    // leave the spawn to the install handler's scheduled prewarm.
    expect(mocks.killSidecar).toHaveBeenCalled();
    expect(mocks.spawnSidecar).not.toHaveBeenCalled();
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

      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS);

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
      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS - 1000);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      // A dictation intent (PTT prewarm) resets the countdown.
      prewarmLocalSidecar("ptt-down");
      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS - 1000);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
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
      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS);
      expect(mocks.killSidecar).not.toHaveBeenCalled();

      resolveTranscribe({ text: "ok", metrics: {} });
      await inflight;

      // Completion re-arms the timer; now the idle timeout stops it.
      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS);
      expect(mocks.killSidecar).toHaveBeenCalledTimes(1);
    });

    it("treats an idle stop as intentional so auto-restart does not respawn", async () => {
      const { transcribeWithLocalSidecar, SIDECAR_IDLE_TIMEOUT_MS } =
        await importLifecycle();

      await transcribeWithLocalSidecar(Buffer.from([1]));
      vi.advanceTimersByTime(SIDECAR_IDLE_TIMEOUT_MS);

      // Auto-restart is disabled before the kill, so the engine's exit handler
      // will not respawn on the idle-driven shutdown.
      const disableOrder = mocks.setAutoRestart.mock.invocationCallOrder.at(-1);
      const killOrder = mocks.killSidecar.mock.invocationCallOrder[0];
      expect(mocks.setAutoRestart).toHaveBeenLastCalledWith(false);
      expect(disableOrder).toBeLessThan(killOrder);
    });
  });
});
