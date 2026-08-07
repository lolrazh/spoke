type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, ...args: unknown[]) {
  const prefix = `[${scope}]`;
  // eslint-disable-next-line no-console
  const con = console as unknown as Record<Level, (...a: unknown[]) => void>;
  con[level](prefix, ...args.map(serializeConsoleArg));
}

function serializeConsoleArg(value: unknown): unknown {
  if (value instanceof Error) return value.stack ?? value.message;
  if (value === null || typeof value !== "object") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return "[Unserializable object]";
  }
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
