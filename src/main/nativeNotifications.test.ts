import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const created: MockNotification[] = [];
const isSupported = vi.fn(() => true);

class MockNotification extends EventEmitter {
  show = vi.fn();
  constructor(public options: Record<string, unknown>) {
    super();
    created.push(this);
  }
  static isSupported() {
    return isSupported();
  }
}

vi.mock("electron", () => ({ Notification: MockNotification }));

async function loadModule() {
  vi.resetModules();
  return import("./nativeNotifications");
}

describe("nativeNotifications", () => {
  beforeEach(() => {
    created.length = 0;
    isSupported.mockReset();
    isSupported.mockReturnValue(true);
  });

  it("shows a titled notification and retains it until it is closed", async () => {
    const mod = await loadModule();
    mod.showNativeNotification("Update ready. Restart to update");

    expect(created).toHaveLength(1);
    expect(created[0].options).toMatchObject({
      title: "Spoke",
      body: "Update ready. Restart to update",
    });
    expect(created[0].show).toHaveBeenCalledOnce();
    expect(mod.retainedNotificationCount()).toBe(1);

    created[0].emit("close", {});
    expect(mod.retainedNotificationCount()).toBe(0);
  });

  it("releases on click", async () => {
    const mod = await loadModule();
    mod.showNativeNotification("Downloading update");
    created[0].emit("click", {});
    expect(mod.retainedNotificationCount()).toBe(0);
  });

  it("logs and releases when macOS rejects the notification", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadModule();
    mod.showNativeNotification("You're up to date.");

    created[0].emit("failed", {}, "Notifications are not allowed");

    expect(mod.retainedNotificationCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Notifications are not allowed"),
    );
    warn.mockRestore();
  });

  it("bounds the number of retained notifications", async () => {
    const mod = await loadModule();
    for (let i = 0; i < 20; i += 1) mod.showNativeNotification(`n${i}`);
    expect(mod.retainedNotificationCount()).toBe(8);
  });

  it("does nothing when notifications are unsupported", async () => {
    isSupported.mockReturnValue(false);
    const mod = await loadModule();
    mod.showNativeNotification("ignored");
    expect(created).toHaveLength(0);
  });

  it("primes the presenter through isSupported", async () => {
    const mod = await loadModule();
    mod.primeNativeNotifications();
    expect(isSupported).toHaveBeenCalledOnce();
  });
});
