type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown> | undefined;

export interface Logger {
  debug: (msg: string, ctx?: LogContext) => void;
  info: (msg: string, ctx?: LogContext) => void;
  warn: (msg: string, ctx?: LogContext) => void;
  error: (msg: string, ctx?: LogContext) => void;
  with: (ctx: LogContext) => Logger;
}

function log(level: LogLevel, msg: string, ctx?: LogContext) {
  try {
    const entry = { level, msg, ts: Date.now(), ...ctx } as const;
    // Use native console methods to preserve log levels
    const line = JSON.stringify(entry);
    switch (level) {
      case "debug":
        (console.debug || console.log)(line);
        break;
      case "info":
        (console.info || console.log)(line);
        break;
      case "warn":
        (console.warn || console.log)(line);
        break;
      case "error":
        (console.error || console.log)(line);
        break;
      default:
        console.log(line);
    }
  } catch (e) {
    // Fallback
    const fn =
      (level === "error" && console.error) ||
      (level === "warn" && console.warn) ||
      console.log;
    fn(`[${level}] ${msg} ${ctx ? JSON.stringify(ctx) : ""}`);
  }
}

export function createLogger(base?: LogContext): Logger {
  const bind = (extra?: LogContext): LogContext => ({
    ...(base || {}),
    ...(extra || {}),
  });
  return {
    debug: (msg, ctx) => log("debug", msg, bind(ctx)),
    info: (msg, ctx) => log("info", msg, bind(ctx)),
    warn: (msg, ctx) => log("warn", msg, bind(ctx)),
    error: (msg, ctx) => log("error", msg, bind(ctx)),
    with: (ctx) => createLogger(bind(ctx)),
  };
}
