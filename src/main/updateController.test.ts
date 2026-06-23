import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockElectron = {
  app: {
    isPackaged: boolean;
    getVersion: ReturnType<typeof vi.fn>;
  };
  autoUpdater: EventEmitter & {
    setFeedURL: ReturnType<typeof vi.fn>;
    checkForUpdates: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  };
};

async function loadController(
  options: { packaged?: boolean; version?: string } = {},
) {
  vi.resetModules();

  const fetchMock = vi.fn(async () => ({
    status: 503,
    statusText: "Service Unavailable",
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const autoUpdater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  });
  const app = {
    isPackaged: options.packaged ?? true,
    getVersion: vi.fn(() => options.version ?? "0.1.4"),
  };

  vi.doMock("electron", () => ({ app, autoUpdater }));

  const controller = await import("./updateController");
  const sendNotify = vi.fn();
  const rebuildTrayMenu = vi.fn();
  controller.initUpdateController({ sendNotify, rebuildTrayMenu });

  return {
    controller,
    electron: { app, autoUpdater } satisfies MockElectron,
    fetchMock,
    sendNotify,
    rebuildTrayMenu,
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
    vi.resetModules();
  });

  it("configures the arch-specific feed and starts a manual check", async () => {
    const { controller, electron, sendNotify } = await loadController({
      version: "0.1.4",
    });

    await controller.manualCheckForUpdates(false);

    expect(electron.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: "https://update.electronjs.org/lolrazh/spoke/darwin-arm64/0.1.4",
    });
    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(controller.getUpdateStatus()).toBe("checking");
    expect(sendNotify).toHaveBeenCalledWith("Checking for updates…");
  });

  it("announces an available update immediately after feed preflight", async () => {
    const { controller, electron, fetchMock, sendNotify } =
      await loadController({
        version: "0.1.4",
      });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      json: async () => ({ name: "v0.1.7" }),
    });

    await controller.manualCheckForUpdates(false);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://update.electronjs.org/lolrazh/spoke/darwin-arm64/0.1.4",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.getUpdateAvailableVersion()).toBe("v0.1.7");
    expect(controller.isUpdateReadyToInstall()).toBe(false);
    expect(sendNotify.mock.calls.map((call) => call[0])).toEqual([
      "Checking for updates…",
      "Update found. Downloading…",
    ]);
    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    electron.autoUpdater.emit("checking-for-update");
    expect(controller.getUpdateStatus()).toBe("available");

    electron.autoUpdater.emit("update-available");
    expect(
      sendNotify.mock.calls.filter(
        (call) => call[0] === "Update found. Downloading…",
      ),
    ).toHaveLength(1);
  });

  it("reports up to date immediately when feed preflight finds no update", async () => {
    const { controller, electron, fetchMock, sendNotify } =
      await loadController();
    fetchMock.mockResolvedValueOnce({
      status: 204,
      statusText: "No Content",
      json: async () => ({}),
    });

    await controller.manualCheckForUpdates(false);

    expect(controller.getUpdateStatus()).toBe("not-available");
    expect(sendNotify.mock.calls.map((call) => call[0])).toEqual([
      "Checking for updates…",
      "You're up to date.",
    ]);
    expect(electron.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("does not start another check while an update is downloading", async () => {
    const { controller, electron, fetchMock, sendNotify } =
      await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available");
    await controller.manualCheckForUpdates(false);

    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendNotify).toHaveBeenLastCalledWith("Update found. Downloading…");
    expect(controller.getUpdateStatus()).toBe("available");
  });

  it("notifies manual checks when the app is already up to date", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-not-available");

    expect(controller.getUpdateStatus()).toBe("not-available");
    expect(sendNotify).toHaveBeenCalledWith("You're up to date.");
  });

  it("tracks available and downloaded update states", async () => {
    const { controller, electron, sendNotify } = await loadController();

    await controller.manualCheckForUpdates(false);
    electron.autoUpdater.emit("update-available");
    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.isUpdateReadyToInstall()).toBe(false);
    expect(sendNotify).toHaveBeenCalledWith("Update found. Downloading…");

    electron.autoUpdater.emit("update-downloaded", {}, null, "v0.1.5");
    expect(controller.getUpdateStatus()).toBe("available");
    expect(controller.getUpdateAvailableVersion()).toBe("v0.1.5");
    expect(controller.isUpdateReadyToInstall()).toBe(true);
    expect(sendNotify).toHaveBeenCalledWith(
      "Update ready. Restart to install.",
    );
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
});
