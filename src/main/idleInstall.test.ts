import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createIdleInstaller,
  IDLE_INSTALL_AFTER_S,
  IDLE_INSTALL_POLL_MS,
  LOCKED_INSTALL_AFTER_S,
} from "./idleInstall";

function setup() {
  const env = { idle: 0, locked: false, busy: false };
  const install = vi.fn();
  const installer = createIdleInstaller({
    idleSeconds: () => env.idle,
    isScreenLocked: () => env.locked,
    isBusy: () => env.busy,
    install,
  });
  const poll = () => vi.advanceTimersByTime(IDLE_INSTALL_POLL_MS);
  return { env, install, installer, poll };
}

const READY = { readyToInstall: true, version: "0.1.35" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("idle auto-install", () => {
  it("installs a ready update after ten minutes without input", () => {
    const { env, install, installer, poll } = setup();
    installer.update(READY);
    env.idle = IDLE_INSTALL_AFTER_S - 1;
    poll();
    expect(install).not.toHaveBeenCalled();
    env.idle = IDLE_INSTALL_AFTER_S;
    poll();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("installs a minute after the screen locks", () => {
    const { env, install, installer, poll } = setup();
    installer.update(READY);
    env.locked = true;
    env.idle = LOCKED_INSTALL_AFTER_S - 1;
    poll();
    expect(install).not.toHaveBeenCalled();
    env.idle = LOCKED_INSTALL_AFTER_S;
    poll();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("waits while Spoke is busy, then installs", () => {
    const { env, install, installer, poll } = setup();
    installer.update(READY);
    env.idle = IDLE_INSTALL_AFTER_S;
    env.busy = true;
    poll();
    expect(install).not.toHaveBeenCalled();
    env.busy = false;
    poll();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("does nothing until an update is ready", () => {
    const { env, install, installer, poll } = setup();
    env.idle = IDLE_INSTALL_AFTER_S;
    installer.update({ readyToInstall: false, version: "0.1.35" });
    poll();
    expect(install).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling when the update is no longer ready", () => {
    const { env, install, installer, poll } = setup();
    installer.update(READY);
    installer.update({ readyToInstall: false, version: null });
    env.idle = IDLE_INSTALL_AFTER_S;
    poll();
    expect(install).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tries each version once, so a failed handoff cannot loop", () => {
    const { env, install, installer, poll } = setup();
    env.idle = IDLE_INSTALL_AFTER_S;
    installer.update(READY);
    poll();
    // The handoff was abandoned and the update is still ready.
    installer.update(READY);
    poll();
    poll();
    expect(install).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    installer.update({ readyToInstall: true, version: "0.1.36" });
    poll();
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("keeps a single poll across repeated ready snapshots", () => {
    const { installer } = setup();
    installer.update(READY);
    installer.update(READY);
    expect(vi.getTimerCount()).toBe(1);
    installer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
