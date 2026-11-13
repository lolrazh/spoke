import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), receive: vi.fn(), invalidate: vi.fn(), enabled: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }));
vi.mock("fs", () => ({ existsSync: () => true, default: { existsSync: () => true } }));
vi.mock("./helperPaths", () => ({ getHelperPath: () => "/fixture/helper" }));
vi.mock("./editLearning", () => ({ editLearningEnabled: mocks.enabled, invalidateEditLearning: mocks.invalidate, receiveVerifiedEdit: mocks.receive }));

describe("paste and edit event separation", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.enabled.mockReturnValue(true); });
  async function setup() {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn(), killed: false });
    const writes: string[] = [];
    child.stdin.on("data", chunk => writes.push(chunk.toString()));
    mocks.spawn.mockReturnValue(child);
    const daemon = await import("./pasteDaemon");
    daemon.preSpawnPasteHelper();
    child.stdout.emit("data", "paste-daemon-ready\n");
    return { child, writes, daemon };
  }
  it("completes paste on ACK without waiting for verification or learning", async () => {
    const { child, writes, daemon } = await setup();
    const pasted = daemon.insertViaPasteDaemon("hello", 42);
    await vi.waitFor(() => expect(writes.some(line => line.startsWith("paste-learn:42:"))).toBe(true));
    child.stdout.emit("data", 'learning:{"verified":true,"id":"older-paste"}\nclipboard-token:7\nclipboard-read:7\npaste-done\n');
    const result = await pasted;
    expect(await result.clipboardRead).toBe(true);
    expect(mocks.receive).toHaveBeenCalledWith({ verified: true, id: "older-paste" });
    daemon.stopEditLearning();
    expect(writes.at(-1)).toBe("stop-learning\n");
    child.emit("exit");
  });
  it("does not start native observation when learning is disabled", async () => {
    const { child, writes, daemon } = await setup();
    mocks.enabled.mockReturnValue(false);
    const pasted = daemon.insertViaPasteDaemon("hello", 42);
    await vi.waitFor(() => expect(writes.some(line => line.startsWith("paste-text:42:"))).toBe(true));
    child.stdout.emit("data", "clipboard-token:1\nclipboard-read:1\npaste-done\n");
    await pasted;
    expect(writes.some(line => line.startsWith("paste-learn:"))).toBe(false);
    child.emit("exit");
  });
});
