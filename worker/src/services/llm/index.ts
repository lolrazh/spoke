import type { LLMProvider } from '../../config';
import { chatComplete as groqChatComplete } from './groq';
import { chatComplete as openaiChatComplete } from './openai';
import { chatComplete as basetenChatComplete } from './baseten';
import { chatComplete as openRouterChatComplete } from './openrouter';
import { chatComplete as cerebrasChatComplete } from './cerebras';

export type ChatTimings = {
  startAt: number;
  headersAt: number;
  firstDeltaAt?: number;
  bodyDoneAt: number;
};

export type ChatResult = { text: string; timings: ChatTimings };

export type ChatCompleteOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  userContent: string;
  stream?: boolean;
  temperature?: number;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  providerConfig?: Record<string, any>;
  extraHeaders?: Record<string, string>;
};

export async function chatCompleteByProvider(
  provider: LLMProvider,
  opts: ChatCompleteOptions,
): Promise<ChatResult> {
  if (provider === 'baseten') {
    return basetenChatComplete(opts as any) as unknown as ChatResult;
  }
  if (provider === 'openai') {
    return openaiChatComplete(opts as any) as unknown as ChatResult;
  }
  if (provider === 'openrouter') {
    return openRouterChatComplete(opts as any) as unknown as ChatResult;
  }
  if (provider === 'cerebras') {
    return cerebrasChatComplete(opts as any) as unknown as ChatResult;
  }
  // default groq
  return groqChatComplete(opts as any) as unknown as ChatResult;
}
