# HTTP + Opus Migration Specification

**Date:** 2026-01-25
**Status:** Draft
**Author:** Claude (Opus 4.5)

## Executive Summary

Migrate from WebSocket-based real-time audio streaming to HTTP POST with Opus-encoded audio. This eliminates WS backpressure issues causing 15-second timeouts while simplifying the architecture by ~60%.

### Why This Migration?

| Problem | Root Cause | HTTP Solution |
|---------|------------|---------------|
| 15s timeout failures | WS backpressure delays `end` behind audio | No backpressure—single atomic upload |
| Complex state machine | 5+ connection state refs | Single request/response |
| Sequence tracking | Binary protocol needs gap detection | Opus handles ordering internally |
| Connection reliability | WS Hibernation quirks on CF | HTTP is CF's native model |

### Key Decisions

- **Final result only** — No LLM streaming deltas (simpler)
- **Pre-flight pattern** — Two endpoints to preserve parallelization
- **Keep OCR** — Optional screenshot for vocabulary context
- **Stay on Cloudflare** — HTTP is CF's strength; no AWS migration needed

---

## The Parallelization Problem

### What WebSocket Does Well

Currently, auth and OCR run **in parallel with the user speaking**:

```
User presses button
├── WS opens → Auth starts (PARALLEL with speaking)
├── OCR request fires (PARALLEL with speaking)
└── User speaks... audio streams...

User stops
├── Auth ✓ already done
├── OCR ✓ already done
└── Transcribe immediately with full context
```

### Naive HTTP Would Lose This

If we just used a single `/transcribe` endpoint:

```
User presses button
└── User speaks... recording locally...

User stops
├── Upload audio
├── Auth runs ← ADDED LATENCY (~50-150ms)
├── OCR runs ← ADDED LATENCY (~300-500ms)
└── Transcribe (with late context)
```

**We'd add 400-650ms to the critical path.** Not acceptable.

---

## Why NOT Cloudflare Workflows

### What Workflows Are For
- Long-running, durable tasks (hours/days)
- Multi-step processes with failure recovery
- Tasks that need to survive worker restarts

### Why It Doesn't Fit Here
1. **No "wait for external event"** — Workflows can't pause for "user finishes speaking"
2. **Overkill** — Your transcription takes 2-5 seconds, not hours
3. **Added complexity** — Step definitions, persistence, retries for something simple
4. **Auth twice anyway** — Workflows still need auth on the trigger request

### What You'd Actually Need
If you wanted stateful "start session, then complete later," you'd need **Durable Objects**. But that's basically WebSocket with extra steps.

---

## The Solution: Pre-flight Pattern

Two simple HTTP requests that achieve the same parallelization as WebSocket:

```
User presses button
├── Capture screenshot (if available)
├── POST /prepare (fire-and-forget, don't await)
│   ├── Auth: Bearer <token>
│   ├── Body: { screenshot?: base64 }
│   └── Response: { ocrWords: [...] }  ← stored when it arrives
├── Start MediaRecorder (Opus)
│
User speaks... (recording locally)
│   └── /prepare response arrives in background → store ocrWords
│
User stops
├── Assemble Opus blob
├── POST /transcribe
│   ├── Auth: Bearer <token>
│   ├── Body: { audio, ocrWords, metadata }  ← ocrWords from /prepare
│   └── Response: { text, metrics }
```

### Why This Works

| Concern | Solution |
|---------|----------|
| OCR before transcribe | OCR runs during speaking, results passed to /transcribe |
| Auth not on critical path | Auth happens on /prepare (during speaking), JWKS cached for /transcribe |
| No double auth overhead | JWKS cached after /prepare, second auth is ~0-10ms |
| Simple HTTP | Two straightforward POST endpoints |

---

## Current vs. Target Architecture

### Current (WebSocket)

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                 │
│  AudioWorklet → PCM16 frames → Binary WS queue → backpressure?  │
│       ↓                              ↓                          │
│  16-byte headers              State machine (5+ refs)           │
│       ↓                              ↓                          │
│  Sequence numbers             Connection lifecycle mgmt         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ WS
┌─────────────────────────────────────────────────────────────────┐
│ WORKER (ws.ts - 571 lines)                                      │
│                                                                 │
│  Message dispatcher → handleAudioFrame (accumulate chunks)      │
│       ↓                                                         │
│  Auth handshake → handleEnd → pipeline orchestration            │
│       ↓                                                         │
│  ConnectionContext (stateful session)                           │
└─────────────────────────────────────────────────────────────────┘
```

**Pain points:**
- `useTranscription.ts`: 2,677 lines
- Binary protocol with 16-byte headers
- Queue management with `WS_MAX_BUFFERED_BYTES`
- 5 connection state refs: `wsReadyRef`, `wsAuthenticatedRef`, `wsAuthPendingRef`, `wsAuthFailedRef`, `connectionPromiseRef`
- Sequence gap tracking

### Target (HTTP + Opus with Pre-flight)

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                 │
│  User presses button:                                           │
│  ├── POST /prepare (async) → stores ocrWords when done          │
│  └── MediaRecorder (Opus) starts                                │
│                                                                 │
│  User stops:                                                    │
│  ├── Assemble Opus blob                                         │
│  └── POST /transcribe { audio, ocrWords, metadata }             │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌─────────────────────────────────────────────────────────────────┐
│ WORKER (http.ts - ~250 lines)                                   │
│                                                                 │
│  /prepare: Auth + OCR (fast, runs during speaking)              │
│  /transcribe: Auth (cached) → STT → Route → Enhance             │
│       ↓                                                         │
│  JSON response { text, wordCount, metrics }                     │
└─────────────────────────────────────────────────────────────────┘
```

**Simplifications:**
- ~700 lines estimated (vs 3,248 combined)
- No binary protocol—browser handles Opus encoding
- No connection state—just request context
- No sequence tracking—Opus is self-contained
- No backpressure—single upload
- Same parallelization as WebSocket

---

## Detailed Design

### Endpoint 1: `POST /prepare`

**Purpose:** Pre-warm auth + extract OCR (runs while user speaks)

#### Request

```
POST /prepare
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{
  "screenshot"?: string,    // base64, optional, max 1.5MB
  "clientTraceId"?: string  // for correlation
}
```

#### Response (Success)

```typescript
{
  "success": true,
  "ocrWords": ["word1", "word2", ...],  // empty if no screenshot
  "quotaRemaining": 500,                 // helpful for client UI
  "traceId": "abc-123"
}
```

#### Response (Auth Error)

```typescript
{
  "success": false,
  "error": "Invalid token",
  "code": "AUTH_FAILED"
}
```

#### Response (Quota Exceeded)

```typescript
{
  "success": false,
  "error": "Weekly quota exceeded",
  "code": "QUOTA_EXCEEDED",
  "quotaRemaining": 0
}
```

#### Server Implementation

```typescript
app.post('/prepare', async (c) => {
  const startAt = Date.now();
  const traceId = generateTraceId();

  // 1. Auth (warms JWKS cache for subsequent /transcribe)
  const auth = await verifyAuth(c);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error, code: auth.code }, 401);
  }

  // 2. Quota check (fail fast before user finishes speaking)
  if (!auth.subscriptionActive && auth.wordsUsed >= auth.quotaLimit) {
    return c.json({
      success: false,
      error: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED',
      quotaRemaining: 0
    }, 402);
  }

  // 3. OCR (if screenshot provided)
  let ocrWords: string[] = [];
  const body = await c.req.json().catch(() => ({}));

  if (body.screenshot) {
    ocrWords = await extractOCR(body.screenshot, c.env);
  }

  return c.json({
    success: true,
    ocrWords,
    quotaRemaining: auth.quotaLimit - auth.wordsUsed,
    traceId: body.clientTraceId || traceId,
  });
});
```

**Timing:** ~100-600ms (auth: 50-150ms, OCR: 100-500ms if screenshot)

---

### Endpoint 2: `POST /transcribe`

**Purpose:** Transcribe audio with pre-computed context

#### Request

```
POST /transcribe
Authorization: Bearer <supabase_jwt>
Content-Type: multipart/form-data

Fields:
  audio: File (webm/opus, max 10MB)
  metadata: JSON string
```

#### Metadata Schema

```typescript
interface TranscribeMetadata {
  mode: 'dictation' | 'edit';
  language?: string;              // default: 'en'
  ocrWords?: string[];            // from /prepare response
  selection?: {
    text: string;
    start: number;
    end: number;
    appName?: string;
    windowTitle?: string;
  };
  identity?: {
    name?: string;
    email?: string;
  };
  shareTranscriptions?: boolean;
  traceId?: string;
}
```

#### Response (Success)

```typescript
{
  "success": true,
  "text": "The transcribed and enhanced text.",
  "wordCount": 6,
  "traceId": "abc-123",
  "metrics": {
    "totalMs": 2100,
    "sttMs": 1200,
    "llmMs": 800,
    "audioBytes": 387654,
    "audioDurationMs": 120000
  },
  "dataset"?: {
    "sttText": "raw transcription",
    "llmText": "enhanced text"
  }
}
```

#### Response (Error)

```typescript
{
  "success": false,
  "error": "Transcription failed",
  "code": "AUTH_FAILED" | "QUOTA_EXCEEDED" | "INVALID_AUDIO" | "PROCESSING_FAILED" | "TIMEOUT"
}
```

#### Server Implementation

```typescript
app.post('/transcribe', async (c) => {
  const startAt = Date.now();

  // 1. Auth (fast: JWKS already cached from /prepare)
  const auth = await verifyAuth(c);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error, code: auth.code }, 401);
  }

  // 2. Parse request
  const formData = await c.req.formData();
  const audioFile = formData.get('audio') as File;
  const metadata = JSON.parse(formData.get('metadata') as string || '{}');

  if (!audioFile) {
    return c.json({ success: false, error: 'Missing audio', code: 'INVALID_AUDIO' }, 400);
  }

  // 3. Build STT prompt with ocrWords (already extracted!)
  const sttPrompt = buildSTTPrompt({
    identity: metadata.identity,
    ocrWords: metadata.ocrWords || [],  // ← from /prepare, no waiting!
  });

  // 4. Transcribe (Groq accepts webm/opus directly)
  const audioBuffer = await audioFile.arrayBuffer();
  const sttStart = Date.now();
  const stt = await transcribeOpus(audioBuffer, {
    language: metadata.language || 'en',
    prompt: sttPrompt,
    env: c.env,
  });
  const sttMs = Date.now() - sttStart;

  if (!stt.text) {
    return c.json({ success: false, error: 'Transcription failed', code: 'PROCESSING_FAILED' }, 500);
  }

  // 5. Route + Enhance
  const route = routeTranscript(stt.text, metadata.mode);
  let finalText = stt.text;
  let llmMs: number | undefined;

  if (route.requiresLLM) {
    const llmStart = Date.now();
    const enhanced = await enhance({
      text: stt.text,
      route,
      mode: metadata.mode,
      selection: metadata.selection,
      env: c.env,
    });
    finalText = enhanced.text;
    llmMs = Date.now() - llmStart;
  }

  // 6. Background tasks
  const wordCount = finalText.split(/\s+/).filter(Boolean).length;
  c.executionCtx.waitUntil(scheduleQuotaIncrement(auth.userId, wordCount, c.env));
  c.executionCtx.waitUntil(scheduleAnalytics({ traceId: metadata.traceId, ... }, c.env));

  // 7. Response
  return c.json({
    success: true,
    text: finalText,
    wordCount,
    traceId: metadata.traceId,
    metrics: {
      totalMs: Date.now() - startAt,
      sttMs,
      llmMs,
      audioBytes: audioBuffer.byteLength,
      audioDurationMs: estimateAudioDuration(audioBuffer.byteLength),
    },
    dataset: metadata.shareTranscriptions ? {
      sttText: stt.text,
      llmText: route.requiresLLM ? finalText : undefined,
    } : undefined,
  });
});
```

**Timing:**
- Auth: ~0-10ms (JWKS cached from /prepare)
- STT: ~1000-2000ms
- LLM: ~500-1500ms (if needed)
- Total: ~1500-3500ms

---

## Client Implementation

### Hook: `useHttpTranscription.ts`

```typescript
export function useHttpTranscription() {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const prepareResultRef = useRef<PrepareResult | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async (screenshot?: string) => {
    // 1. LOCAL QUOTA CHECK (instant feedback, preserves current UX)
    const quotaUsed = parseInt(localStorage.getItem('sf.quotaWordsUsed') || '0');
    const quotaLimit = parseInt(localStorage.getItem('sf.quotaLimit') || '1000');
    const subscriptionActive = localStorage.getItem('sf.subscriptionActive') === 'true';

    if (!subscriptionActive && quotaUsed >= quotaLimit) {
      setError('Quota exceeded');
      // Show notification immediately - don't start recording
      showNotification('Weekly quota exceeded. Upgrade for unlimited dictation.');
      return;
    }

    setRecording(true);
    setError(null);
    prepareResultRef.current = null;
    chunksRef.current = [];

    const token = await getAccessToken();

    // 1. Fire /prepare (don't await - runs in parallel with speaking)
    fetch(`${API_URL}/prepare`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ screenshot }),
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          prepareResultRef.current = result;
        } else {
          // Auth failed or quota exceeded - stop early
          setError(result.error);
          cancelRecording();
        }
      })
      .catch(err => {
        console.warn('Prepare failed, will proceed without OCR:', err);
      });

    // 2. Start MediaRecorder (parallel with /prepare)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedMic,
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(100);
    mediaRecorderRef.current = recorder;

    // 3. Set up audio level monitoring (optional)
    setupAudioLevelMonitor(stream, setAudioLevel);
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;

    setRecording(false);
    setProcessing(true);

    // POST-ROLL: Wait 200ms to capture end of last word (matches POST_ROLL_MS=240)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Wait for recorder to stop and get blob
    const audioBlob = await new Promise<Blob>((resolve) => {
      mediaRecorderRef.current!.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: 'audio/webm' }));
      };
      mediaRecorderRef.current!.stop();
    });

    // Get ocrWords from prepare (may be null if /prepare still pending)
    const ocrWords = prepareResultRef.current?.ocrWords || [];
    const traceId = prepareResultRef.current?.traceId;

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('metadata', JSON.stringify({
        mode: 'dictation',
        ocrWords,
        traceId,
        language: 'en',
        identity: { name: profile?.displayName, email: profile?.email },
        shareTranscriptions: profile?.shareTranscriptions,
      }));

      const response = await fetch(`${API_URL}/transcribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      const result = await response.json();

      if (result.success) {
        setText(result.text);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const cancelRecording = () => {
    mediaRecorderRef.current?.stop();
    chunksRef.current = [];
    setRecording(false);
  };

  return { recording, processing, text, error, audioLevel, startRecording, stopRecording, cancelRecording };
}
```

---

## Preserving Current Behavior

### Two-Level Quota Gating

The current WS architecture has two-level quota checking. We must preserve this:

**Level 1: Local (Instant Feedback)**
```typescript
// BEFORE starting recording - check localStorage
const quotaUsed = parseInt(localStorage.getItem('sf.quotaWordsUsed') || '0');
const quotaLimit = parseInt(localStorage.getItem('sf.quotaLimit') || '1000');

if (quotaUsed >= quotaLimit) {
  // Show notification IMMEDIATELY - don't even start recording
  showNotification('Quota exceeded');
  return;
}

// Only start recording if local check passes
startRecording();
```

**Level 2: Server (Authoritative)**
- `/prepare` checks JWT claims quota
- If exceeded → returns error → stops recording early
- Server is source of truth (local can be tampered)

**Why both?**
- Local: Instant UX (no frozen frequency bars)
- Server: Security (untamperable, authoritative)

### VAD / Silence Handling

Current WS uses VAD for per-frame silence cutting. With MediaRecorder:

**Change:** No per-frame VAD control
**Mitigation:**
1. Groq Whisper handles trailing silence well
2. MediaRecorder has clean start/stop boundaries
3. Monitor for hallucinations post-migration
4. Can add client-side VAD post-processing if needed

### Post-Roll Audio

Current: `POST_ROLL_MS=240` prevents end-of-speech clipping

**HTTP approach:**
```typescript
const stopRecording = async () => {
  // Wait 200ms after user releases PTT before stopping MediaRecorder
  // This captures the end of the last word
  await new Promise(resolve => setTimeout(resolve, 200));
  mediaRecorderRef.current.stop();
};
```

### Rate Limiting

Current: 5 concurrent connections per IP

**HTTP approach:**
- Add rate limiting middleware to both endpoints
- `/prepare`: 10 requests/minute per IP
- `/transcribe`: 10 requests/minute per IP
- Return 429 if exceeded

---

## Edge Cases Handled

### 1. /prepare Fails During Recording

```typescript
// In the /prepare .then() callback:
if (!result.success) {
  setError(result.error);  // Show "Quota exceeded" immediately
  cancelRecording();       // Cancel recording
}
```

User sees error **before** they finish speaking → no wasted time.

### 2. /prepare Still Pending When User Stops

```typescript
// ocrWords will be empty array
const ocrWords = prepareResultRef.current?.ocrWords || [];
```

Transcription proceeds without OCR context. Graceful degradation.

### 3. /prepare Network Error

```typescript
.catch(err => {
  console.warn('Prepare failed, will proceed without OCR:', err);
  // Don't set error - let user complete recording
  // /transcribe will still work, just without OCR
});
```

Non-blocking failure. User experience preserved.

### 4. User Cancels During Recording

```typescript
const cancelRecording = () => {
  mediaRecorderRef.current?.stop();
  chunksRef.current = [];
  setRecording(false);
  // Don't call /transcribe - nothing to transcribe
};
```

No wasted API calls.

---

## Timing Comparison

### Current WebSocket

```
T+0ms     User presses button
T+0ms     WS opens, auth starts
T+0ms     OCR request fires (async)
T+50ms    Auth complete (warm)
T+300ms   OCR complete
T+0-2000ms User speaks...
T+2000ms  User stops, sends END
T+2000ms  Transcribe starts (auth ✓, OCR ✓)
T+4000ms  Result received
─────────────────────────────────
Total user-perceived latency: 2000ms (after stop)
```

### New HTTP (Pre-flight)

```
T+0ms     User presses button
T+0ms     POST /prepare fires (async)
T+0ms     MediaRecorder starts
T+50ms    /prepare auth complete
T+300ms   /prepare OCR complete, stored
T+0-2000ms User speaks...
T+2000ms  User stops
T+2000ms  POST /transcribe (auth fast: cached, OCR: already have it)
T+4000ms  Result received
─────────────────────────────────
Total user-perceived latency: 2000ms (after stop)
```

**Same latency!** We've preserved the parallelization.

---

## Audio Format Comparison

| Aspect | PCM16 (Current) | Opus (Target) |
|--------|-----------------|---------------|
| Encoding | Raw samples | Compressed codec |
| Size (1 min) | ~1.92 MB | ~180-240 KB |
| Size (2 min) | ~3.84 MB | ~360-480 KB |
| Browser support | Manual worklet | Native MediaRecorder |
| Groq support | ✅ (via WAV wrapper) | ✅ (webm/opus native) |
| Quality | Lossless | Excellent for speech |
| CPU (client) | High (worklet processing) | Low (hardware codec) |

**Opus is ~10x smaller** with negligible quality loss for speech.

---

## Middleware Architecture (CF Workers Best Practices)

### Overview

The HTTP migration introduces proper middleware patterns following Hono/Cloudflare best practices:

```typescript
// worker/src/handlers/http.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';

const app = new Hono<{ Bindings: Bindings }>();

// 1. Global middleware (order matters!)
app.use('*', cors({
  origin: ['https://spoke.so', 'http://localhost:5173'],
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));

// 2. Per-route middleware
app.use('/prepare', rateLimitMiddleware({ max: 10, window: 60 }));
app.use('/prepare', authMiddleware);

app.use('/transcribe', rateLimitMiddleware({ max: 10, window: 60 }));
app.use('/transcribe', authMiddleware);

// 3. Global error handler
app.onError((err, c) => {
  console.error('[HTTP] Error:', err.message, { path: c.req.path });

  if (err instanceof AuthError) {
    return c.json({ success: false, error: err.message, code: err.code }, err.status);
  }

  return c.json({ success: false, error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
});

// 4. Routes
app.post('/prepare', handlePrepare);
app.post('/transcribe', handleTranscribe);

export default app;
```

---

### Middleware 1: CORS

**Why needed:** HTTP endpoints called from Electron renderer (different origin in dev).

```typescript
// worker/src/middleware/cors.ts
import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => {
    // Allow Electron app and dev server
    const allowed = [
      'https://spoke.so',
      'http://localhost:5173',
      'http://localhost:3000',
      'file://',  // Electron file:// protocol
    ];
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-Client-Version'],
  exposeHeaders: ['X-Request-Id'],
  maxAge: 86400,  // 24 hours preflight cache
  credentials: true,
});
```

---

### Middleware 2: Auth (Reusable)

**Current problem:** Auth is inline in WS handler, not reusable.

**Solution:** Extract to middleware that sets `c.var.auth`:

```typescript
// worker/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { verifySupabaseJwt } from '../auth/supabaseJwt';

export interface AuthContext {
  userId: string;
  email: string;
  subscriptionActive: boolean;
  wordsUsedThisWeek: number;
  quotaLimit: number;
}

export const authMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: { auth: AuthContext };
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing auth', code: 'AUTH_FAILED' }, 401);
  }

  const token = authHeader.slice(7);
  const supabaseUrl = c.env.SUPABASE_URL;

  if (!supabaseUrl) {
    return c.json({ success: false, error: 'Server misconfigured', code: 'INTERNAL_ERROR' }, 500);
  }

  // Skip auth in dev if SKIP_AUTH is set
  if (c.env.SKIP_AUTH === 'true') {
    c.set('auth', {
      userId: 'dev-user',
      email: 'dev@localhost',
      subscriptionActive: true,
      wordsUsedThisWeek: 0,
      quotaLimit: 1000,
    });
    return next();
  }

  const result = await verifySupabaseJwt(token, supabaseUrl);

  if (!result.success) {
    return c.json({ success: false, error: result.error, code: 'AUTH_FAILED' }, 401);
  }

  // Set auth context for downstream handlers
  c.set('auth', {
    userId: result.userId!,
    email: result.email || '',
    subscriptionActive: result.subscriptionActive || false,
    wordsUsedThisWeek: result.wordsUsedThisWeek || 0,
    quotaLimit: result.quotaLimit || 1000,
  });

  return next();
});
```

**Usage in handlers:**
```typescript
app.post('/prepare', authMiddleware, async (c) => {
  const auth = c.var.auth;  // Type-safe access

  // Check quota
  if (!auth.subscriptionActive && auth.wordsUsedThisWeek >= auth.quotaLimit) {
    return c.json({ success: false, error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 402);
  }

  // ... rest of handler
});
```

---

### Middleware 3: Rate Limiting

**Current problem:** In-memory Map, per-worker, connections only.

**Solution:** Use Cloudflare's built-in rate limiting or KV-based solution.

#### Option A: Cloudflare Rate Limiting Rules (Recommended)

Configure in `wrangler.jsonc` or dashboard - no code needed:
- 10 requests/minute per IP to `/prepare`
- 10 requests/minute per IP to `/transcribe`
- Returns 429 automatically

#### Option B: KV-Based Rate Limiting (Code Solution)

```typescript
// worker/src/middleware/rateLimit.ts
import { createMiddleware } from 'hono/factory';

interface RateLimitOptions {
  max: number;      // Max requests
  window: number;   // Window in seconds
}

export const rateLimitMiddleware = (options: RateLimitOptions) => {
  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const key = `ratelimit:${c.req.path}:${ip}`;

    // Use Cloudflare Cache API for distributed rate limiting
    const cache = caches.default;
    const cacheKey = new Request(`https://ratelimit.internal/${key}`);

    const cached = await cache.match(cacheKey);
    let count = cached ? parseInt(await cached.text()) : 0;

    if (count >= options.max) {
      return c.json(
        { success: false, error: 'Too many requests', code: 'RATE_LIMITED' },
        429,
        { 'Retry-After': String(options.window) }
      );
    }

    // Increment counter
    count++;
    const response = new Response(String(count), {
      headers: { 'Cache-Control': `max-age=${options.window}` },
    });
    await cache.put(cacheKey, response);

    return next();
  });
};
```

---

### Middleware 4: Request ID / Tracing

**Best practice:** Add request ID for correlation across logs.

```typescript
// worker/src/middleware/requestId.ts
import { createMiddleware } from 'hono/factory';

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  await next();
});
```

---

### Middleware 5: Global Error Handler

**Pattern:** Catch all errors, log, and return consistent JSON.

```typescript
// In http.ts
app.onError((err, c) => {
  const requestId = c.var.requestId || 'unknown';

  console.error('[HTTP] Error:', {
    requestId,
    path: c.req.path,
    error: err.message,
    stack: err.stack,
  });

  // Known error types
  if (err instanceof AuthError) {
    return c.json({
      success: false,
      error: err.message,
      code: err.code,
      requestId,
    }, err.status);
  }

  if (err instanceof QuotaError) {
    return c.json({
      success: false,
      error: err.message,
      code: 'QUOTA_EXCEEDED',
      quotaRemaining: 0,
      requestId,
    }, 402);
  }

  if (err instanceof ValidationError) {
    return c.json({
      success: false,
      error: err.message,
      code: 'INVALID_REQUEST',
      requestId,
    }, 400);
  }

  // Unknown errors - don't leak details
  return c.json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Not found',
    code: 'NOT_FOUND',
  }, 404);
});
```

---

### Middleware Order (Important!)

Middleware runs in order. Best practice:

```typescript
// 1. Request ID (first - needed for all logging)
app.use('*', requestIdMiddleware);

// 2. CORS (before auth - preflight needs to pass)
app.use('*', corsMiddleware);

// 3. Rate limiting (before auth - prevent brute force)
app.use('/prepare', rateLimitMiddleware({ max: 10, window: 60 }));
app.use('/transcribe', rateLimitMiddleware({ max: 10, window: 60 }));

// 4. Auth (after rate limit - most expensive operation)
app.use('/prepare', authMiddleware);
app.use('/transcribe', authMiddleware);

// 5. Routes
app.post('/prepare', handlePrepare);
app.post('/transcribe', handleTranscribe);
```

---

### Comparison: Current vs Target

| Aspect | Current (WS) | Target (HTTP) |
|--------|--------------|---------------|
| CORS | Not needed | ✅ `hono/cors` with allowed origins |
| Auth | Inline in handler | ✅ Reusable middleware, sets `c.var.auth` |
| Rate Limit | In-memory Map | ✅ Cache API or CF Rules (distributed) |
| Request ID | Manual trace ID | ✅ Middleware, auto-generated |
| Error Handler | Per-handler try/catch | ✅ Global `app.onError()` |
| 404 | N/A | ✅ Global `app.notFound()` |
| Validation | Manual type guards | Keep (or add Zod later) |

---

## Pipeline Modifications

### `transcribe.ts` — Add Opus Support

```typescript
// Current: transcribe(ctx) uses ctx.session.chunks (PCM16 WAV)
// New: transcribeOpus(buffer, options) takes webm/opus directly

export async function transcribeOpus(
  audioBuffer: ArrayBuffer,
  options: {
    language: string;
    prompt: string;
    env: Bindings;
  }
): Promise<{ text: string; timings: STTTimings }> {
  const startAt = Date.now();

  // Groq accepts webm/opus directly—no conversion needed!
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', options.language);
  formData.append('prompt', options.prompt);

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.env.GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`STT failed: ${response.status}`);
  }

  const result = await response.json();

  return {
    text: result.text,
    timings: {
      startAt,
      headersAt: Date.now(),
      bodyDoneAt: Date.now(),
    },
  };
}
```

---

## Migration Strategy

### Phase 1: Add HTTP Endpoints (Parallel)

1. Create `worker/src/handlers/http.ts` with `/prepare` and `/transcribe`
2. Add `transcribeOpus()` function alongside existing `transcribe()`
3. Mount routes in `worker/src/index.ts`
4. Test with curl/Postman
5. Deploy to staging

**Zero risk:** WS continues working, HTTP is additive.

### Phase 2: Client Migration

1. Create `src/hooks/useHttpTranscription.ts`
2. Simplify audio capture (MediaRecorder vs AudioWorklet encoding)
3. Feature flag: `VITE_USE_HTTP_TRANSCRIPTION=1`
4. Test in dev/staging
5. Compare metrics: latency, success rate, error types

### Phase 3: Gradual Rollout

1. Enable HTTP for 10% of users (random by userId hash)
2. Monitor error rates, latency percentiles
3. Increase to 50%, then 100%
4. Keep WS endpoint for 2 weeks as fallback

### Phase 4: Cleanup

1. Remove WS code from client (`useTranscription.ts`)
2. Remove WS handler from worker (`ws.ts`)
3. Remove binary protocol code
4. Update documentation

---

## Files to Create/Modify

### New Files

| File | Description | Est. Lines |
|------|-------------|------------|
| `worker/src/handlers/http.ts` | HTTP endpoints (/prepare, /transcribe) | ~250 |
| `worker/src/middleware/auth.ts` | Reusable auth middleware | ~60 |
| `worker/src/middleware/rateLimit.ts` | Rate limiting middleware | ~40 |
| `worker/src/middleware/requestId.ts` | Request ID/tracing middleware | ~15 |
| `worker/src/middleware/index.ts` | Middleware barrel export | ~10 |
| `src/hooks/useHttpTranscription.ts` | Client HTTP transcription hook | ~300 |
| `src/utils/audioRecorder.ts` | MediaRecorder wrapper | ~80 |

### Modified Files

| File | Changes |
|------|---------|
| `worker/src/index.ts` | Mount HTTP routes alongside WS |
| `worker/src/pipeline/transcribe.ts` | Add `transcribeOpus()` function |
| `src/components/App.tsx` | Import new hook based on feature flag |
| `src/config/api.ts` | Add HTTP endpoint URLs |

### Deleted Files (Phase 4)

| File | Lines Removed |
|------|---------------|
| `src/hooks/useTranscription.ts` | 2,677 |
| `worker/src/handlers/ws.ts` | 571 |
| `worker/src/pipeline/audio.ts` | 69 |
| `worker/src/ws/session.ts` | ~50 |

**Net reduction: ~2,500 lines**

---

## Error Code Mapping

| WS Close Code | Meaning | HTTP Status | HTTP Code |
|---------------|---------|-------------|-----------|
| 1000 | Normal close | 200 | - |
| 4011 | Auth timeout | N/A | Not applicable (single request) |
| 4012 | Unauthorized | 401 | `AUTH_FAILED` |
| 4020 | Payment required | 402 | `PAYMENT_REQUIRED` |
| 4021 | Quota exceeded | 402 | `QUOTA_EXCEEDED` |
| 4001 | STT API error | 500 | `PROCESSING_FAILED` |
| 4002 | STT timeout | 504 | `TIMEOUT` |
| 4003 | Audio too large | 413 | `INVALID_AUDIO` |

---

## Intentional Changes

### LLM Streaming Removed

**Current:** Server streams `llm_delta` messages for progressive UI updates
**HTTP:** Final result only (no streaming)

**Trade-off:** Slightly less perceived responsiveness for LLM-enhanced dictations
**Mitigation:** Processing spinner shows user that work is happening
**User impact:** Minimal (90% bypass LLM anyway with smart routing)

### No Partial Results

**Current:** `chunk_result` messages for progressive transcription (deprecated)
**HTTP:** Single final result

**Impact:** None (chunking was already deprecated/removed)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Opus browser compatibility | Low | Medium | Check `MediaRecorder.isTypeSupported()`, Electron uses Chromium |
| Groq rejects webm | Very Low | High | Test thoroughly; Groq docs confirm webm/opus support |
| /prepare race condition | Low | Low | Graceful degradation—proceed without OCR if pending |
| Larger files timeout | Low | Medium | 60s client timeout, CF has no body size limit for Workers |
| Metrics parity | Medium | Low | Ensure all current metrics are captured |
| VAD hallucinations | Low | Medium | Groq handles silence well; monitor post-migration |
| Local quota check missing | High | Medium | **Added to spec** - check localStorage before recording |

---

## Success Criteria

1. **Zero 15s timeout failures** caused by backpressure
2. **Latency parity** with WebSocket (pre-flight achieves same parallelization)
3. **Code reduction** of 2,000+ lines
4. **Successful 2-minute recordings** without issues
5. **All existing features working**: auth, quota, OCR, analytics
6. **Fail-fast on quota** — user sees error during recording, not after

---

## Cloudflare Workers: Still the Right Choice?

**Yes, for HTTP.** Here's why:

| Concern | WS (Current) | HTTP (Target) |
|---------|--------------|---------------|
| Reliability | WS Hibernation quirks | Native HTTP—rock solid |
| Timeout | 30s CPU limit (WS can hold open) | 30s CPU is plenty for transcription |
| Cold starts | Affects auth handshake | Single request, less impactful |
| Cost | Durable Objects for WS state | Simple Workers, cheaper |
| Debugging | Complex distributed state | Request/response traces |

**AWS comparison:**

- Lambda: 15-min timeout (not needed), cold starts worse than CF
- API Gateway: WebSocket support, but same complexity
- Cost: Higher than CF Workers for this use case

**Verdict:** Stay on Cloudflare, switch to HTTP. It's CF's strength.

---

## Appendix A: Opus MediaRecorder Compatibility

```typescript
// Check before using Opus
function supportsOpus(): boolean {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
}

// Fallback options
const AUDIO_FORMATS = [
  'audio/webm;codecs=opus',  // Chrome, Firefox, Edge
  'audio/mp4;codecs=aac',    // Safari (fallback)
  'audio/webm',              // Generic webm
];

function getBestFormat(): string {
  return AUDIO_FORMATS.find(f => MediaRecorder.isTypeSupported(f)) || 'audio/webm';
}
```

**Browser support:**
- Chrome 49+: ✅
- Firefox 25+: ✅
- Safari 14.1+: ⚠️ (webm limited, may need mp4/aac)
- Edge 79+: ✅

**Electron (your case):** Uses Chromium, so full Opus support guaranteed.

---

## Appendix B: Sample curl Tests

### Test /prepare

```bash
curl -X POST https://api.spoke.so/prepare \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"screenshot": "base64..."}'
```

### Test /transcribe

```bash
curl -X POST https://api.spoke.so/transcribe \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "audio=@recording.webm" \
  -F 'metadata={"mode":"dictation","language":"en","ocrWords":["word1","word2"]}'
```

---

## Metrics Parity Checklist

Ensure the HTTP response includes all metrics currently in WS `final` message:

| Metric | WS Location | HTTP Location | Status |
|--------|-------------|---------------|--------|
| `traceId` | `final.traceId` | `response.traceId` | ✅ |
| `wordCount` | `final.wordCount` | `response.wordCount` | ✅ |
| `text` | `final.text` | `response.text` | ✅ |
| `sttMs` | `final.metrics.worker.stt.totalMs` | `response.metrics.sttMs` | ✅ |
| `llmMs` | `final.metrics.worker.llm.totalMs` | `response.metrics.llmMs` | ✅ |
| `audioBytes` | `final.metrics.worker.bytes` | `response.metrics.audioBytes` | ✅ |
| `frames` | `final.metrics.worker.frames` | N/A (not needed for Opus) | ⚠️ Removed |
| `seqGaps` | `final.metrics.worker.seqGaps` | N/A (not needed for Opus) | ⚠️ Removed |
| `assembleMs` | `final.metrics.worker.assembleMs` | N/A (Opus doesn't need assembly) | ⚠️ Removed |
| `dataset` | `final.dataset` | `response.dataset` | ✅ |
| `llm_tier` | In session logs | Add to response | 🔧 Add |
| `llm_triggered_rules` | In session logs | Add to response | 🔧 Add |

**Client [Session] log should include:**
```typescript
console.log('[Session]', {
  trace_id: result.traceId,
  mode: metadata.mode,
  outcome: result.success ? 'success' : 'error',
  timing: {
    pttDownMs,
    recordingMs: stopTime - startTime,
    prepareMs: prepareEndTime - prepareStartTime,
    uploadMs: uploadEndTime - uploadStartTime,
    processingMs: result.metrics.totalMs,
  },
  audio: {
    bytes: result.metrics.audioBytes,
    durationMs: result.metrics.audioDurationMs,
  },
  server: {
    stt_ms: result.metrics.sttMs,
    llm_ms: result.metrics.llmMs,
    llm_tier: result.metrics.llmTier,
    llm_triggered_rules: result.metrics.llmTriggeredRules,
  },
  result: {
    text: result.text.substring(0, 100) + '...',
    wordCount: result.wordCount,
  }
});
```

---

## Compatibility Checklist

Before declaring migration complete, verify:

### Client-Side
- [ ] Local quota check shows notification immediately
- [ ] Audio level visualization works during recording
- [ ] Post-roll delay captures end of speech
- [ ] Edit mode selection capture still works
- [ ] History saved to electron-store on success
- [ ] [Session] log has all required fields

### Server-Side
- [ ] CORS allows Electron app origins
- [ ] Auth middleware extracts and validates JWT
- [ ] Auth middleware sets `c.var.auth` correctly
- [ ] Rate limiting returns 429 when exceeded
- [ ] Request ID middleware adds `X-Request-Id` header
- [ ] Global error handler returns consistent JSON
- [ ] `/prepare` validates JWT and returns quota info
- [ ] `/prepare` extracts OCR words from screenshot
- [ ] `/transcribe` accepts webm/opus audio
- [ ] STT prompt includes identity + OCR words
- [ ] Smart routing (bypass/default/advanced/edit) works
- [ ] Quota increment fires via `waitUntil`
- [ ] Analytics logged to Analytics Engine

### End-to-End
- [ ] Dictation mode produces correct text
- [ ] Edit mode rewrites selected text
- [ ] Quota increments after success
- [ ] Errors surface correctly to user
- [ ] Latency is comparable to WS (within 200ms)

---

## Next Steps

1. Review this spec
2. Clarify any questions
3. Begin Phase 1 implementation
