import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";

import { LocalStreamIpcController } from "./localStreamIpcController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createOwner(id = 1) {
  const emitter = new EventEmitter() as EventEmitter & {
    id: number;
    isDestroyed: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  emitter.id = id;
  emitter.isDestroyed = vi.fn(() => false);
  emitter.send = vi.fn();
  return emitter as unknown as WebContents;
}

function createSession() {
  return {
    push: vi.fn(async () => undefined),
    finish: vi.fn(async () => ({ text: "final", metrics: {} })),
    cancel: vi.fn(),
  };
}

describe("LocalStreamIpcController", () => {
  it("releases a pending stream when its renderer document reloads", async () => {
    const first = deferred<ReturnType<typeof createSession>>();
    const secondSession = createSession();
    const begin = vi
      .fn()
      .mockImplementationOnce((_partial, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        return first.promise;
      })
      .mockResolvedValueOnce(secondSession);
    const abortBatch = vi.fn();
    const controller = new LocalStreamIpcController(
      begin,
      abortBatch,
      vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second"),
    );
    const owner = createOwner();

    const staleStart = controller.start(owner);
    owner.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });

    const replacement = await controller.start(owner);
    expect(replacement).toEqual({ sessionId: "second" });
    expect(begin.mock.calls[0][1].aborted).toBe(true);
    expect(abortBatch).not.toHaveBeenCalled();

    const staleSession = createSession();
    first.resolve(staleSession);
    await expect(staleStart).rejects.toThrow("cancelled during startup");
    expect(staleSession.cancel).toHaveBeenCalledOnce();
  });

  it("cancels an active stream on renderer reload and permits a new one", async () => {
    const firstSession = createSession();
    const secondSession = createSession();
    const controller = new LocalStreamIpcController(
      vi
        .fn()
        .mockResolvedValueOnce(firstSession)
        .mockResolvedValueOnce(secondSession),
      vi.fn(),
      vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second"),
    );
    const owner = createOwner();

    await controller.start(owner);
    owner.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });

    expect(firstSession.cancel).toHaveBeenCalledOnce();
    await expect(controller.start(owner)).resolves.toEqual({
      sessionId: "second",
    });
  });

  it("does not cancel for a same-document navigation", async () => {
    const session = createSession();
    const controller = new LocalStreamIpcController(
      vi.fn().mockResolvedValue(session),
      vi.fn(),
      () => "stream",
    );
    const owner = createOwner();

    await controller.start(owner);
    owner.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: true,
    });

    await expect(controller.finish(owner, "stream")).resolves.toEqual({
      text: "final",
      metrics: {},
    });
    expect(session.cancel).not.toHaveBeenCalled();
  });

  it("clears and cancels a stream when pushing audio fails", async () => {
    const session = createSession();
    session.push.mockRejectedValueOnce(new Error("sidecar write failed"));
    const controller = new LocalStreamIpcController(
      vi.fn().mockResolvedValue(session),
      vi.fn(),
      () => "stream",
    );
    const owner = createOwner();

    await controller.start(owner);
    await expect(
      controller.push(owner, "stream", new Uint8Array([1, 0])),
    ).rejects.toThrow("sidecar write failed");

    expect(session.cancel).toHaveBeenCalledOnce();
    await expect(controller.start(owner)).resolves.toEqual({
      sessionId: "stream",
    });
  });
});
