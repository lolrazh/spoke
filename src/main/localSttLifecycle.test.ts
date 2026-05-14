import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelInstallState: vi.fn(),
  installModel: vi.fn(),
  removeModel: vi.fn(),
  isPreferredProviderLocal: vi.fn(),
  isSidecarRunning: vi.fn(),
  killSidecar: vi.fn(),
  setAutoRestart: vi.fn(),
  spawnSidecar: vi.fn(),
  transcribeLocal: vi.fn(),
}));

vi.mock("./modelManager", () => ({
  getModelInstallState: mocks.getModelInstallState,
  installModel: mocks.installModel,
  removeModel: mocks.removeModel,
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

async function importLifecycle() {
  return import("./localSttLifecycle");
}

describe("localSttLifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getModelInstallState.mockReturnValue("ready");
    mocks.installModel.mockResolvedValue(undefined);
    mocks.removeModel.mockResolvedValue(undefined);
    mocks.isPreferredProviderLocal.mockReturnValue(true);
    mocks.isSidecarRunning.mockReturnValue(false);
    mocks.spawnSidecar.mockResolvedValue(undefined);
    mocks.transcribeLocal.mockResolvedValue({ text: "hello", metrics: {} });
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
    expect(mocks.transcribeLocal).toHaveBeenCalledWith(pcmBuffer);
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

  it("starts the sidecar when local is selected and the model is ready", async () => {
    const { syncLocalSidecarForCurrentProvider } = await importLifecycle();

    await syncLocalSidecarForCurrentProvider();

    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
    expect(mocks.killSidecar).not.toHaveBeenCalled();
  });

  it("syncs the sidecar after model installation", async () => {
    const { installLocalModelAndSyncSidecar } = await importLifecycle();

    await installLocalModelAndSyncSidecar();

    expect(mocks.installModel).toHaveBeenCalledTimes(1);
    expect(mocks.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.setAutoRestart).toHaveBeenCalledWith(true);
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
});
