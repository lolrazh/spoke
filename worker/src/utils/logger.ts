type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
    const entry = { level, msg, ts: Date.now(), ...ctx };
    // Prefer structured JSON to make logs machine-parseable
    console.log(JSON.stringify(entry));
  } catch (e) {
    // Fallback
    console.log(`[${level}] ${msg}`, ctx);
  }
}

export function createLogger(base?: LogContext): Logger {
  const bind = (extra?: LogContext): LogContext => ({ ...(base || {}), ...(extra || {}) });
  return {
    debug: (msg, ctx) => log('debug', msg, bind(ctx)),
    info: (msg, ctx) => log('info', msg, bind(ctx)),
    warn: (msg, ctx) => log('warn', msg, bind(ctx)),
    error: (msg, ctx) => log('error', msg, bind(ctx)),
    with: (ctx) => createLogger(bind(ctx)),
  };
}

