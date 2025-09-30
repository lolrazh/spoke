import type { LLMProvider } from '../../config';
import type { RuntimeConfig } from '../../config/runtime';

export type LLMRoutingRule = {
  id: string;
  pattern: RegExp;
  provider: LLMProvider;
  model?: string;
};

export type LLMRoutingDecision = {
  provider: LLMProvider;
  model: string;
  matchedRuleIds: string[];
};

const KIMI_MODEL = 'moonshotai/kimi-k2-instruct-0905';

export const DEFAULT_LLM_ROUTING_RULES: readonly LLMRoutingRule[] = [
  {
    id: 'spelled-sequence',
    pattern: /\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/i,
    provider: 'groq',
    model: KIMI_MODEL,
  },
  {
    id: 'spell-instruction',
    pattern: /\bspell(?:ing|ed)?\b/i,
    provider: 'groq',
    model: KIMI_MODEL,
  },
  {
    id: 'formatting-instruction',
    pattern: /\b(?:uppercase|lowercase|capital(?:ize|ized)?|hyphen|dash)\b/i,
    provider: 'groq',
    model: KIMI_MODEL,
  },
] as const;

export function selectLLMRoute(
  text: string,
  runtime: RuntimeConfig['llm'],
  rules: readonly LLMRoutingRule[] = DEFAULT_LLM_ROUTING_RULES,
): LLMRoutingDecision {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return { provider: runtime.provider, model: runtime.model, matchedRuleIds: [] };
  }

  const matches = rules.filter((rule) => rule.pattern.test(normalized));
  if (matches.length === 0) {
    return { provider: runtime.provider, model: runtime.model, matchedRuleIds: [] };
  }

  const winner = matches[0];
  const model = winner.model ?? runtime.model;

  return {
    provider: winner.provider,
    model,
    matchedRuleIds: matches.map((rule) => rule.id),
  };
}
