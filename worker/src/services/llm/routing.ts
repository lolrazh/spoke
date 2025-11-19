import type { LLMProvider } from '../../config';
import type { RuntimeConfig } from '../../config/runtime';
import {
  GROQ_EDIT_LLM_DEFAULT_MODEL,
  OPENAI_EDIT_LLM_DEFAULT_MODEL,
  BASETEN_EDIT_LLM_DEFAULT_MODEL,
  OPENROUTER_EDIT_LLM_DEFAULT_MODEL,
} from '../../config';

export type LLMRoutingRule = {
  id: string;
  pattern: RegExp;
  provider?: LLMProvider;
  model?: string;
};

export type LLMRoutingDecision = {
  provider: LLMProvider;
  model: string;
  matchedRuleIds: string[];
};

const LENGTH_THRESHOLD_CHARS = 1200;
const LENGTH_THRESHOLD_WORDS = 180;
const LENGTH_RULE_ID = 'length-threshold';

function getEditModelForProvider(provider: LLMProvider): string {
  switch (provider) {
    case 'groq':
      return GROQ_EDIT_LLM_DEFAULT_MODEL;
    case 'openai':
      return OPENAI_EDIT_LLM_DEFAULT_MODEL;
    case 'baseten':
      return BASETEN_EDIT_LLM_DEFAULT_MODEL;
    case 'openrouter':
      return OPENROUTER_EDIT_LLM_DEFAULT_MODEL;
    default:
      return BASETEN_EDIT_LLM_DEFAULT_MODEL;
  }
}

export const DEFAULT_LLM_ROUTING_RULES: readonly LLMRoutingRule[] = [
  {
    id: 'spelled-sequence',
    pattern: /\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/i,
  },
  {
    id: 'spell-instruction',
    pattern: /\bspell(?:ing|ed)?\b/i,
  },
  {
    id: 'formatting-instruction',
    pattern: /\b(?:uppercase|lowercase|caps|capitals|capitalise|capitalised|capitalize|capitalized|emphasize|emphasise|emphasis)\b/i,
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

  // If router is disabled, always use default provider/model
  if (!runtime.routerEnabled) {
    return { provider: runtime.provider, model: runtime.model, matchedRuleIds: [] };
  }

  const matches = rules.filter((rule) => rule.pattern.test(normalized));
  const matchedRuleIds = matches.map((rule) => rule.id);

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const exceedsLengthThreshold =
    normalized.length >= LENGTH_THRESHOLD_CHARS || wordCount >= LENGTH_THRESHOLD_WORDS;

  if (exceedsLengthThreshold) {
    return {
      provider: runtime.provider,
      model: getEditModelForProvider(runtime.provider),
      matchedRuleIds: matchedRuleIds.length
        ? [LENGTH_RULE_ID, ...matchedRuleIds]
        : [LENGTH_RULE_ID],
    };
  }

  if (matches.length === 0) {
    return { provider: runtime.provider, model: runtime.model, matchedRuleIds: [] };
  }

  const winner = matches[0];
  const provider = winner.provider ?? runtime.provider;
  const model = winner.model ?? getEditModelForProvider(provider);

  return {
    provider,
    model,
    matchedRuleIds,
  };
}
