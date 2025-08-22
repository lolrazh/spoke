import { Hono } from 'hono';

type Bindings = {
  GROQ_API_KEY?: string;
  GROQ_STT_MODEL?: string; // e.g., whisper-large-v3-turbo
};

const app = new Hono<{ Bindings: Bindings }>();

// Health
app.get('/', (c) => c.text('ok'));

// WebSocket ingest: 100 ms PCM16@16k frames
app.get('/ws', (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('Expected a websocket connection', 426);
  }

  const { GROQ_API_KEY, GROQ_STT_MODEL } = c.env;
  const [client, server] = Object.values(new WebSocketPair());

  let session = createEmptySession();
  // Track if socket has closed and allow aborting any in-flight STT
  let socketClosed = false;
  let sttAbort: AbortController | null = null;

  server.accept();
  try {
    console.log("[WS] accepted");
  } catch {}
  server.addEventListener('message', async (evt: MessageEvent) => {
    try {
      const data = evt.data;
      if (typeof data === 'string') {
        const msg = safeJson(data);
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'start') {
          try { console.log('[WS] start'); } catch {}
          // Reset for a new session
          session = createEmptySession();
          session.startedAt = Date.now();
          session.version = msg.version ?? 1;
          session.format = msg.format ?? 'pcm16le';
          session.rate = msg.rate ?? 16000;
          // (optional) language = msg.language
        } else if (msg.type === 'end') {
          const t0 = Date.now();
          // Signal processing started
          if (!socketClosed) {
            try { server.send(JSON.stringify({ type: 'status', state: 'processing' })); } catch {}
          }

          // If canceled or empty, short-circuit
          if (session.canceled || session.totalBytes === 0) {
            const text = '';
            server.send(JSON.stringify({ type: 'final', text }));
            session = createEmptySession();
            return;
          }

          // Assemble PCM → WAV
          const pcm = concat(session.chunks, session.totalBytes);
          const wav = wrapWav(pcm, session.rate, 1, 16);

          // Call GROQ STT if key available
          let finalText = '';
          try {
            if (GROQ_API_KEY) {
              // Allow canceling if the client disconnects while STT is running
              sttAbort?.abort();
              sttAbort = new AbortController();
              const res = await groqTranscribe(
                wav,
                GROQ_API_KEY,
                GROQ_STT_MODEL || 'whisper-large-v3-turbo',
                sttAbort.signal,
              );
              finalText = res?.text ?? '';
            } else {
              finalText = '';
            }
          } catch (e: any) {
            if (!socketClosed) {
              try { server.send(JSON.stringify({ type: 'error', body: e?.message || 'Transcription error' })); } catch {}
            }
            session = createEmptySession();
            return;
          }

          if (!socketClosed) {
            try { server.send(JSON.stringify({ type: 'final', text: finalText })); } catch {}
          }

          const t1 = Date.now();
          logSession('final', session, { assembleMs: t1 - t0, textLen: finalText.length });
          session = createEmptySession();
        } else if (msg.type === 'cancel') {
          // Discard buffered audio, but keep the socket open for reuse
          session = createEmptySession();
          session.canceled = true;
          // Abort any transcription in flight
          try { sttAbort?.abort(); } catch {}
        }
      } else if (data instanceof ArrayBuffer) {
        // Binary frame: [16-byte header][payload]
        const buf = new Uint8Array(data);
        if (buf.byteLength < 16) return; // ignore
        const { seq, nbytes } = parseFrameHeader(buf);
        if (16 + nbytes > buf.byteLength) return; // malformed
        const payload = buf.subarray(16, 16 + nbytes);

        // Initialize first/last arrival tracking
        const now = Date.now();
        if (session.firstArrivalMs === null) session.firstArrivalMs = now;
        session.lastArrivalMs = now;

        // Track seq and gaps
        if (session.lastSeq !== null && seq !== session.lastSeq + 1) {
          session.seqGaps += 1;
        }
        session.lastSeq = seq;

        // Enforce a max buffer size (~20 MB)
        const MAX_BYTES = 20 * 1024 * 1024;
        if (session.totalBytes + payload.byteLength > MAX_BYTES) {
          server.send(JSON.stringify({ type: 'error', body: 'audio too large' }));
          session = createEmptySession();
          return;
        }

        // Append
        session.chunks.push(payload);
        session.totalBytes += payload.byteLength;
        session.frames += 1;
      }
    } catch (e: any) {
      console.error('[Worker] WebSocket message error:', e);
      try {
        server.send(JSON.stringify({ type: 'error', body: e?.message || 'ws error' }));
      } catch {}
      session = createEmptySession();
    }
  });

  server.addEventListener('close', (evt) => {
    // Clean up session on WebSocket close
    logSession('ws_close', session, { 
      code: (evt as any)?.code || 'unknown',
      reason: (evt as any)?.reason || 'unknown'
    });
    socketClosed = true;
    try { sttAbort?.abort(); } catch {}
    sttAbort = null;
    session = createEmptySession();
  });

  return new Response(null, { status: 101, webSocket: client });
});

export default {
  fetch: (req: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(req, env, ctx),
};

// ---- Helpers ----

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

function parseFrameHeader(buf: Uint8Array) {
  // u32 seq | u32 nbytes | u64 ts
  const view = new DataView(buf.buffer, buf.byteOffset, 16);
  const seq = view.getUint32(0, true);
  const nbytes = view.getUint32(4, true);
  // const tsLo = view.getUint32(8, true); const tsHi = view.getUint32(12, true);
  return { seq, nbytes };
}

function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function wrapWav(pcm: Uint8Array, rate = 16000, channels = 1, bitsPerSample = 16): Uint8Array {
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  // RIFF
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  // fmt
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  const byteRate = (rate * channels * bitsPerSample) >> 3;
  const blockAlign = (channels * bitsPerSample) >> 3;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function createEmptySession() {
  return {
    version: 2,
    format: 'pcm16le' as 'pcm16le',
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
  };
}

function logSession(tag: string, s: ReturnType<typeof createEmptySession>, extra?: Record<string, unknown>) {
  try {
    const info = {
      tag,
      frames: s.frames,
      bytesKB: Number((s.totalBytes / 1024).toFixed(2)),
      seqGaps: s.seqGaps,
      firstToLastArrivalMs: (s.firstArrivalMs && s.lastArrivalMs) ? (s.lastArrivalMs - s.firstArrivalMs) : null,
      ...extra,
    };
    console.log('[WS]', info);
  } catch {}
}

async function groqTranscribe(
  wav: Uint8Array,
  apiKey: string,
  model: string,
  externalSignal?: AbortSignal,
): Promise<{ text: string } | null> {
  const form = new FormData();
  const file = new File([wav], 'audio.wav', { type: 'audio/wav' });
  form.append('file', file);
  form.append('model', model);
  // Optional params: language, response_format, temperature, etc.

  // Add timeout to prevent hanging
  // Compose a controller that aborts on either timeout or external signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GROQ STT error: ${res.status} ${body}`);
      }
      const json = await res.json();
      // OpenAI-compatible response shape: { text: string, ... }
      return json as { text: string };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    if (err.name === 'AbortError') {
      throw new Error('Transcription aborted or timed out');
    }
    throw err;
  }
}
