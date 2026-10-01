import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(() => true) }));
vi.mock("child_process", () => ({
  spawn: mocks.spawn,
  default: { spawn: mocks.spawn },
}));
vi.mock("fs", () => ({
  existsSync: mocks.exists,
  default: { existsSync: mocks.exists },
}));
vi.mock("./helperPaths", () => ({ getHelperPath: () => "/helper" }));
import {
  copyViaPasteDaemon,
  inspectViaPasteDaemon,
  insertViaPasteDaemon,
  killPasteDaemon,
  pasteViaDaemon,
  preSpawnPasteHelper,
  respawnPasteDaemon,
} from "./pasteDaemon";
class Helper extends EventEmitter {
  killed = false;
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stdin = {
    destroyed: false,
    write: vi.fn((command: string, callback?: (error?: Error) => void) => {
      callback?.();
      if (this.autoReply) {
        if (command.startsWith("inspect:"))
          this.stdout.emit("data", "read:ok\ntargetPid:42\ninspect-done\n");
        else if (command.startsWith("copy:"))
          this.stdout.emit("data", "clipboard-token:1\ncopy-done\n");
        else if (command.startsWith("restore:"))
          this.stdout.emit("data", "restore-done\n");
        else if (command.startsWith("paste-text:"))
          this.stdout.emit(
            "data",
            "clipboard-token:1\nclipboard-ms:0.2\ndispatch-ms:0.3\npaste-done\n",
          );
        else if (command.startsWith("paste"))
          this.stdout.emit("data", "paste-done\n");
      }
    }),
  };
  autoReply = true;
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}
let children: Helper[];
function ready() {
  preSpawnPasteHelper();
  const child = children.at(-1)!;
  child.stdout.emit("data", "paste-daemon-ready\n");
  return child;
}
beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  mocks.spawn.mockImplementation(() => {
    const child = new Helper();
    children.push(child);
    return child;
  });
  mocks.exists.mockReturnValue(true);
});
afterEach(() => {
  killPasteDaemon();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("persistent paste helper", () => {
  it("copies and posts paste in one request with separate native timings", async () => {
    const child = ready();
    const receipt = await insertViaPasteDaemon("λ\nMCP", 42);
    expect(child.stdin.write.mock.calls.map((call) => call[0])).toEqual([
      `paste-text:42:${Buffer.from("λ\nMCP").toString("base64")}\n`,
    ]);
    expect(receipt.clipboardMs).toBe(0.2);
    expect(receipt.dispatchMs).toBe(0.3);
    await receipt.restoreClipboard();
    expect(child.stdin.write.mock.calls[1][0]).toBe("restore:1\n");
  });
  it("rejects a combined clipboard failure instead of assuming paste", async () => {
    const child = ready();
    child.stdin.write.mockImplementation((_command, callback) => {
      callback?.();
      child.stdout.emit("data", "paste-error\n");
    });
    await expect(insertViaPasteDaemon("Hello", 42)).rejects.toThrow(
      "clipboard write failed",
    );
  });

  it("reuses a live helper across recording starts", async () => {
    ready();
    preSpawnPasteHelper();
    await pasteViaDaemon(42);
    expect(children).toHaveLength(1);
    expect(children[0].stdin.write).toHaveBeenCalledWith(
      "paste-target:42\n",
      expect.any(Function),
    );
  });
  it("keeps a replacement when the old helper exits", async () => {
    const old = ready();
    respawnPasteDaemon();
    const replacement = children[1];
    replacement.stdout.emit("data", "paste-daemon-ready\n");
    old.emit("exit", 0);
    await pasteViaDaemon(42);
    expect(replacement.stdin.write).toHaveBeenCalledWith(
      "paste-target:42\n",
      expect.any(Function),
    );
    expect(children).toHaveLength(2);
  });
  it("buffers split readiness and response lines", async () => {
    preSpawnPasteHelper();
    const child = children[0];
    child.autoReply = false;
    const result = inspectViaPasteDaemon(96);
    child.stdout.emit("data", "paste-daemon-");
    child.stdout.emit("data", "ready\n");
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalled());
    child.stdout.emit("data", "read:ok\ntargetPid:4");
    child.stdout.emit("data", "2\ninspect-do");
    child.stdout.emit("data", "ne\n");
    await expect(result).resolves.toBe("read:ok\ntargetPid:42");
  });
  it("serializes replies even when two callers request at once", async () => {
    ready();
    const one = inspectViaPasteDaemon(96),
      two = pasteViaDaemon(42);
    await Promise.all([one, two]);
    expect(children[0].stdin.write.mock.calls.map((x) => x[0])).toEqual([
      "inspect:96\n",
      "paste-target:42\n",
    ]);
  });
  it("rejects target changes instead of assuming success", async () => {
    const child = ready();
    child.autoReply = false;
    const operation = pasteViaDaemon(42);
    const rejected = expect(operation).rejects.toThrow("target changed");
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalled());
    child.stdout.emit("data", "paste-target-changed\n");
    await rejected;
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
  });
  it("rejects a dispatched timeout and closes the helper without a retry", async () => {
    const child = ready();
    child.autoReply = false;
    const operation = pasteViaDaemon(42);
    const rejected = expect(operation).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(child.kill).toHaveBeenCalled();
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
  });
  it("settles startup failure instead of leaving callers pending", async () => {
    preSpawnPasteHelper();
    const operation = pasteViaDaemon(42);
    const rejected = expect(operation).rejects.toThrow("startup timed out");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(children[0].kill).toHaveBeenCalled();
  });
  it("restores only through the session that saved the clipboard", async () => {
    const old = ready();
    const restore = await copyViaPasteDaemon("λ\nHello");
    expect(old.stdin.write.mock.calls[0][0]).toBe(
      `copy:${Buffer.from("λ\nHello").toString("base64")}\n`,
    );
    respawnPasteDaemon();
    const fresh = children[1];
    fresh.stdout.emit("data", "paste-daemon-ready\n");
    await restore();
    expect(fresh.stdin.write).not.toHaveBeenCalled();
  });
  it("does not treat a clipboard protocol error as success", async () => {
    const child = ready();
    child.stdin.write.mockImplementation((_command, callback) => {
      callback?.();
      child.stdout.emit("data", "copy-error\ncopy-done\n");
    });
    await expect(copyViaPasteDaemon("Hello")).rejects.toThrow(
      "clipboard write failed",
    );
  });
  it("settles a broken input pipe without a paste retry", async () => {
    const child = ready();
    child.stdin.write.mockImplementation((_command, callback) =>
      callback?.(new Error("Broken pipe")),
    );
    await expect(pasteViaDaemon(42)).rejects.toThrow("Broken pipe");
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
  });
  it("settles a helper error before readiness", async () => {
    preSpawnPasteHelper();
    children[0].emit("error", new Error("Cannot launch"));
    // A later request can create a fresh helper; the failed ready promise
    // has a rejection handler even without an awaiting caller.
    const child = ready();
    await expect(pasteViaDaemon(42)).resolves.toBe(true);
    expect(children).toHaveLength(2);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
  });
  it("reports missing helpers without spawning", async () => {
    mocks.exists.mockReturnValue(false);
    await expect(pasteViaDaemon()).rejects.toThrow("unavailable");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
