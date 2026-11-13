import { app, ipcMain, shell } from "electron";
import path from "node:path";
import { ContextDebugStore } from "./contextDebugStore";

let store: ContextDebugStore | undefined;
const getStore = () => store ??= new ContextDebugStore(path.join(app.getPath("userData"), "context-debug"));

export function beginContextDebug(id: string, data: Record<string, unknown>): boolean { return store?.begin(id, data) ?? false; }
export function contextDebugEnabled(id?: string): boolean { return store?.has(id) ?? false; }
export function recordContextDebug(id: string | undefined, stage: string, data: Record<string, unknown>): void { store?.record(id, stage, data); }
export function recordContextAudio(id: string | undefined, pcm: Buffer): void { store?.appendAudio(id, pcm); }
export function finishContextAudio(id?: string): void { store?.flushAudio(id); }
export function recordNativeContextDebug(id: string, value: Record<string, unknown>): void {
  if (!store?.has(id)) return;
  const { png, ...details } = value;
  store.record(id, "native-context", details);
  store.image(id, png);
}

export function registerContextDebugIpc(): void {
  ipcMain.handle("context-debug:start", async (_event, label: unknown, audio: unknown) => {
    await getStore().start(typeof label === "string" ? label : "Context test", audio === true);
    return getStore().overview();
  });
  ipcMain.handle("context-debug:stop", () => { getStore().stop(); return getStore().overview(); });
  ipcMain.handle("context-debug:overview", (_event, setId?: string) => getStore().overview(setId));
  ipcMain.handle("context-debug:read", (_event, setId: string, id: string) => getStore().read(setId, id));
  ipcMain.handle("context-debug:annotate", (_event, setId: string, id: string, expected: unknown, notes: unknown) => getStore().annotate(setId, id, typeof expected === "string" ? expected : "", typeof notes === "string" ? notes : ""));
  ipcMain.handle("context-debug:remove", (_event, setId: string, id: string) => getStore().remove(setId, id));
  ipcMain.handle("context-debug:open", async (_event, setId?: string) => {
    const error = await shell.openPath(getStore().folder(setId));
    if (error) throw new Error(error);
  });
}
