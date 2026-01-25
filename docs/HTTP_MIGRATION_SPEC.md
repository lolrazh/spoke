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
- **Single POST** — Opus compression makes 2-min recordings ~360KB
- **Keep OCR** — Optional screenshot for vocabulary context
- **Stay on Cloudflare** — HTTP is CF's strength; no AWS migration needed

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

### Target (HTTP + Opus)

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                 │
│  MediaRecorder (Opus) → collect chunks → Blob on stop           │
│       ↓                                                         │
│  fetch('/transcribe', { method: 'POST', body: formData })       │
│       ↓                                                         │
│  await response.json() → { text, metrics }                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌─────────────────────────────────────────────────────────────────┐
│ WORKER (http.ts - ~200 lines estimated)                         │
│                                                                 │
│  Hono route → auth middleware → parse multipart                 │
│       ↓                                                         │
│  pipeline.transcribe() → pipeline.route() → pipeline.enhance()  │
│       ↓                                                         │
│  JSON response { text, wordCount, metrics }                     │
└─────────────────────────────────────────────────────────────────┘
```

**Simplifications:**
- ~1,000 lines estimated (vs 3,248 combined)
- No binary protocol—browser handles Opus encoding
- No connection state—just request context
- No sequence tracking—Opus is self-contained
- No backpressure—single upload

---

## Detailed Design

### 1. HTTP Endpoint

**Route:** `POST /transcribe`

**Content-Type:** `multipart/form-data`

**Why multipart?** Allows binary audio + JSON metadata + optional image in one request.

#### Request Schema

```typescript
// Form fields
interface TranscribeRequest {
  // Required
  audio: File;           // webm/opus blob, max 10MB

  // Optional metadata (JSON string)
  metadata?: string;     // JSON.stringify(TranscribeMetadata)

  // Optional OCR
  screenshot?: File;     // PNG/JPEG, max 1.5MB
}

interface TranscribeMetadata {
  mode: 'dictation' | 'edit';
  language?: string;              // default: 'en'
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
  shareTranscriptions?: boolean;  // for dataset collection
  clientTraceId?: string;         // for correlation
}
```

#### Response Schema

```typescript
interface TranscribeResponse {
  success: true;
  text: string;
  wordCount: number;
  traceId: string;
  metrics: {
    totalMs: number;           // end-to-end
    sttMs: number;             // transcription time
    llmMs?: number;            // enhancement time (if used)
    audioBytes: number;        // input size
    audioDurationMs: number;   // estimated from size
  };
  dataset?: {
    sttText?: string;
    llmText?: string;
  };
}

interface TranscribeErrorResponse {
  success: false;
  error: string;
  code: 'AUTH_FAILED' | 'QUOTA_EXCEEDED' | 'INVALID_AUDIO' | 'PROCESSING_FAILED' | 'TIMEOUT';
}
```

#### Headers

```
Authorization: Bearer <supabase_access_token>
Content-Type: multipart/form-data
X-Client-Version: 2.0.0  (optional, for compatibility tracking)
```

---

### 2. Client Implementation

#### New Hook: `useHttpTranscription.ts`

```typescript
// Estimated: ~400 lines (vs 2,677 in useTranscription.ts)

interface UseHttpTranscriptionOptions {
  onTranscriptionComplete?: (text: string) => void;
  onError?: (error: TranscriptionError) => void;
}

interface UseHttpTranscriptionReturn {
  // State
  recording: boolean;
  processing: boolean;
  text: string;
  error: string | null;
  audioLevel: number;

  // Actions
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
}
```

#### Audio Capture with MediaRecorder

```typescript
// Key implementation details

const OPUS_OPTIONS = {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 32000,  // ~4KB/sec, good quality for speech
};

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: selectedMic,
      sampleRate: 48000,      // Opus native rate
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    }
  });

  mediaRecorderRef.current = new MediaRecorder(stream, OPUS_OPTIONS);
  chunksRef.current = [];

  mediaRecorderRef.current.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunksRef.current.push(e.data);
    }
  };

  // Request data every 100ms for progress tracking
  mediaRecorderRef.current.start(100);
}

async function stopRecording(): Promise<string> {
  return new Promise((resolve, reject) => {
    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

      try {
        const result = await uploadAndTranscribe(blob);
        resolve(result.text);
      } catch (error) {
        reject(error);
      }
    };

    mediaRecorderRef.current.stop();
  });
}
```

#### Upload Function

```typescript
async function uploadAndTranscribe(
  audioBlob: Blob,
  options: {
    mode: 'dictation' | 'edit';
    selection?: SelectionContext;
    screenshot?: Blob;
  }
): Promise<TranscribeResponse> {
  const token = await getAccessToken();
  if (!token) {
    throw new TranscriptionError('Not signed in', 'AUTH_FAILED');
  }

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  if (options.screenshot) {
    formData.append('screenshot', options.screenshot, 'context.png');
  }

  formData.append('metadata', JSON.stringify({
    mode: options.mode,
    selection: options.selection,
    language: 'en',
    identity: { name: profile?.displayName, email: profile?.email },
    shareTranscriptions: profile?.shareTranscriptions,
    clientTraceId: generateTraceId(),
  }));

  const response = await fetch(`${API_BASE_URL}/transcribe`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
    signal: AbortSignal.timeout(60000), // 60s timeout
  });

  if (!response.ok) {
    const error = await response.json();
    throw new TranscriptionError(error.error, error.code);
  }

  return response.json();
}
```

#### Audio Level Visualization

```typescript
// AudioWorklet still needed for real-time visualization
// But much simpler—just computes RMS, no encoding/queueing

class AudioLevelProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    // Compute RMS
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    const rms = Math.sqrt(sum / input.length);

    this.port.postMessage({ rms });
    return true;
  }
}
```

---

### 3. Worker Implementation

#### New Route: `worker/src/handlers/http.ts`

```typescript
// Estimated: ~200 lines

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleAuth } from '../pipeline/auth';
import { transcribeOpus } from '../pipeline/transcribe';
import { routeTranscript } from '../pipeline/router';
import { enhance } from '../pipeline/enhance';
import { extractOCR } from '../pipeline/ocr';
import { scheduleQuotaIncrement, scheduleAnalytics } from '../background/tasks';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/transcribe', cors({
  origin: ['https://spoke.so', 'http://localhost:5173'],
  allowMethods: ['POST'],
}));

app.post('/transcribe', async (c) => {
  const startAt = Date.now();
  const traceId = c.req.header('X-Trace-Id') || generateTraceId();

  // 1. Parse auth
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing auth', code: 'AUTH_FAILED' }, 401);
  }

  const token = authHeader.slice(7);
  const authResult = await handleAuth(token, c.env, traceId);
  if (!authResult.success) {
    return c.json({
      success: false,
      error: authResult.error,
      code: authResult.code
    }, authResult.code === 4003 ? 402 : 401);
  }

  // 2. Parse multipart
  const formData = await c.req.formData();
  const audioFile = formData.get('audio') as File | null;
  const screenshotFile = formData.get('screenshot') as File | null;
  const metadataStr = formData.get('metadata') as string | null;

  if (!audioFile) {
    return c.json({ success: false, error: 'Missing audio', code: 'INVALID_AUDIO' }, 400);
  }

  const metadata = metadataStr ? JSON.parse(metadataStr) : {};
  const audioBuffer = await audioFile.arrayBuffer();

  // 3. OCR (fire and forget, but await completion before LLM)
  let ocrWords: string[] = [];
  if (screenshotFile) {
    const imageBase64 = await blobToBase64(screenshotFile);
    ocrWords = await extractOCRSync(imageBase64, c.env);
  }

  // 4. Transcribe (Groq accepts webm/opus directly)
  const sttStart = Date.now();
  const sttResult = await transcribeOpus(audioBuffer, {
    language: metadata.language || 'en',
    prompt: buildSTTPrompt(metadata.identity, ocrWords),
    env: c.env,
  });
  const sttMs = Date.now() - sttStart;

  if (!sttResult.text) {
    return c.json({ success: false, error: 'Transcription failed', code: 'PROCESSING_FAILED' }, 500);
  }

  // 5. Route decision
  const route = await routeTranscript(sttResult.text, metadata.mode, c.env);

  // 6. Enhance if needed
  let finalText = sttResult.text;
  let llmMs: number | undefined;

  if (route.requiresLLM) {
    const llmStart = Date.now();
    const enhanceResult = await enhance({
      text: sttResult.text,
      route,
      mode: metadata.mode,
      selection: metadata.selection,
      env: c.env,
    });
    finalText = enhanceResult.text;
    llmMs = Date.now() - llmStart;
  }

  const wordCount = finalText.split(/\s+/).filter(Boolean).length;

  // 7. Background tasks
  c.executionCtx.waitUntil(
    scheduleQuotaIncrement({
      userId: authResult.userId!,
      wordCount,
      subscriptionActive: authResult.subscriptionActive,
      env: c.env,
    })
  );

  c.executionCtx.waitUntil(
    scheduleAnalytics({
      traceId,
      userId: authResult.userId!,
      wordCount,
      sttMs,
      llmMs,
      audioBytes: audioBuffer.byteLength,
      env: c.env,
    })
  );

  // 8. Response
  return c.json({
    success: true,
    text: finalText,
    wordCount,
    traceId,
    metrics: {
      totalMs: Date.now() - startAt,
      sttMs,
      llmMs,
      audioBytes: audioBuffer.byteLength,
      audioDurationMs: estimateAudioDuration(audioBuffer.byteLength),
    },
    dataset: metadata.shareTranscriptions ? {
      sttText: sttResult.text,
      llmText: route.requiresLLM ? finalText : undefined,
    } : undefined,
  });
});

export default app;
```

#### Pipeline Modifications

**`transcribe.ts` — Add Opus support:**

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

### 4. Audio Format Comparison

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

### 5. Migration Strategy

#### Phase 1: Add HTTP Endpoint (Parallel)

1. Create `worker/src/handlers/http.ts` with new route
2. Add `transcribeOpus()` function alongside existing `transcribe()`
3. Mount at `/transcribe` in `worker/src/index.ts`
4. Test with curl/Postman
5. Deploy to staging

**Zero risk:** WS continues working, HTTP is additive.

#### Phase 2: Client Migration

1. Create `src/hooks/useHttpTranscription.ts`
2. Simplify audio capture (MediaRecorder vs AudioWorklet encoding)
3. Feature flag: `VITE_USE_HTTP_TRANSCRIPTION=1`
4. Test in dev/staging
5. Compare metrics: latency, success rate, error types

#### Phase 3: Gradual Rollout

1. Enable HTTP for 10% of users (random by userId hash)
2. Monitor error rates, latency percentiles
3. Increase to 50%, then 100%
4. Keep WS endpoint for 2 weeks as fallback

#### Phase 4: Cleanup

1. Remove WS code from client (`useTranscription.ts`)
2. Remove WS handler from worker (`ws.ts`)
3. Remove binary protocol code
4. Update documentation

---

### 6. Files to Create/Modify

#### New Files

| File | Description | Est. Lines |
|------|-------------|------------|
| `worker/src/handlers/http.ts` | HTTP transcription endpoint | ~200 |
| `src/hooks/useHttpTranscription.ts` | Client HTTP transcription hook | ~400 |
| `src/utils/audioRecorder.ts` | MediaRecorder wrapper | ~100 |

#### Modified Files

| File | Changes |
|------|---------|
| `worker/src/index.ts` | Mount HTTP route alongside WS |
| `worker/src/pipeline/transcribe.ts` | Add `transcribeOpus()` function |
| `src/components/App.tsx` | Import new hook based on feature flag |
| `src/config/api.ts` | Add HTTP endpoint URL |

#### Deleted Files (Phase 4)

| File | Lines Removed |
|------|---------------|
| `src/hooks/useTranscription.ts` | 2,677 |
| `worker/src/handlers/ws.ts` | 571 |
| `worker/src/pipeline/audio.ts` | 69 |
| `worker/src/ws/session.ts` | ~50 |

**Net reduction: ~2,600 lines**

---

### 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Opus browser compatibility | Low | Medium | Check `MediaRecorder.isTypeSupported()`, fallback to WS |
| Groq rejects webm | Very Low | High | Test thoroughly; Groq docs confirm webm/opus support |
| Larger files timeout | Low | Medium | 60s client timeout, CF has no body size limit for Workers |
| OCR timing | Low | Low | Await OCR before STT prompt building |
| Metrics parity | Medium | Low | Ensure all current metrics are captured |

---

### 8. Success Criteria

1. **Zero 15s timeout failures** caused by backpressure
2. **Latency parity or better** (Opus smaller = faster upload)
3. **Code reduction** of 2,000+ lines
4. **Successful 2-minute recordings** without issues
5. **All existing features working**: auth, quota, OCR, analytics

---

### 9. Timeline Estimate

| Phase | Effort |
|-------|--------|
| Phase 1: HTTP endpoint | Small |
| Phase 2: Client migration | Medium |
| Phase 3: Rollout + monitoring | Small |
| Phase 4: Cleanup | Small |

---

### 10. Cloudflare Workers: Still the Right Choice?

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

## Appendix B: Sample curl Test

```bash
# Test HTTP endpoint
curl -X POST https://api.spoke.so/transcribe \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "audio=@recording.webm" \
  -F 'metadata={"mode":"dictation","language":"en"}'
```

---

## Next Steps

1. Review this spec
2. Clarify any questions
3. Begin Phase 1 implementation

