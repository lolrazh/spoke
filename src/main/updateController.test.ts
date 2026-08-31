import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockAutoUpdater = EventEmitter & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
};

type MockElectron = {
  app: {
    isPackaged: boolean;
    getVersion: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
    exit: ReturnType<typeof vi.fn>;
    relaunch: ReturnType<typeof vi.fn>;
  };
  autoUpdater: MockAutoUpdater;
  // Electron's built-in Squirrel.Mac updater, which electron-updater drives
  // internally on macOS. It signals before-quit-for-update when update quit
  // begins.
  nativeSquirrelUpdater: EventEmitter;
};

async function loadController(
  options: { packaged?: boolean; version?: string } = {},
) {
  vi.resetModules();

  const autoUpdater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  }) as MockAutoUpdater;

  const app = {
    isPackaged: options.packaged ?? true,
    getVersion: vi.fn(() => options.version ?? "0.1.4"),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
  };

  const nativeSquirrelUpdater = new EventEmitter();

  vi.doMock("electron", () => ({ app, autoUpdater: nativeSquirrelUpdater }));
  vi.doMock("electron-updater", () => ({ autoUpdater }));

  const controller = await import("./updateController");
  const sendNotify = vi.fn();
  const rebuildTrayMenu = vi.fn();
  const onStateChange = vi.fn();
  controller.initUpdateController({ sendNotify, rebuildTrayMenu, onStateChange });

  return {
    controller,
    electron: { app, autoUpdater, nativeSquirrelUpdater } satisfies MockElectron,
    sendNotify,
    rebuildTrayMenu,
    onStateChange,
  };
}

describe("updateController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("electron");
    vi.doUnmock("electron-updater");
    vi.resetModules();
  });

  it("configures the github provider and starts a manual check", async () => {
    const { controller, electron, sendNotify } = await loadController({
      version: "0.1.4",
    });

    await controller.manualCheckForUpdates(false);

    expect(electron.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "lolrazh",
      repo: "spoke",
    });
    expect(electron.autoUpdater.autoDownload).toBe(false);
    expect(electron.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(controller.getUpdateStatus()).toBe("checking");
    // A manual check stays quiet until it has a result to report.
    expect(sendNotify).not.toHaveBeenCalled();
  });

  it("announces an available update when the updater finds one", async () => {
    const { controller, electron, sendNotify } = await loadController({
      version: "0.1.4",
    });

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });

    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.getUpdateSnapshot().version).toBe("0.1.7");
    expect(controller.isUpdateReadyToInstall()).toBe(false);
    expect(sendNotify.mock.calls.map((call) => call[0])).toEqual([
      "Update available",
    ]);
    // autoDownload is off: finding an update must not start the transfer.
    expect(electron.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(controller.getUpdateSnapshot().downloadPercent).toBeNull();
  });

  it("starts the download on demand via downloadUpdate", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });

    controller.downloadUpdate();
    expect(electron.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(controller.getUpdateStatus()).toBe("downloading");
  });

  it("ignores downloadUpdate unless an update is available", async () => {
    const { controller, electron } = await loadController();

    controller.downloadUpdate();
    expect(electron.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(controller.getUpdateStatus()).toBe("idle");
  });

  it("tracks real download progress in the snapshot", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    expect(controller.getUpdateSnapshot().downloadPercent).toBeNull();

    electron.autoUpdater.emit("download-progress", {
      percent: 42.6,
      transferred: 100,
      total: 235,
      bytesPerSecond: 1000,
    });

    expect(controller.getUpdateStatus()).toBe("downloading");
    expect(controller.getUpdateSnapshot().downloadPercent).toBe(43);

    electron.autoUpdater.emit("download-progress", { percent: 99.2 });
    expect(controller.getUpdateSnapshot().downloadPercent).toBe(99);
  });

  it("coalesces burst download progress publications", async () => {
    const { controller, electron, onStateChange, rebuildTrayMenu } =
      await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    onStateChange.mockClear();
    rebuildTrayMenu.mockClear();

    electron.autoUpdater.emit("download-progress", { percent: 10 });
    electron.autoUpdater.emit("download-progress", { percent: 20 });
    electron.autoUpdater.emit("download-progress", { percent: 30 });

    // The authoritative snapshot is current before the deferred publication.
    expect(controller.getUpdateSnapshot().downloadPercent).toBe(30);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(rebuildTrayMenu).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange.mock.calls[0]?.[0]).toMatchObject({
      status: "downloading",
      downloadPercent: 30,
    });
    expect(rebuildTrayMenu).toHaveBeenCalledTimes(1);

    electron.autoUpdater.emit("download-progress", { percent: 30 });
    await vi.advanceTimersByTimeAsync(50);

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(rebuildTrayMenu).toHaveBeenCalledTimes(1);
  });

  it("marks the update ready once it finishes downloading", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available", { version: "0.1.5" });
    electron.autoUpdater.emit("download-progress", { percent: 50 });
    electron.autoUpdater.emit("update-downloaded", { version: "0.1.5" });

    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.isUpdateReadyToInstall()).toBe(true);
    expect(controller.getUpdateSnapshot().version).toBe("0.1.5");
    expect(controller.getUpdateSnapshot().downloadPercent).toBe(100);
    expect(sendNotify).toHaveBeenCalledWith("Update ready. Restart to update");
    expect(electron.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(electron.app.exit).not.toHaveBeenCalled();
  });

  it("reports up to date when no update is available", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-not-available");

    expect(controller.getUpdateStatus()).toBe("not-available");
    expect(sendNotify).toHaveBeenCalledWith("You're up to date.");
  });

  it("does not start another check while an update is downloading", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.emit("download-progress", { percent: 10 });
    await controller.manualCheckForUpdates(false);

    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(sendNotify).toHaveBeenLastCalledWith("Downloading update");
    expect(controller.getUpdateStatus()).toBe("downloading");
  });

  it("recovers from a check that never emits an updater result", async () => {
    const { controller, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateSnapshot().error).toContain("No updater response");
    expect(sendNotify).toHaveBeenCalledWith(
      "Update check timed out. Try again in a moment.",
    );
  });

  it("errors out when the download stalls with no progress", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.emit("download-progress", { percent: 20 });

    // A late chunk keeps the watchdog from firing early...
    await vi.advanceTimersByTimeAsync(60_000);
    electron.autoUpdater.emit("download-progress", { percent: 21 });
    expect(controller.getUpdateStatus()).toBe("downloading");

    // ...but once progress truly stops, the stall watchdog trips.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateSnapshot().error).toContain("stalled");
    expect(sendNotify).toHaveBeenCalledWith(
      "Update download stalled. Try again in a moment.",
    );
  });

  it("surfaces updater errors during manual checks", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit(
      "error",
      new Error("The command is disabled and cannot be executed"),
    );

    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateSnapshot().error).toBe(
      "The command is disabled and cannot be executed",
    );
    expect(sendNotify).toHaveBeenCalledWith(
      "Update check failed: The command is disabled and cannot be executed",
    );
  });

  it("notifies when the download fails, even without a manual check in flight", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    sendNotify.mockClear();

    controller.downloadUpdate();
    electron.autoUpdater.emit("error", new Error("ENOENT: no such file"));

    expect(controller.getUpdateStatus()).toBe("error");
    expect(sendNotify).toHaveBeenCalledWith(
      "Update download failed: ENOENT: no such file",
    );
  });

  it("surfaces a download rejection even if no error event is emitted", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.downloadUpdate.mockRejectedValueOnce(
      new Error("boom"),
    );

    controller.downloadUpdate();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateSnapshot().error).toBe("boom");
    expect(sendNotify).toHaveBeenCalledWith("Update download failed: boom");
  });

  it("resumes the download on retry after a failed download", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });

    controller.downloadUpdate();
    electron.autoUpdater.emit("error", new Error("network reset"));
    expect(controller.getUpdateStatus()).toBe("error");

    // The update info from the check is still cached, so a retry restarts the
    // transfer directly instead of requiring another check.
    controller.downloadUpdate();
    expect(electron.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(controller.getUpdateStatus()).toBe("downloading");
  });

  it("does not retry the download directly after a failed check", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("error", new Error("offline"));
    expect(controller.getUpdateStatus()).toBe("error");

    controller.downloadUpdate();
    expect(electron.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("announces the same available version only once across background checks", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.emit("update-not-available");

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });

    expect(
      sendNotify.mock.calls.filter((call) => call[0] === "Update available"),
    ).toHaveLength(1);

    // A manual check must still answer, even about an announced version.
    electron.autoUpdater.emit("update-not-available");
    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    expect(
      sendNotify.mock.calls.filter((call) => call[0] === "Update available"),
    ).toHaveLength(2);
  });

  it("only reports ready to install after the download completes (restart guard)", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    expect(controller.isUpdateReadyToInstall()).toBe(false);

    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.emit("download-progress", { percent: 90 });
    expect(controller.isUpdateReadyToInstall()).toBe(false);

    electron.autoUpdater.emit("update-downloaded", { version: "0.1.7" });
    expect(controller.isUpdateReadyToInstall()).toBe(true);
  });

  it("hands off quitAndInstall without forcing the menu-bar process to exit", async () => {
    const { controller, electron } = await loadController();

    controller.quitAndInstallUpdate();

    await vi.waitFor(() =>
      expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledWith(
        false,
        true,
      ),
    );
    // Native quitAndInstall closes windows and quits the app itself. Forcing
    // either path here can abort the updater handoff.
    electron.nativeSquirrelUpdater.emit("before-quit-for-update");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(electron.app.exit).not.toHaveBeenCalled();
  });

  it("subscribes before quitAndInstall so a synchronous native quit event is not missed", async () => {
    const { controller, electron, sendNotify } = await loadController();

    electron.autoUpdater.quitAndInstall.mockImplementationOnce(() => {
      electron.nativeSquirrelUpdater.emit("before-quit-for-update");
    });

    controller.quitAndInstallUpdate();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(sendNotify).not.toHaveBeenCalledWith(
      "Update install did not start. Try again.",
    );
    expect(electron.app.exit).not.toHaveBeenCalled();
  });

  it("ignores repeated quitAndInstall taps while staging is in flight", async () => {
    const { controller, electron } = await loadController();

    controller.quitAndInstallUpdate();
    controller.quitAndInstallUpdate();

    await vi.waitFor(() =>
      expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1),
    );
  });

  it("resets the quitAndInstall latch if the native handoff never begins", async () => {
    const { controller, electron, sendNotify } = await loadController();

    controller.quitAndInstallUpdate();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateSnapshot().error).toContain("Install handoff");
    expect(sendNotify).toHaveBeenCalledWith(
      "Update install did not start. Try again.",
    );

    controller.quitAndInstallUpdate();
    expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it("resets the quitAndInstall latch if the updater reports an install error", async () => {
    const { controller, electron } = await loadController();

    await controller.manualCheckForUpdates(true);
    electron.autoUpdater.emit("update-available", { version: "0.1.7" });
    electron.autoUpdater.emit("update-downloaded", { version: "0.1.7" });

    controller.quitAndInstallUpdate();
    electron.autoUpdater.emit("error", new Error("native install failed"));
    controller.quitAndInstallUpdate();

    expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(2);
  });
});
