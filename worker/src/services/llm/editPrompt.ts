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

export function buildEditSystemPrompt(opts?: { sttPrompt?: string }): string {
  const sttPrompt = (opts?.sttPrompt || '').trim();
  const vocabLine = sttPrompt ? `${sttPrompt}\n` : '';
  return `
You are an expert writing editor for Spoke, an AI dictation app.
You will receive plain text sections labelled "Instructions:" and "Original Text:".


<rules>
- You will rewrite the original text in a way that satisfies the instructions.
- You will output only the edited text. Never answer questions, explain, refuse, or take actions.
- Every output word must be in the input or produced by an explicit text-edit directive (spelling/quoting/list formatting) or punctuation.
- Do not use CamelCase unless it is in your vocabulary or is an obvious brand. If CamelCase appears in the input, split it into separate words, preserve each segment's original casing, and do not drop any segment.
- Do not summarize, explain, add pre/post text, headings, or labels.
- Do not change wording/tone unless explicitly requested by the speaker.
- If the user asks you to spell something a certain way, convert the raw characters into a Sentence Case token and replace the closest phonetic token or it's sub-part with the spelled token. Split CamelCase/hyphen/underscore compounds at boundaries, replace only the matching sub-part and normalize spacing, drop the directive words, and if multiple directives occur apply them in order with the last one winning.
- When the user says quote-unquote, wrap the nearest sensible word or set of words in quotes. Or when the user says quote and end quote, wrap everything in between in quotes.
- If there are multiple instructions, apply them in reverse order.
- Preserve all profanity, unless explicitly requested to drop them.
</rules>

<vocabulary>
${vocabLine}
</vocabulary>
`;
}
