import type { SelectionInspectSnapshot } from "../types/shared";

export type DictationFormatOptions = {
  autoSpace: boolean;
  selection?: SelectionInspectSnapshot | null;
  contextChars?: number;
};

type InsertionContext = {
  before: string;
  after: string;
};

const DEFAULT_CONTEXT_CHARS = 96;
const OPENING_BOUNDARY_CHARS = new Set(["(", "[", "{", "\"", "'", "“", "‘"]);
const PROTECTED_TERMINAL_ABBREVIATIONS = new Set([
  "dr",
  "e.g",
  "etc",
  "i.e",
  "jr",
  "mr",
  "mrs",
  "ms",
  "p.m",
  "prof",
  "sr",
  "st",
  "u.k",
  "u.s",
  "vs",
]);
const CLOSING_PUNCTUATION_RE = /^[,.;:!?)}\]"'”’]/;
const LEADING_PUNCTUATION_RE = /^[,.;:!?)}\]"'”’]/;

/**
 * Append the auto-space trailing space to an outgoing payload. Skipped when
 * the preference is off or the text already ends in whitespace, so spaces
 * never stack and a trailing newline stays a newline.
 */
export function applyAutoSpace(text: string, enabled: boolean): string {
  if (!enabled || text.length === 0 || /\s$/.test(text)) return text;
  return `${text} `;
}

export function formatDictationForInsertion(
  text: string,
  options: DictationFormatOptions,
): string {
  let payload = text.trimStart();
  const context = extractInsertionContext(
    options.selection,
    options.contextChars ?? DEFAULT_CONTEXT_CHARS,
  );

  if (context) {
    payload = normalizeLeadingBoundary(payload, context.before);
    payload = normalizeInitialCapitalization(payload, context.before);
    payload = normalizeContinuationEnding(
      payload,
      context.before,
      context.after,
    );
    payload = normalizeTrailingBoundary(
      payload,
      context.after,
      options.autoSpace,
    );
    return payload;
  }

  return applyAutoSpace(payload, options.autoSpace);
}

function extractInsertionContext(
  selection: SelectionInspectSnapshot | null | undefined,
  contextChars: number,
): InsertionContext | null {
  if (!selection?.ok || !selection.range || selection.range.location < 0) {
    return null;
  }

  if (typeof selection.context !== "string" || selection.context.length === 0) {
    return null;
  }

  const contextStart = Math.max(0, selection.range.location - contextChars);
  const beforeLength = selection.range.location - contextStart;
  const afterStart = beforeLength + Math.max(0, selection.range.length);

  if (
    beforeLength < 0 ||
    beforeLength > selection.context.length ||
    afterStart < beforeLength ||
    afterStart > selection.context.length
  ) {
    return null;
  }

  return {
    before: selection.context.slice(0, beforeLength),
    after: selection.context.slice(afterStart),
  };
}

function normalizeLeadingBoundary(payload: string, before: string): string {
  if (payload.length === 0 || before.length === 0) return payload;
  if (/^\s/.test(payload) || /\s$/.test(before)) return payload;
  if (LEADING_PUNCTUATION_RE.test(payload)) return payload;

  const previousChar = before[before.length - 1];
  if (OPENING_BOUNDARY_CHARS.has(previousChar)) return payload;

  return ` ${payload}`;
}

function normalizeTrailingBoundary(
  payload: string,
  after: string,
  autoSpace: boolean,
): string {
  if (!autoSpace || payload.length === 0 || /\s$/.test(payload)) return payload;

  if (after.length > 0) {
    if (/^\s/.test(after)) return payload;
    if (CLOSING_PUNCTUATION_RE.test(after)) return payload;
  }

  return `${payload} `;
}

function normalizeContinuationEnding(
  payload: string,
  before: string,
  after: string,
): string {
  if (!/\S/.test(before)) return payload;
  if (!startsWithContinuingText(after)) return payload;

  const trimmedPayload = payload.trimEnd();
  if (!/[.!?]$/.test(trimmedPayload)) return payload;
  if (/\.$/.test(trimmedPayload) && hasProtectedTerminalAbbreviation(trimmedPayload)) {
    return payload;
  }

  return trimmedPayload.replace(/[.!?]+$/, "");
}

function normalizeInitialCapitalization(
  payload: string,
  before: string,
): string {
  if (payload.length === 0 || startsNewSentence(before)) return payload;

  const match = payload.match(/[A-Z]/);
  if (!match || match.index === undefined) return payload;

  const index = match.index;
  const token = payload.slice(index).match(/^[A-Za-z]+/)?.[0] ?? "";
  if (
    token === "I" ||
    isLikelyAcronym(token) ||
    hasProtectedLeadingAbbreviation(payload.slice(index))
  ) {
    return payload;
  }

  return `${payload.slice(0, index)}${payload[index].toLowerCase()}${payload.slice(
    index + 1,
  )}`;
}

function startsNewSentence(before: string): boolean {
  const trimmed = before.trimEnd();
  if (trimmed.length === 0) return true;
  if (/[\r\n]\s*$/.test(before)) return true;
  return /[.!?]["')\]}”’]*$/.test(trimmed);
}

function isLikelyAcronym(token: string): boolean {
  return token.length > 1 && token === token.toUpperCase();
}

function startsWithContinuingText(after: string): boolean {
  const trimmed = after.replace(/^[\t ]+/, "");
  return /^[\p{L}\p{N}]/u.test(trimmed);
}

function hasProtectedTerminalAbbreviation(payload: string): boolean {
  const match = payload.match(/([A-Za-z](?:[A-Za-z]|\.)*)\.$/);
  if (!match) return false;
  return PROTECTED_TERMINAL_ABBREVIATIONS.has(match[1].toLowerCase());
}

function hasProtectedLeadingAbbreviation(payload: string): boolean {
  const match = payload.match(/^([A-Za-z](?:[A-Za-z]|\.)*)\./);
  if (!match) return false;
  return PROTECTED_TERMINAL_ABBREVIATIONS.has(match[1].toLowerCase());
}
