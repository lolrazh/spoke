/**
 * Helper Process Registry
 *
 * Tracks the native "Spoke Helper" child processes spawned for the Fn/PTT
 * listener and for one-off paste operations, so app shutdown can force-kill
 * any that are still alive.
 */

import { spawn, type ChildProcess } from "child_process";

export const fnHelpers = new Set<ChildProcess>();
export const pasteHelpers = new Set<ChildProcess>();

export function spawnHelper(
  path: string,
  args: string[] = [],
  isFnHelper: boolean,
): ChildProcess {
  const proc = spawn(path, args, { stdio: "pipe", detached: false });
  const helperSet = isFnHelper ? fnHelpers : pasteHelpers;
  helperSet.add(proc);
  proc.once("exit", () => helperSet.delete(proc));
  return proc;
}
