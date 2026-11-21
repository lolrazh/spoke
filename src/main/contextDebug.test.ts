import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ app: { isPackaged: false, getPath: () => "/tmp/spoke-test" }, start: vi.fn() }));
vi.mock("electron", () => ({ app: mocks.app, ipcMain: {}, shell: {} }));
vi.mock("./contextDebugStore", () => ({ ContextDebugStore: class { start = mocks.start; } }));
import { startDevelopmentContextDebug } from "./contextDebug";

beforeEach(() => { vi.clearAllMocks(); mocks.app.isPackaged = false; mocks.start.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("development context test recording", () => {
  it("does not record without an explicit test label", async () => {
    vi.stubEnv("SPOKE_CONTEXT_TEST_SET", "");
    await startDevelopmentContextDebug();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("ignores launch flags in packaged apps", async () => {
    mocks.app.isPackaged = true;
    vi.stubEnv("SPOKE_CONTEXT_TEST_SET", "Local test");
    await startDevelopmentContextDebug();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("keeps audio opt-in separate from screen traces", async () => {
    vi.stubEnv("SPOKE_CONTEXT_TEST_SET", "Local test");
    vi.stubEnv("SPOKE_CONTEXT_TEST_AUDIO", "");
    await startDevelopmentContextDebug();
    expect(mocks.start).toHaveBeenLastCalledWith("Local test", false);
    vi.stubEnv("SPOKE_CONTEXT_TEST_AUDIO", "1");
    await startDevelopmentContextDebug();
    expect(mocks.start).toHaveBeenLastCalledWith("Local test", true);
  });
});
