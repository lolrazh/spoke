/** One persistent native paste helper. Commands and replies are serialized. */
import * as fs from "fs";
import { performance } from "node:perf_hooks";
import { spawn, type ChildProcess } from "child_process";
import { getHelperPath } from "./helperPaths";

type PendingCommand = {
  lines: string[];
  end: string;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Session = {
  child: ChildProcess;
  ready: Promise<void>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  buffer: string;
  pending: PendingCommand | null;
  closed: boolean;
  tail: Promise<unknown>;
  reads: Set<string>;
  readWaiters: Map<string, (read: boolean) => void>;
};
let session: Session | null = null;
const READY_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 500;

function closeSession(current: Session, error: Error): void {
  if (current.closed) return;
  current.closed = true;
  for (const settle of current.readWaiters.values()) settle(false);
  current.readWaiters.clear();
  current.reads.clear();
  current.readyReject(error);
  const pending = current.pending;
  current.pending = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  // An old process must never clear a replacement's state.
  if (session === current) session = null;
}

export function preSpawnPasteHelper(): void {
  if (session && !session.closed && !session.child.killed) return;
  const path = getHelperPath();
  if (!fs.existsSync(path)) return;
  const started = performance.now();
  const child = spawn(path, ["--mode=paste-daemon"], {
    stdio: "pipe",
    detached: false,
  });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Preparation can fail before a caller awaits readiness.
  void ready.catch(() => undefined);
  const current: Session = {
    child,
    ready,
    readyResolve,
    readyReject,
    buffer: "",
    pending: null,
    closed: false,
    tail: Promise.resolve(),
    reads: new Set(),
    readWaiters: new Map(),
  };
  session = current;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    current.buffer += chunk.toString();
    let end: number;
    while ((end = current.buffer.indexOf("\n")) !== -1) {
      const line = current.buffer.slice(0, end).replace(/\r$/u, "");
      current.buffer = current.buffer.slice(end + 1);
      if (line === "paste-daemon-ready") {
        console.info("[Latency] Paste helper ready", {
          setup_ms: Math.round((performance.now() - started) * 1000) / 1000,
        });
        current.readyResolve();
      }
      const read = line.match(/^clipboard-read:(\d+)$/u);
      if (read) {
        const token = read[1];
        const settle = current.readWaiters.get(token);
        if (settle) settle(true);
        else {
          current.reads.add(token);
          if (current.reads.size > 64) {
            const oldest = current.reads.values().next().value;
            if (oldest !== undefined) current.reads.delete(oldest);
          }
        }
        continue;
      }
      const pending = current.pending;
      if (!pending) continue;
      if (line === "paste-target-changed" || line === "paste-error") {
        clearTimeout(pending.timer);
        current.pending = null;
        pending.reject(
          new Error(
            line === "paste-error"
              ? "Native clipboard write failed."
              : "Paste target changed before insertion.",
          ),
        );
      } else if (line === pending.end) {
        clearTimeout(pending.timer);
        current.pending = null;
        pending.resolve(pending.lines.join("\n"));
      } else pending.lines.push(line);
    }
  });
  child.once("error", (error) => closeSession(current, error));
  child.once("exit", () =>
    closeSession(current, new Error("Paste helper exited.")),
  );
}

async function request(command: string, end: string): Promise<string> {
  preSpawnPasteHelper();
  const current = session;
  if (!current) throw new Error("Paste helper is unavailable.");
  const operation = current.tail.then(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        current.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Paste helper startup timed out.")),
            READY_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      closeSession(
        current,
        error instanceof Error ? error : new Error(String(error)),
      );
      current.child.kill();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (current.closed || current.child.killed)
      throw new Error("Paste helper is unavailable.");
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Late replies cannot be assigned to another command. No retry after
        // dispatch: a timeout may mean the paste occurred without an ACK.
        const error = new Error("Paste helper command timed out.");
        closeSession(current, error);
        current.child.kill();
      }, COMMAND_TIMEOUT_MS);
      current.pending = { lines: [], end, resolve, reject, timer };
      try {
        if (!current.child.stdin || current.child.stdin.destroyed)
          throw new Error("Paste helper input closed.");
        current.child.stdin.write(command + "\n", (error) => {
          if (error) {
            closeSession(current, error);
            current.child.kill();
          }
        });
      } catch (error) {
        closeSession(
          current,
          error instanceof Error ? error : new Error(String(error)),
        );
        current.child.kill();
      }
    });
  });
  current.tail = operation.catch(() => undefined);
  return operation;
}

export async function inspectViaPasteDaemon(
  contextChars: number,
): Promise<string> {
  return request(`inspect:${contextChars}`, "inspect-done");
}

/** Native snapshot preserves all clipboard formats; restoration uses changeCount. */
export async function copyViaPasteDaemon(
  text: string,
): Promise<() => Promise<void>> {
  preSpawnPasteHelper();
  const owner = session;
  const output = await request(
    `copy:${Buffer.from(text, "utf8").toString("base64")}`,
    "copy-done",
  );
  return clipboardRestorer(output, owner);
}

function clipboardRestorer(
  output: string,
  owner: Session | null,
): () => Promise<void> {
  const match = output.match(/^clipboard-token:(\d+)$/mu);
  if (!match) throw new Error("Native clipboard write failed.");
  return async () => {
    if (owner && session === owner && !owner.closed && !owner.child.killed)
      await request(`restore:${match[1]}`, "restore-done");
  };
}

export const CLIPBOARD_READ_TIMEOUT_MS = 2000;
function observeClipboardRead(
  output: string,
  owner: Session | null,
): Promise<boolean> {
  const token = output.match(/^clipboard-token:(\d+)$/mu)?.[1];
  if (!token || !owner || owner.closed) return Promise.resolve(false);
  if (owner.reads.delete(token)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (read: boolean) => {
      clearTimeout(timer);
      owner.readWaiters.delete(token);
      resolve(read);
    };
    const timer = setTimeout(() => settle(false), CLIPBOARD_READ_TIMEOUT_MS);
    timer.unref?.();
    owner.readWaiters.set(token, settle);
  });
}

/** Copy and dispatch share one native request; phase timings use one native clock. */
export async function insertViaPasteDaemon(
  text: string,
  targetPid: number,
): Promise<{
  restoreClipboard: () => Promise<void>;
  clipboardRead: Promise<boolean>;
  clipboardMs: number | null;
  dispatchMs: number | null;
}> {
  if (!Number.isInteger(targetPid) || targetPid <= 0)
    throw new Error("Paste target is unavailable.");
  preSpawnPasteHelper();
  const owner = session;
  const output = await request(
    `paste-text:${targetPid}:${Buffer.from(text, "utf8").toString("base64")}`,
    "paste-done",
  );
  const phase = (name: string) => {
    const value = output.match(new RegExp(`^${name}-ms:([0-9.]+)$`, "mu"));
    return value && Number.isFinite(Number(value[1])) ? Number(value[1]) : null;
  };
  return {
    restoreClipboard: clipboardRestorer(output, owner),
    clipboardRead: observeClipboardRead(output, owner),
    clipboardMs: phase("clipboard"),
    dispatchMs: phase("dispatch"),
  };
}

/** ACK means keyboard events posted, not that the app displayed the text. */
export async function pasteViaDaemon(targetPid?: number): Promise<boolean> {
  await request(
    targetPid ? `paste-target:${targetPid}` : "paste",
    "paste-done",
  );
  return true;
}

export function killPasteDaemon(): void {
  const current = session;
  if (!current) return;
  closeSession(current, new Error("Paste helper stopped."));
  try {
    current.child.stdin?.write("exit\n");
  } catch {
    /* already closed */
  }
  const timer = setTimeout(() => {
    if (!current.child.killed) current.child.kill("SIGKILL");
  }, 500);
  timer.unref?.();
  current.child.once("exit", () => clearTimeout(timer));
}

export function respawnPasteDaemon(): void {
  killPasteDaemon();
  preSpawnPasteHelper();
}
