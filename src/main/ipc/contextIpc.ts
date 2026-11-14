import { ipcMain, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { beginScreenContext, endScreenContext, markScreenContextSpeechStopped, stopScreenContext, prewarmScreenContext } from "../screenContext";
import { state } from "../windowState";
import { saveAppPreferences } from "../preferences";
import { getHelperPath } from "../helperPaths";
import { stopEditLearning } from "../pasteDaemon";
import { beginContextDebug, recordContextDebug, finishContextAudio, registerContextDebugIpc } from "../contextDebug";

let active: { id: string; owner: WebContents; dispose: () => void } | null = null;
const validId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,80}$/u.test(id);

export function ownsScreenContext(owner: WebContents, id?: string): string | undefined {
  return active?.owner === owner && active.id === id ? id : undefined;
}

export function registerContextIpc(): void {
  registerContextDebugIpc();
  ipcMain.on("context:begin", (event, id: unknown) => {
    if (!validId(id)) return;
    stopEditLearning();
    active?.dispose();
    beginContextDebug(id, { screenContext: state.appPreferences.screenContextEnabled !== false, learnFromEdits: state.appPreferences.learnFromEdits !== false });
    const owner = event.sender;
    const dispose = () => {
      if (active?.id !== id || active.owner !== owner) return;
      endScreenContext(id);
      finishContextAudio(id);
      recordContextDebug(id, "end", {});
      active = null;
      if (!owner.isDestroyed()) {
        owner.removeListener("destroyed", dispose);
        owner.removeListener("render-process-gone", dispose);
        owner.removeListener("did-start-loading", dispose);
      }
    };
    active = { id, owner, dispose };
    owner.once("destroyed", dispose);
    owner.once("render-process-gone", dispose);
    owner.once("did-start-loading", dispose);
    if (state.appPreferences.screenContextEnabled !== false) beginScreenContext(id);
  });
  ipcMain.on("context:freeze", (event, id: string) => {
    if (ownsScreenContext(event.sender, id)) markScreenContextSpeechStopped(id);
  });
  ipcMain.on("context:outcome", (event, id: string, text: unknown) => {
    if (ownsScreenContext(event.sender, id) && typeof text === "string") recordContextDebug(id, "renderer-final", { text: text.slice(0, 20_000) });
  });
  ipcMain.on("context:end", (event, id: string) => {
    if (ownsScreenContext(event.sender, id)) active?.dispose();
  });
  const settings = () => ({
    screenContext: state.appPreferences.screenContextEnabled !== false,
    learnFromEdits: state.appPreferences.learnFromEdits !== false,
  });
  ipcMain.handle("context:settings", () => settings());
  ipcMain.handle("context:set-settings", (_event, value: { screenContext?: boolean; learnFromEdits?: boolean }) => {
    const previous = { ...state.appPreferences };
    if (typeof value?.screenContext === "boolean") state.appPreferences.screenContextEnabled = value.screenContext;
    if (typeof value?.learnFromEdits === "boolean") state.appPreferences.learnFromEdits = value.learnFromEdits;
    if (!saveAppPreferences(state.appPreferences)) state.appPreferences = previous;
    if (state.appPreferences.screenContextEnabled === false) { active?.dispose(); stopScreenContext(); }
    else prewarmScreenContext();
    if (state.appPreferences.learnFromEdits === false) stopEditLearning();
    return settings();
  });
  // Only a user click requests the optional OS permission. Never prompt while recording.
  ipcMain.handle("context:request-screen", () => new Promise<boolean>((resolve) => {
    const child = spawn(getHelperPath(), ["--ask-screen"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 60_000);
    child.stdout.on("data", (chunk: Buffer) => { if (output.length < 1024) output += chunk.toString(); });
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", () => { clearTimeout(timer); resolve(output.includes("screen-granted")); });
  }));
}
