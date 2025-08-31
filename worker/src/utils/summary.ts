export type ClientMetrics = {
  framesProduced?: number;
  bytesProduced?: number;
};

export type WorkerMetrics = {
  llm?: { totalMs?: number | null } | null;
  stt?: { totalMs?: number | null } | null;
  groq?: { totalMs?: number | null } | null;
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
  derived?: {
    e2eMs?: number | null;
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
  const llmMs = worker?.llm?.totalMs ?? null;
  const sttMs = worker?.groq?.totalMs ?? worker?.stt?.totalMs ?? null;
  const pipeline = llmMs != null ? 'stt+llm' : 'stt';

  const durations = {
    e2eMs: body?.derived?.e2eMs ?? null,
    captureMs: body?.derived?.captureMs ?? null,
    deliverMs: body?.derived?.deliverMs ?? null,
    pasteMs: body?.derived?.pasteMs ?? null,
    wsAcceptToFinalMs:
      worker?.finalSentAt && worker?.wsAcceptAt
        ? (worker.finalSentAt as number) - (worker.wsAcceptAt as number)
        : null,
    assembleMs: worker?.assembleMs ?? null,
    sttMs: sttMs ?? null,
    llmMs: llmMs ?? null,
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
    ws,
    env: envOut,
    containsClientMetrics: true,
  } as const;
}

