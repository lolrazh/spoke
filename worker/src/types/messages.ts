export type ClientStartMessage = {
  type: 'start';
  version?: number;
  format?: 'pcm16le';
  rate?: number;
  traceId?: string;
  language?: string;
};

export type ClientEndMessage = { type: 'end' };
export type ClientCancelMessage = { type: 'cancel' };

export type ClientMessage =
  | ClientStartMessage
  | ClientEndMessage
  | ClientCancelMessage;

export type ServerStatusMessage = {
  type: 'status';
  state: 'processing';
  traceId?: string;
  serverTs: number;
};

export type ServerLlmStatusMessage = {
  type: 'llm_status';
  state: 'llm_processing';
  traceId?: string;
  serverTs: number;
};

export type ServerFinalMessage = {
  type: 'final';
  text: string;
  traceId?: string;
  metrics?: any;
};

export type ServerErrorMessage = {
  type: 'error';
  body: string;
};

export type ServerLlmDeltaMessage = {
  type: 'llm_delta';
  delta: string;
  traceId?: string;
};

export type ServerMessage =
  | ServerStatusMessage
  | ServerFinalMessage
  | ServerErrorMessage
  | ServerLlmStatusMessage
  | ServerLlmDeltaMessage;

export function parseClientMessage(msg: unknown): ClientMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  const t = (msg as any).type;
  if (t === 'start') {
    const m = msg as any;
    const version = typeof m.version === 'number' ? m.version : undefined;
    const format = m.format === 'pcm16le' ? 'pcm16le' : undefined;
    const rate = typeof m.rate === 'number' ? m.rate : undefined;
    const traceId = typeof m.traceId === 'string' ? m.traceId : undefined;
    const language = typeof m.language === 'string' ? m.language : undefined;
    return { type: 'start', version, format, rate, traceId, language };
  }
  if (t === 'end') return { type: 'end' };
  if (t === 'cancel') return { type: 'cancel' };
  return null;
}
