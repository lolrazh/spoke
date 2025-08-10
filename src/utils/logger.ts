type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, ...args: unknown[]) {
  const prefix = `[${scope}]`;
  // eslint-disable-next-line no-console
  (console as any)[level](prefix, ...args);
}

export function createLogger(scope: string) {
  return {
    info: (...args: unknown[]) => emit("info", scope, ...args),
    warn: (...args: unknown[]) => emit("warn", scope, ...args),
    error: (...args: unknown[]) => emit("error", scope, ...args),
  };
}

export const logger = {
  mic: createLogger("MicDevices"),
  tray: createLogger("Tray Menu"),
  ipc: createLogger("IPC"),
  main: createLogger("Main Process"),
  pill: createLogger("Pill Menu"),
};


