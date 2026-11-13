import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), prepare: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }));
vi.mock("node:fs", () => ({ existsSync: () => true, default: { existsSync: () => true } }));
vi.mock("./helperPaths", () => ({ getHelperPath: () => "/fixture/helper" }));
vi.mock("./contextVocabulary", () => ({ contextDictionary: mocks.prepare, clearContextVocabulary: vi.fn() }));

describe.runIf(process.platform === "darwin")("context helper deadlines", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => { vi.useRealTimers(); });
  async function setup() {
    const worker = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    mocks.spawn.mockReturnValue(worker);
    const service = await import("./screenContext");
    const { screenContextSession: session } = await import("./screenContextSession");
    return { worker, service, session };
  }
  it("returns immediately and kills a stalled worker after two seconds", async () => {
    const { worker, service, session } = await setup();
    expect(service.beginScreenContext("a")).toBeUndefined();
    expect(session.read("a")).toEqual([]);
    vi.advanceTimersByTime(1999);
    expect(worker.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
    expect(session.read("a")).toEqual([]);
    service.stopScreenContext();
  });
  it("cannot add a late OCR result after speech ends", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["LateName"] }) + "\n");
    expect(session.read("a")).toEqual([]);
    expect(mocks.prepare).not.toHaveBeenCalled();
    service.stopScreenContext();
  });
  it("discards ready names on target changes and worker failure", async () => {
    const { worker, service, session } = await setup();
    service.beginScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: ["OpenAI"] }) + "\n");
    expect(session.read("a")).toEqual(["OpenAI"]);
    service.freezeScreenContext("a");
    worker.stdout.emit("data", JSON.stringify({ id: "a", terms: [], status: "target-changed" }) + "\n");
    expect(session.read("a")).toEqual([]);
    worker.emit("exit", 1);
    expect(session.accept("a", ["StaleName"])).toBe(false);
  });
});
