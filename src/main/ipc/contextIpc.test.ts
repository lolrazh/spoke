import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
const mocks = vi.hoisted(() => ({
  on: new Map<string, (...args: any[]) => any>(), handlers: new Map<string, (...args: any[]) => any>(),
  warm: vi.fn(), begin: vi.fn(), end: vi.fn(), freeze: vi.fn(), stop: vi.fn(), stopLearning: vi.fn(), save: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: {
  on: (name: string, fn: (...args: any[]) => any) => mocks.on.set(name, fn),
  handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn),
} }));
vi.mock("../screenContext", () => ({ beginScreenContext: mocks.begin, endScreenContext: mocks.end, freezeScreenContext: mocks.freeze, stopScreenContext: mocks.stop, prewarmScreenContext: mocks.warm }));
vi.mock("../pasteDaemon", () => ({ stopEditLearning: mocks.stopLearning }));
vi.mock("../preferences", () => ({ saveAppPreferences: mocks.save }));
vi.mock("../helperPaths", () => ({ getHelperPath: () => "/unused/helper" }));
import { state } from "../windowState";
import { registerContextIpc, ownsScreenContext } from "./contextIpc";

function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as WebContents; }
describe("context IPC ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); state.appPreferences = {}; mocks.save.mockReturnValue(true); registerContextIpc(); });
  it("ignores another window's freeze and end requests, and cleans up on reload", () => {
    const a = owner(), b = owner();
    mocks.on.get("context:begin")!({ sender: a }, "speech");
    expect(ownsScreenContext(b, "speech")).toBeUndefined();
    mocks.on.get("context:freeze")!({ sender: b }, "speech");
    mocks.on.get("context:end")!({ sender: b }, "speech");
    expect(mocks.freeze).not.toHaveBeenCalled();
    expect(ownsScreenContext(a, "speech")).toBe("speech");
    a.emit("did-start-loading");
    expect(ownsScreenContext(a, "speech")).toBeUndefined();
    expect(mocks.end).toHaveBeenCalledWith("speech");
    expect(a.listenerCount("destroyed")).toBe(0);
  });
  it("still stops edit watching when screen context is disabled", () => {
    state.appPreferences.screenContextEnabled = false;
    const a = owner();
    mocks.on.get("context:begin")!({ sender: a }, "disabled");
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.stopLearning).toHaveBeenCalledOnce();
    mocks.on.get("context:end")!({ sender: a }, "disabled");
  });
  it("prepares the worker when enabled and stops it when disabled", () => {
    mocks.handlers.get("context:set-settings")!({}, { screenContext: true });
    expect(mocks.warm).toHaveBeenCalledOnce();
    mocks.handlers.get("context:set-settings")!({}, { screenContext: false });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("rolls back settings when persistence fails", () => {
    mocks.save.mockReturnValue(false);
    const result = mocks.handlers.get("context:set-settings")!({}, { screenContext: false, learnFromEdits: false });
    expect(result).toEqual({ screenContext: true, learnFromEdits: true });
    expect(state.appPreferences).toEqual({});
  });
});
