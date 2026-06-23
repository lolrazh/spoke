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
