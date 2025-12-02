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
  source?: 'ax' | 'clipboard' | 'none';
};

export type ClientSessionMode = 'dictation' | 'edit';

export type ClientIdentityPayload = {
  name?: string;
  email?: string;
};

export type ClientStartMessage = {
  type: 'start';
  version?: number;
  format?: 'pcm16le';
  rate?: number;
  traceId?: string;
  language?: string;
  mode?: ClientSessionMode;
  selection?: ClientSelectionPayload | null;
  shareTranscriptions?: boolean;
  identity?: ClientIdentityPayload;
};

export type ClientEndMessage = { type: 'end' };
export type ClientCancelMessage = { type: 'cancel' };

/** Signals that the preceding audio frames form a complete chunk ready for STT */
export type ClientChunkMessage = {
  type: 'chunk';
  chunkIndex: number;
  /** Total audio duration in this chunk (ms) */
  audioMs: number;
};

export type ClientMessage =
  | ClientStartMessage
  | ClientEndMessage
  | ClientCancelMessage
  | ClientChunkMessage;

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
  dataset?: { sttText?: string | null; llmText?: string | null } | null;
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

/** Server response when a chunk has been transcribed */
export type ServerChunkResultMessage = {
  type: 'chunk_result';
  chunkIndex: number;
  text: string;
  traceId?: string;
};

export type ServerMessage =
  | ServerStatusMessage
  | ServerFinalMessage
  | ServerErrorMessage
  | ServerLlmStatusMessage
  | ServerLlmDeltaMessage
  | ServerChunkResultMessage;

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
        source:
          sel.source === 'ax' || sel.source === 'clipboard' || sel.source === 'none'
            ? (sel.source as ClientSelectionPayload['source'])
            : undefined,
      };
    }

    let identity: ClientIdentityPayload | undefined;
    const rawIdentity = m.identity;
    if (rawIdentity && typeof rawIdentity === 'object') {
      const idName = typeof (rawIdentity as any).name === 'string' ? (rawIdentity as any).name : undefined;
      const idEmail = typeof (rawIdentity as any).email === 'string' ? (rawIdentity as any).email : undefined;
      if (idName || idEmail) {
        identity = {
          name: idName,
          email: idEmail,
        };
      }
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
      shareTranscriptions:
        typeof m.shareTranscriptions === 'boolean'
          ? m.shareTranscriptions
          : undefined,
      identity,
    };
  }
  if (t === 'end') return { type: 'end' };
  if (t === 'cancel') return { type: 'cancel' };
  if (t === 'chunk') {
    const m = msg as any;
    const chunkIndex = typeof m.chunkIndex === 'number' ? m.chunkIndex : 0;
    const audioMs = typeof m.audioMs === 'number' ? m.audioMs : 0;
    return { type: 'chunk', chunkIndex, audioMs };
  }
  return null;
}
