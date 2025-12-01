import type {
  ClientSelectionPayload,
  ClientSessionMode,
} from '../types/messages';

export type AudioSession = ReturnType<typeof createEmptySession>;

export type SessionIdentity = {
  name: string | null;
  email: string | null;
};

/** Tracks a single chunk's audio and transcription state */
export type ChunkState = {
  index: number;
  audioChunks: Uint8Array[];
  totalBytes: number;
  status: 'buffering' | 'transcribing' | 'done';
  result?: string;
  sttStartAt?: number;
  sttDoneAt?: number;
};

export function createEmptySession() {
  return {
    version: 2,
    format: 'pcm16le' as const,
    rate: 16000,
    startedAt: Date.now(),
    frames: 0,
    chunks: [] as Uint8Array[],
    totalBytes: 0,
    lastSeq: null as number | null,
    seqGaps: 0,
    firstArrivalMs: null as number | null,
    lastArrivalMs: null as number | null,
    canceled: false,
    traceId: undefined as string | undefined,
    wsAcceptAt: undefined as number | undefined,
    processingStartAt: undefined as number | undefined,
    mode: 'dictation' as ClientSessionMode,
    selection: null as ClientSelectionPayload | null,
    shareTranscriptions: false,
    identity: { name: null, email: null } as SessionIdentity,
    // Chunked transcription state
    chunkStates: new Map<number, ChunkState>(),
    currentChunkIndex: 0,
    pendingChunkSTT: new Set<number>(),
  };
}

export function logSession(
  log: (msg: string, ctx?: Record<string, unknown>) => void,
  tag: string,
  s: AudioSession,
  extra?: Record<string, unknown>,
) {
  try {
    const info = {
      tag,
      traceId: s.traceId ?? null,
      frames: s.frames,
      bytesKB: Number((s.totalBytes / 1024).toFixed(2)),
      seqGaps: s.seqGaps,
      firstToLastArrivalMs:
        s.firstArrivalMs && s.lastArrivalMs
          ? s.lastArrivalMs - s.firstArrivalMs
          : null,
      mode: s.mode,
      ...extra,
    };
    log('session', info);
  } catch (error) {
    log('logSession error', { error: String(error) });
  }
}
