import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  getHelperPath: vi.fn(() => "/tmp/Spoke Helper"),
  spawnHelper: vi.fn(),
  preSpawnPasteHelper: vi.fn(),
  killPasteDaemon: vi.fn(),
  prewarmLocalSidecar: vi.fn(),
  mark: vi.fn(),
  state: {
    mainWindow: null,
    onboardingWindow: null,
    isQuitting: false,
    pttTarget: "auto",
  },
}));

vi.mock("node:fs", () => ({
  default: { existsSync: mocks.existsSync },
  existsSync: mocks.existsSync,
}));
vi.mock("./helperPaths", () => ({ getHelperPath: mocks.getHelperPath }));
vi.mock("./helperProcess", () => ({ spawnHelper: mocks.spawnHelper }));
vi.mock("./pasteDaemon", () => ({
  preSpawnPasteHelper: mocks.preSpawnPasteHelper,
  killPasteDaemon: mocks.killPasteDaemon,
}));
vi.mock("./localSttLifecycle", () => ({
  prewarmLocalSidecar: mocks.prewarmLocalSidecar,
}));
vi.mock("./bootTimeline", () => ({ bootTimeline: { mark: mocks.mark } }));
vi.mock("./windowState", () => ({ state: mocks.state }));
vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { default: { spawn }, spawn };
});

function createFunctionKeyProcess() {
  const stdout = new EventEmitter() as EventEmitter & {
    setEncoding: ReturnType<typeof vi.fn>;
  };
  stdout.setEncoding = vi.fn();

  const process = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: EventEmitter;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  process.stdout = stdout;
  process.stderr = new EventEmitter();
  process.killed = false;
  process.kill = vi.fn();
  return process;
}

describe("fnListener paste pre-spawn", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.mainWindow = null;
    mocks.state.onboardingWindow = null;
    mocks.state.isQuitting = false;
    mocks.state.pttTarget = "auto";
    mocks.existsSync.mockReturnValue(true);
  });

  it("keeps the paste daemon alive after key-up", async () => {
    const functionKeyProcess = createFunctionKeyProcess();
    mocks.spawnHelper.mockReturnValue(functionKeyProcess);
    const { startFnListener } = await import("./fnListener");

    startFnListener();
    functionKeyProcess.stdout.emit("data", "optR-down\noptR-up\n");

    expect(mocks.preSpawnPasteHelper).toHaveBeenCalledOnce();
    expect(mocks.killPasteDaemon).not.toHaveBeenCalled();
    expect(mocks.prewarmLocalSidecar).toHaveBeenCalledWith("ptt-down");
  });
});
