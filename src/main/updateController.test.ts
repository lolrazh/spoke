import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockAutoUpdater = EventEmitter & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
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
    quitAndInstall: vi.fn(),
  }) as MockAutoUpdater;

  const app = {
    isPackaged: options.packaged ?? true,
    getVersion: vi.fn(() => options.version ?? "0.1.4"),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
  };

  vi.doMock("electron", () => ({ app }));
  vi.doMock("electron-updater", () => ({ autoUpdater }));

  const controller = await import("./updateController");
  const sendNotify = vi.fn();
  const rebuildTrayMenu = vi.fn();
  const onStateChange = vi.fn();
  controller.initUpdateController({ sendNotify, rebuildTrayMenu, onStateChange });

  return {
    controller,
    electron: { app, autoUpdater } satisfies MockElectron,
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
    expect(electron.autoUpdater.autoDownload).toBe(true);
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
    expect(controller.getUpdateAvailableVersion()).toBe("0.1.7");
    expect(controller.isUpdateReadyToInstall()).toBe(false);
    expect(sendNotify.mock.calls.map((call) => call[0])).toEqual([
      "Update found. Downloading…",
    ]);
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

  it("marks the update ready once it finishes downloading", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available", { version: "0.1.5" });
    electron.autoUpdater.emit("download-progress", { percent: 50 });
    electron.autoUpdater.emit("update-downloaded", { version: "0.1.5" });

    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.isUpdateReadyToInstall()).toBe(true);
    expect(controller.getUpdateAvailableVersion()).toBe("0.1.5");
    expect(controller.getUpdateSnapshot().downloadPercent).toBe(100);
    expect(sendNotify).toHaveBeenCalledWith(
      "Update ready. Restart to install.",
    );
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
    expect(sendNotify).toHaveBeenLastCalledWith("Update found. Downloading…");
    expect(controller.getUpdateStatus()).toBe("downloading");
  });

  it("recovers from a check that never emits an updater result", async () => {
    const { controller, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(controller.getUpdateStatus()).toBe("error");
    expect(controller.getUpdateError()).toContain("No updater response");
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
    expect(controller.getUpdateError()).toContain("stalled");
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
    expect(controller.getUpdateError()).toBe(
      "The command is disabled and cannot be executed",
    );
    expect(sendNotify).toHaveBeenCalledWith(
      "Update check failed: The command is disabled and cannot be executed",
    );
  });

  it("previews the ready state only in development builds", async () => {
    const packaged = await loadController({ packaged: true });
    expect(packaged.controller.setDevUpdateStateForTesting("ready")).toEqual({
      ok: false,
      snapshot: {
        status: "idle",
        version: null,
        readyToInstall: false,
        error: null,
        downloadPercent: null,
      },
      error: "Dev update state is unavailable in packaged builds",
    });

    const dev = await loadController({ packaged: false, version: "0.1.7" });
    const result = dev.controller.setDevUpdateStateForTesting("ready");

    expect(result.ok).toBe(true);
    expect(result.snapshot).toEqual({
      status: "available",
      version: "v0.1.7-dev",
      readyToInstall: true,
      error: null,
      downloadPercent: 100,
    });
    expect(dev.rebuildTrayMenu).toHaveBeenCalled();
  });

  it("previews the downloading state with a percent", async () => {
    const dev = await loadController({ packaged: false, version: "0.1.7" });
    const result = dev.controller.setDevUpdateStateForTesting("downloading");

    expect(result.ok).toBe(true);
    expect(result.snapshot).toEqual({
      status: "downloading",
      version: "v0.1.7-dev",
      readyToInstall: false,
      error: null,
      downloadPercent: 42,
    });
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

  it("installs via quitAndInstall and force-quits the menu-bar process", async () => {
    const { controller, electron } = await loadController();

    controller.quitAndInstallUpdate();

    expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });
});
