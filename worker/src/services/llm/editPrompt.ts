import type { ClientSelectionPayload } from '../../types/messages';

function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim();
}

export type EditRequestPayload = {
  prompt: string;
  instructions: string;
  originalText: string;
  hadSelection?: boolean;
  status?: string;
};

export function buildEditPrompt(input: {
  instructions: string;
  originalText: string;
}): string {
  return [
    'Instructions:',
    input.instructions,
    '',
    'Original Text:',
    input.originalText,
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

  const prompt = buildEditPrompt({
    instructions,
    originalText: original,
  });

  return {
    prompt,
    instructions,
    originalText: original,
    hadSelection: selection.hadSelection,
    status: selection.status,
  };
}

const EDIT_SYSTEM_PROMPT = `You are an expert writing editor. You will receive plain text sections labelled "Instructions:" and "Original Text:". Rewrite the original text so it satisfies the instructions. Respond with the edited text only, preserving punctuation and without inserting XML/HTML entities or additional commentary.`;

export function buildEditSystemPrompt(): string {
  return EDIT_SYSTEM_PROMPT;
}
