import { app, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error";

const ORIGINAL_CONSOLE: Pick<Console, ConsoleMethod> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Rotate the log once it grows past ~5 MB; the previous log is kept as
// spoke.log.old (replacing any older rotation). Size is checked on install
// and then every ROTATION_CHECK_EVERY_N_WRITES appends to keep the hot path
// cheap.
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const ROTATION_CHECK_EVERY_N_WRITES = 250;

let installed = false;
let cachedLogPath: string | null = null;
let writesSinceRotationCheck = 0;

export function getDiagnosticLogPath(): string {
  if (cachedLogPath) return cachedLogPath;

  const logsDir = app.getPath("logs");
  fs.mkdirSync(logsDir, { recursive: true });
  cachedLogPath = path.join(logsDir, "spoke.log");
  return cachedLogPath;
}

function rotateLogIfNeeded(): void {
  try {
    const logPath = getDiagnosticLogPath();
    const stats = fs.statSync(logPath);
    if (stats.size <= MAX_LOG_SIZE_BYTES) return;
    // renameSync replaces an existing .old file atomically.
    fs.renameSync(logPath, `${logPath}.old`);
  } catch {
    // File may not exist yet; diagnostics must never affect the app path.
  }
}

export function installMainConsoleFileSink(): void {
  if (installed) return;
  installed = true;

  rotateLogIfNeeded();

  for (const method of Object.keys(ORIGINAL_CONSOLE) as ConsoleMethod[]) {
    console[method] = (...args: unknown[]) => {
      ORIGINAL_CONSOLE[method](...args);
      appendDiagnosticLine("main", method, args);
    };
  }

  console.log(`[Diagnostics] Writing logs to ${getDiagnosticLogPath()}`);
}

export function attachRendererConsoleFileSink(
  webContents: WebContents,
  label: string,
): void {
  webContents.on("console-message", (...args: unknown[]) => {
    const details = extractRendererConsoleDetails(args);
    appendDiagnosticLine(`renderer:${label}`, details.level, [
      details.message,
      details.location,
    ]);
  });
}

function extractRendererConsoleDetails(args: unknown[]): {
  level: ConsoleMethod;
  message: string;
  location: string;
} {
  const details = args[1];
  if (details && typeof details === "object" && "message" in details) {
    const record = details as {
      level?: unknown;
      message?: unknown;
      sourceId?: unknown;
      lineNumber?: unknown;
    };
    return {
      level: normalizeLevel(record.level),
      message: String(record.message ?? ""),
      location: formatLocation(record.sourceId, record.lineNumber),
    };
  }

  return {
    level: normalizeLevel(args[1]),
    message: String(args[2] ?? ""),
    location: formatLocation(args[4], args[3]),
  };
}

function appendDiagnosticLine(
  scope: string,
  level: ConsoleMethod,
  args: unknown[],
): void {
  try {
    writesSinceRotationCheck += 1;
    if (writesSinceRotationCheck >= ROTATION_CHECK_EVERY_N_WRITES) {
      writesSinceRotationCheck = 0;
      rotateLogIfNeeded();
    }

    const timestamp = new Date().toISOString();
    const message = args.map(formatArg).filter(Boolean).join(" ");
    fs.appendFileSync(
      getDiagnosticLogPath(),
      `${timestamp} [${scope}] [${level}] ${message}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never affect the app path.
  }
}

function normalizeLevel(level: unknown): ConsoleMethod {
  if (level === "debug" || level === 0) return "debug";
  if (level === "info" || level === 1) return "info";
  if (level === "warn" || level === "warning" || level === 2) return "warn";
  if (level === "error" || level === 3) return "error";
  return "log";
}

function formatLocation(sourceId: unknown, lineNumber: unknown): string {
  const source = typeof sourceId === "string" ? sourceId : "";
  const line =
    typeof lineNumber === "number" && Number.isFinite(lineNumber)
      ? `:${lineNumber}`
      : "";
  return source || line ? `${source}${line}` : "";
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  if (value == null) return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
