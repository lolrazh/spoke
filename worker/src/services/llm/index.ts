import type { LLMProvider } from "../../config";
import { chatComplete as groqChatComplete } from "./groq";
import { chatComplete as basetenChatComplete } from "./baseten";
import { chatComplete as cerebrasChatComplete } from "./cerebras";
import { chatComplete as simplismartChatComplete } from "./simplismart";

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
  switch (provider) {
    case "baseten":
      return basetenChatComplete(opts as any) as unknown as ChatResult;
    case "cerebras":
      return cerebrasChatComplete(opts as any) as unknown as ChatResult;
    case "simplismart":
      return simplismartChatComplete(opts as any) as unknown as ChatResult;
    case "groq":
    default:
      return groqChatComplete(opts as any) as unknown as ChatResult;
  }
}
