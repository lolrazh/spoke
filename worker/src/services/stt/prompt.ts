export type SttPromptIdentity = {
  name?: string | null;
  email?: string | null;
};

export const DEFAULT_STT_PROMPT = 'Your vocabulary includes: Sonic Flow';

const MAX_TOKEN_LENGTH = 80;

type BuildOptions = {
  basePrompt?: string | null | undefined;
  extraVocab?: Array<string | null | undefined> | null | undefined;
  identity?: SttPromptIdentity | null | undefined;
};

function sanitizeToken(token: string): string | null {
  const withoutControl = token.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  const withoutDelimiters = withoutControl.replace(/[,:<>]+/g, ' ');
  const allowedOnly = withoutDelimiters.replace(/[^A-Za-z0-9@._\-+' ]+/g, '');
  const collapsed = allowedOnly.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_TOKEN_LENGTH
    ? collapsed.slice(0, MAX_TOKEN_LENGTH)
    : collapsed;
}

function formatTokens(tokens: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    const sanitized = sanitizeToken(token);
    if (!sanitized) continue;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sanitized);
  }
  return result;
}

function baseVocabularyTokens(base: string): string[] {
  const [, tail = base] = base.split(':');
  return formatTokens(tail.split(','));
}

export function buildSTTPrompt(options?: BuildOptions): string {
  const base = (options?.basePrompt ?? DEFAULT_STT_PROMPT).trim();

  // Split name by whitespace into separate vocabulary tokens
  // e.g., "Sandeep Rajkumar" → ["Sandeep", "Rajkumar"]
  // e.g., "John Doe Smith" → ["John", "Doe", "Smith"]
  const nameTokens = options?.identity?.name
    ? options.identity.name.split(/\s+/).filter(Boolean)
    : [];

  const identityTokens = formatTokens([
    ...nameTokens,
    options?.identity?.email ?? null,
  ]);
  const extraTokens = formatTokens(options?.extraVocab ?? []);
  const combined = [...identityTokens, ...extraTokens];
  if (combined.length === 0) return base;

  const baseTokens = new Set(
    baseVocabularyTokens(base).map((token) => token.toLowerCase()),
  );
  const filtered = combined.filter(
    (token) => !baseTokens.has(token.toLowerCase()),
  );
  if (filtered.length === 0) return base;
  return `${base}, ${filtered.join(', ')}`;
}
