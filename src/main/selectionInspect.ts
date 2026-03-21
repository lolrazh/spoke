/**
 * Selection Inspection
 *
 * Spawns the native helper binary to inspect the currently focused text field
 * and extract selection range, selected text, and surrounding context via
 * macOS Accessibility APIs. Output is parsed from the helper's stdout.
 */

import * as fs from "fs";
import { spawn } from "child_process";
import type { SelectionInspectSnapshot } from "../types/shared";
import { getHelperPath } from "./helperPaths";

// ── Types ──────────────────────────────────────────────────────────────

export type SelectionInspectOptions = {
  contextChars?: number;
};

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_INSPECT_CONTEXT_CHARS = 96;
const INSPECT_SELECTION_TIMEOUT_MS = 1500;

// ── Parsing utilities ──────────────────────────────────────────────────

function clampInspectContextChars(input?: number): number {
  if (typeof input !== "number" || Number.isNaN(input))
    return DEFAULT_INSPECT_CONTEXT_CHARS;
  const clamped = Math.floor(input);
  if (!Number.isFinite(clamped) || clamped <= 0)
    return DEFAULT_INSPECT_CONTEXT_CHARS;
  // AX read becomes sluggish with very large windows; cap to a reasonable slice
  return Math.min(clamped, 512);
}

function extractBase64Section(source: string, label: string): string | null {
  const token = `${label}B64:`;
  const start = source.indexOf(token);
  if (start === -1) return null;
  const valueStart = start + token.length;
  const nextNewline = source.indexOf("\n", valueStart);
  const slice =
    nextNewline === -1
      ? source.slice(valueStart)
      : source.slice(valueStart, nextNewline);
  const trimmed = slice.trim();
  if (!trimmed) return null;
  try {
    return Buffer.from(trimmed, "base64").toString("utf8");
  } catch (error) {
    console.warn(`[SelectionInspect] Failed to decode ${label} base64`, error);
    return null;
  }
}

function extractFallbackSection(source: string, label: string): string | null {
  const lines = source.split(/\r?\n/);
  const prefix = `${label}:`;
  const startIdx = lines.findIndex((line) => line.startsWith(prefix));
  if (startIdx === -1) return null;

  const collected: string[] = [];
  const first = lines[startIdx].slice(prefix.length);
  collected.push(first.startsWith(" ") ? first.slice(1) : first);

  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(selectedRange|selectedText|context|valueLength|read)/.test(line))
      break;
    if (/^[a-zA-Z]+B64:/.test(line)) break;
    collected.push(line);
  }

  const combined = collected.join("\n").trimEnd();
  if (!combined || combined === "(null)") return null;
  return combined;
}

export function parseInspectOutput(stdout: string): SelectionInspectSnapshot {
  const normalized = stdout.replace(/\r/g, "");
  const statusMatch = normalized.match(/read:[^\n]*/);
  const status = statusMatch ? statusMatch[0] : "read:unknown";
  const ok = status === "read:ok";

  const rangeMatch = normalized.match(/selectedRange:(-?\d+):(-?\d+)/);
  const range = rangeMatch
    ? { location: Number(rangeMatch[1]), length: Number(rangeMatch[2]) }
    : null;

  const sourceMatch = normalized.match(/selectionSource:([^\n]+)/);
  const rawSource = sourceMatch ? sourceMatch[1].trim() : "none";
  const source: SelectionInspectSnapshot["source"] =
    rawSource === "ax" || rawSource === "clipboard"
      ? (rawSource as "ax" | "clipboard")
      : "none";

  const valueLengthMatch = normalized.match(/valueLength:(-?\d+)/);
  const valueLength = valueLengthMatch ? Number(valueLengthMatch[1]) : null;

  let selectedText = extractBase64Section(normalized, "selectedText");
  if (selectedText === null)
    selectedText = extractFallbackSection(normalized, "selectedText");

  let context = extractBase64Section(normalized, "context");
  if (context === null) context = extractFallbackSection(normalized, "context");

  const normalizedRange =
    range && range.location >= 0 && range.length >= 0 ? range : null;
  const hadSelection = Boolean(
    (normalizedRange && normalizedRange.length > 0) ||
      (selectedText && selectedText.length > 0),
  );

  const result: SelectionInspectSnapshot = {
    ok,
    status,
    range: normalizedRange,
    selectedText,
    context,
    valueLength,
    hadSelection,
    source,
    rawOutput: normalized,
  };

  if (!ok) {
    result.error = status;
  }

  return result;
}

// ── Main function ──────────────────────────────────────────────────────

export async function inspectFocusedSelection(
  options?: SelectionInspectOptions,
): Promise<SelectionInspectSnapshot> {
  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    return {
      ok: false,
      status: "helper-missing",
      range: null,
      selectedText: null,
      context: null,
      valueLength: null,
      hadSelection: false,
      source: "none",
      rawOutput: "",
      error: "Helper binary not found",
    };
  }

  const contextChars = clampInspectContextChars(options?.contextChars);

  return await new Promise<SelectionInspectSnapshot>((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const helper = spawn(helperPath, ["--inspect-text", String(contextChars)], {
      stdio: "pipe",
      detached: false,
    });

    const done = (result: SelectionInspectSnapshot) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!result.rawOutput) result.rawOutput = stdout;
      if (!result.error && stderr.trim().length > 0 && !result.ok) {
        result.error = stderr.trim();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        helper.kill("SIGKILL");
      } catch {}
      done({
        ok: false,
        status: "timeout",
        range: null,
        selectedText: null,
        context: null,
        valueLength: null,
        hadSelection: false,
        source: "none",
        rawOutput: stdout,
        error: "Selection inspection timed out",
      });
    }, INSPECT_SELECTION_TIMEOUT_MS);

    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    helper.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    helper.on("error", (error) => {
      done({
        ok: false,
        status: "spawn-error",
        range: null,
        selectedText: null,
        context: null,
        valueLength: null,
        hadSelection: false,
        source: "none",
        rawOutput: stdout,
        error: error.message,
      });
    });

    helper.on("close", (code) => {
      const parsed = parseInspectOutput(stdout);
      if (code !== 0) {
        parsed.status = parsed.ok
          ? `exit:${code}`
          : `${parsed.status}|exit:${code}`;
        if (!parsed.error) parsed.error = `Helper exited with code ${code}`;
        parsed.ok = false;
      }
      done(parsed);
    });
  });
}
