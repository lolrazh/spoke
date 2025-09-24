export type ClientMetrics = {
  framesProduced?: number;
  bytesProduced?: number;
};

export type SttMetrics = {
  provider?: string | null;
  startAt?: number | null;
  headersAt?: number | null;
  bodyDoneAt?: number | null;
  ttfbMs?: number | null;
  bodyMs?: number | null;
  totalMs?: number | null;
};

export type LlmMetrics = {
  provider?: string | null;
  startAt?: number | null;
  headersAt?: number | null;
  firstDeltaAt?: number | null;
  bodyDoneAt?: number | null;
  ttfbMs?: number | null;
  bodyMs?: number | null;
  totalMs?: number | null;
};

export type WorkerMetrics = {
  llm?: LlmMetrics | null;
  stt?: SttMetrics | null;
  groq?: SttMetrics | null;
  frames?: number;
  bytes?: number;
  seqGaps?: number;
  firstToLastArrivalMs?: number | null;
  wsAcceptAt?: number | null;
  finalSentAt?: number | null;
  assembleMs?: number | null;
};

export type SessionBody = {
  traceId: string;
  client?: ClientMetrics | null;
  worker?: WorkerMetrics | null;
  meta?: { appVersion?: string; platform?: string };
  // Optional dataset texts forwarded by the client
  dataset?: { sttText?: string | null; llmText?: string | null } | null;
  derived?: {
    // e2eMs now represents post-dictation latency (stop -> paste/final)
    e2eMs?: number | null;
    // New: time the user was dictating (PTT down -> stop)
    dictationMs?: number | null;
    // New: total session time (PTT down -> paste/final), for reference
    totalMs?: number | null;
    captureMs?: number | null;
    deliverMs?: number | null;
    pasteMs?: number | null;
  };
};

export type Bindings = {
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id?: string };
};

export function buildSessionSummary(body: SessionBody, env: Bindings) {
  const traceId = (body?.traceId ?? '').toString();
  if (!traceId) throw new Error('traceId required');

  const worker = body?.worker || null;
  const llm = worker?.llm ?? null;
  const stt = worker?.stt ?? worker?.groq ?? null;
  const llmMs = llm?.totalMs ?? null;
  const sttMs = stt?.totalMs ?? null;
  const pipeline = llmMs != null ? 'stt+llm' : 'stt';

  const durations = {
    e2eMs: body?.derived?.e2eMs ?? null,
    dictationMs: body?.derived?.dictationMs ?? null,
    totalMs: body?.derived?.totalMs ?? null,
    captureMs: body?.derived?.captureMs ?? null,
    deliverMs: body?.derived?.deliverMs ?? null,
    pasteMs: body?.derived?.pasteMs ?? null,
    wsAcceptToFinalMs:
      worker?.finalSentAt && worker?.wsAcceptAt
        ? (worker.finalSentAt as number) - (worker.wsAcceptAt as number)
        : null,
    assembleMs: worker?.assembleMs ?? null,
    sttMs: sttMs ?? null,
    sttTtfbMs: stt?.ttfbMs ?? null,
    sttBodyMs: stt?.bodyMs ?? null,
    llmMs: llmMs ?? null,
    llmTtfbMs: llm?.ttfbMs ?? null,
    llmBodyMs: llm?.bodyMs ?? null,
    llmFirstTokenMs:
      llm?.firstDeltaAt != null && llm?.startAt != null
        ? llm.firstDeltaAt - llm.startAt
        : llm?.ttfbMs ?? null,
    serverProcessingMs: (sttMs ?? 0) + (llmMs ?? 0),
    overheadMs: (worker as any)?.overheadMs ?? null,
  };

  const frames = worker?.frames ?? (body?.client as any)?.framesProduced ?? null;
  const bytes = worker?.bytes ?? (body?.client as any)?.bytesProduced ?? 0;

  const traffic = {
    frames,
    bytesKB: Number(((bytes || 0) / 1024).toFixed(2)),
    seqGaps: worker?.seqGaps ?? 0,
    firstToLastArrivalMs: worker?.firstToLastArrivalMs ?? null,
  };

  const ws = {
    closeCode: (worker as any)?.closeCode ?? 1000,
    closeReason: (worker as any)?.closeReason ?? 'done',
  };

  const envOut = {
    environment: env.SENTRY_ENVIRONMENT || 'production',
    release: env.CF_VERSION_METADATA?.id || 'unknown',
  };

  const result = { textLen: (worker as any)?.textLen ?? null };

  return {
    event: 'transcription.session_summary',
    id: traceId,
    pipeline,
    durations,
    traffic,
    result,
    dataset: body?.dataset ?? null,
    ws,
    env: envOut,
    containsClientMetrics: true,
  } as const;
}
