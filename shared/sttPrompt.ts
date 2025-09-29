export type SttPromptIdentity = {
  name?: string | null;
  email?: string | null;
};

export const DEFAULT_STT_PROMPT = "Your vocabulary includes: Sonic Flow";

type BuildOptions = {
  basePrompt?: string | null | undefined;
  extraVocab?: Array<string | null | undefined> | null | undefined;
  identity?: SttPromptIdentity | null | undefined;
};

function formatTokens(tokens: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function baseVocabularyTokens(base: string): string[] {
  const [, tail = base] = base.split(":");
  return formatTokens(tail.split(","));
}

export function buildSTTPrompt(options?: BuildOptions): string {
  const base = (options?.basePrompt ?? DEFAULT_STT_PROMPT).trim();
  const identityTokens = formatTokens([
    options?.identity?.name ?? null,
    options?.identity?.email ?? null,
  ]);
  const extraTokens = formatTokens(options?.extraVocab ?? []);
  const combined = [...identityTokens, ...extraTokens];
  if (combined.length === 0) return base;

  const baseTokens = new Set(
    baseVocabularyTokens(base).map((token) => token.toLowerCase()),
  );
  const filtered = combined.filter((token) => !baseTokens.has(token.toLowerCase()));
  if (filtered.length === 0) return base;
  return `${base}, ${filtered.join(", ")}`;
}
