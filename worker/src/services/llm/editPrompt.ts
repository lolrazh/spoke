import type { ClientSelectionPayload } from '../../types/messages';

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const XML_ESCAPE_REGEX = /[&<>"']/g;

function escapeForXml(value: string): string {
  return value.replace(XML_ESCAPE_REGEX, (char) => XML_ESCAPE_MAP[char] ?? char);
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim();
}

export type EditRequestPayload = {
  promptXml: string;
  instructions: string;
  originalText: string;
  hadSelection?: boolean;
  status?: string;
};

export function buildEditXmlPrompt(input: {
  instructions: string;
  originalText: string;
}): string {
  const instructions = escapeForXml(input.instructions);
  const original = escapeForXml(input.originalText);

  return [
    `<instructions>\n  ${instructions}\n</instructions>`,
    `<input>\n  ${original}\n</input>`,
  ].join('\n');
}

export function prepareEditRequest(params: {
  instructions: string;
  selection: ClientSelectionPayload | null | undefined;
}): EditRequestPayload | null {
  const instructions = normalizeText(params.instructions);
  if (!instructions) return null;

  const selection = params.selection;
  if (!selection) return null;

  const original = normalizeText(selection.text ?? null);
  if (!original) return null;

  const promptXml = buildEditXmlPrompt({
    instructions,
    originalText: original,
  });

  return {
    promptXml,
    instructions,
    originalText: original,
    hadSelection: selection.hadSelection,
    status: selection.status,
  };
}

const EDIT_SYSTEM_PROMPT = `You are an expert writing editor. You receive XML inside <edit_request> where <instructions> describes the desired edits and <input> contains the original text. Return only the edited text without commentary.`;

export function buildEditSystemPrompt(): string {
  return EDIT_SYSTEM_PROMPT;
}
