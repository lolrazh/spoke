export type ClientSelectionRange = {
  location: number;
  length: number;
};

export type ClientSelectionPayload = {
  status?: string;
  hadSelection?: boolean;
  text?: string | null;
  range?: ClientSelectionRange | null;
  valueLength?: number | null;
};

export type ClientSessionMode = 'dictation' | 'edit';

export type ClientStartMessage = {
  type: 'start';
  version?: number;
  format?: 'pcm16le';
  rate?: number;
  traceId?: string;
  language?: string;
  mode?: ClientSessionMode;
  selection?: ClientSelectionPayload | null;
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

export type SttTimingsMetrics = {
  provider?: string | null;
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
  ttfbMs: number;
  bodyMs: number;
  totalMs: number;
};

export type LlmTimingsMetrics = {
  provider?: string | null;
  startAt: number;
  headersAt: number;
  firstDeltaAt: number | null;
  bodyDoneAt: number;
  ttfbMs: number;
  bodyMs: number;
  totalMs: number;
};

export type WorkerMetrics = {
  traceId?: string;
  wsAcceptAt: number | null | undefined;
  startedAt: number | null | undefined;
  processingStartAt: number | null | undefined;
  frames: number;
  bytes: number;
  seqGaps: number;
  firstArrivalMs: number | null;
  lastArrivalMs: number | null;
  firstToLastArrivalMs: number | null;
  assembleMs: number;
  groq: SttTimingsMetrics | null;
  llm: LlmTimingsMetrics | null;
  finalSentAt: number;
};

export type ServerFinalMessage = {
  type: 'final';
  text: string;
  traceId?: string;
  metrics?: { worker: WorkerMetrics };
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
    const rawMode = m.mode;
    const mode: ClientSessionMode | undefined =
      rawMode === 'edit' || rawMode === 'dictation' ? rawMode : undefined;

    let selection: ClientSelectionPayload | undefined;
    const rawSelection = m.selection;
    if (rawSelection && typeof rawSelection === 'object') {
      const sel = rawSelection as Record<string, unknown>;
      const rawRange = sel.range as Record<string, unknown> | undefined;
      const range =
        rawRange &&
        typeof rawRange.location === 'number' &&
        typeof rawRange.length === 'number'
          ? {
              location: rawRange.location,
              length: rawRange.length,
            }
          : null;

      selection = {
        status: typeof sel.status === 'string' ? sel.status : undefined,
        hadSelection:
          typeof sel.hadSelection === 'boolean' ? sel.hadSelection : undefined,
        text:
          typeof sel.text === 'string' || sel.text === null
            ? (sel.text as string | null)
            : undefined,
        range,
        valueLength:
          typeof sel.valueLength === 'number' ? sel.valueLength : undefined,
      };
    }

    return {
      type: 'start',
      version,
      format,
      rate,
      traceId,
      language,
      mode,
      selection,
    };
  }
  if (t === 'end') return { type: 'end' };
  if (t === 'cancel') return { type: 'cancel' };
  return null;
}
