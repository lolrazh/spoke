# Worker Refactoring Specification

**Date:** 2025-12-28
**Status:** Draft
**Branch:** `worker-refactoring`

---

## Executive Summary

Refactor the 1890-line monolithic `ws.ts` handler into a modular pipeline architecture. This improves maintainability, enables lazy loading for the 90% bypass case, and removes ~500 lines of dead provider code.

**Key Outcomes:**
- Delete 4 unused provider files (OpenAI, OpenRouter, Deepgram, Fireworks)
- Split monolith into 6 focused modules (~150-200 lines each)
- Lazy load LLM module (only imported for 10% of requests)
- Replace nested if-else chains with message router pattern

---

## Current Architecture Problems

### 1. God Object Anti-Pattern
`worker/src/handlers/ws.ts` is 1890 lines with:
- 20+ closure variables shared across all handlers
- 5+ levels of nesting in the `end` message handler
- Duplicate error handling blocks (8 occurrences)
- Impossible to test components in isolation

### 2. Eager Loading Waste
All providers loaded at startup, even though:
- LLM is only needed for 10% of requests (bypass tier skips it)
- Deepgram and Fireworks STT are unused
- OpenAI and OpenRouter LLM are unused

### 3. Provider Selection Spaghetti
```typescript
// Current pattern (repeated 4x for STT, 6x for LLM):
const apiKey = provider === "fireworks" ? FIREWORKS_API_KEY
  : provider === "deepgram" ? DEEPGRAM_API_KEY
  : provider === "simplismart" ? SIMPLISMART_API_KEY
  : GROQ_API_KEY;
```

---

## Proposed Architecture

### Module Structure

```
worker/src/
├── index.ts                    # Hono app (unchanged)
├── config.ts                   # Simplified (remove dead endpoints)
│
├── handlers/
│   └── ws.ts                   # ORCHESTRATOR (~200 lines)
│                               # - WebSocket upgrade
│                               # - Message dispatch table
│                               # - Lifecycle events
│
├── pipeline/
│   ├── types.ts                # Shared types (ConnectionContext, etc.)
│   ├── auth.ts                 # Auth handler (~150 lines)
│   ├── audio.ts                # Binary frame accumulation (~80 lines)
│   ├── transcribe.ts           # STT orchestration (~150 lines)
│   ├── router.ts               # Bypass/LLM decision (~50 lines)
│   ├── enhance.ts              # LLM enhancement (~200 lines, LAZY)
│   └── ocr.ts                  # OCR extraction (~60 lines)
│
├── background/
│   └── tasks.ts                # waitUntil work (~50 lines)
│
├── services/
│   ├── llm/
│   │   ├── index.ts            # chatCompleteByProvider (4 providers)
│   │   ├── groq.ts
│   │   ├── baseten.ts
│   │   ├── cerebras.ts
│   │   └── simplismart.ts
│   │   # DELETED: openai.ts, openrouter.ts
│   │
│   └── stt/
│       ├── index.ts            # transcribeWav (2 providers)
│       └── providers/
│           ├── groq.ts
│           └── simplismart.ts
│           # DELETED: deepgram.ts, fireworks.ts
│
└── # Other files unchanged (auth/, audio/, utils/, ws/, types/)
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONNECTION CONTEXT                        │
│  Passed through pipeline, contains all session state             │
├─────────────────────────────────────────────────────────────────┤
│  server: WebSocket          │  session: Session                  │
│  env: Bindings              │  traceId: string                   │
│  clientIP: string           │  abortController: AbortController  │
│  runtime: RuntimeConfig     │  timing: TimingMetrics             │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  auth.ts │───▶│ audio.ts │───▶│transcribe│───▶│ router.ts│
└──────────┘    └──────────┘    │   .ts    │    └────┬─────┘
                                └──────────┘         │
                                                ┌────┴────┐
                                                │         │
                                             BYPASS    ENHANCE
                                              (90%)     (10%)
                                                │         │
                                                │    ┌────▼────┐
                                                │    │enhance.ts│
                                                │    │(lazy)   │
                                                │    └────┬────┘
                                                │         │
                                                └────┬────┘
                                                     │
                                                     ▼
                                              ┌──────────┐
                                              │ response │
                                              └──────────┘
                                                     │
                                                     ▼
                                              ┌──────────┐
                                              │background│
                                              │ tasks.ts │
                                              └──────────┘
```

---

## Phase 1: Delete Dead Providers

**Risk:** Low
**Behavior Change:** None (these providers aren't used in production)

### Files to Delete

| File | Lines | Reason |
|------|-------|--------|
| `worker/src/services/llm/openai.ts` | ~80 | Unused provider |
| `worker/src/services/llm/openrouter.ts` | ~120 | Unused provider |
| `worker/src/services/stt/providers/deepgram.ts` | ~100 | Unused provider |
| `worker/src/services/stt/providers/fireworks.ts` | ~100 | Unused provider |
| `worker/src/services/stt/deepgram.test.ts` | ~50 | Test for deleted code |
| `worker/src/services/stt/fireworks.test.ts` | ~50 | Test for deleted code |

**Total:** ~500 lines deleted

### Files to Modify

#### `worker/src/config.ts`
Remove:
```typescript
// DELETE these endpoints
export const OPENAI_LLM_ENDPOINT = "...";
export const OPENROUTER_LLM_ENDPOINT = "...";
export const FIREWORKS_STT_TURBO_ENDPOINT = "...";
export const FIREWORKS_STT_LARGE_ENDPOINT = "...";
export const DEEPGRAM_STT_ENDPOINT = "...";

// DELETE these models
export const OPENAI_LLM_DEFAULT_MODEL = "...";
export const OPENAI_ADVANCED_LLM_DEFAULT_MODEL = "...";
export const OPENAI_EDIT_LLM_DEFAULT_MODEL = "...";
export const OPENROUTER_LLM_DEFAULT_MODEL = "...";
export const OPENROUTER_ADVANCED_LLM_DEFAULT_MODEL = "...";
export const OPENROUTER_EDIT_LLM_DEFAULT_MODEL = "...";
export const FIREWORKS_STT_TURBO_MODEL = "...";
export const FIREWORKS_STT_LARGE_MODEL = "...";
export const DEEPGRAM_STT_DEFAULT_MODEL = "...";
export const FIREWORKS_STT_DEFAULT_VAD_MODEL = "...";
export const FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL = "...";
export const FIREWORKS_STT_DEFAULT_PREPROCESSING = "...";
export const FIREWORKS_STT_DEFAULT_TEMPERATURES = "...";

// UPDATE type definitions
export type LLMProvider = "groq" | "baseten" | "cerebras" | "simplismart";
// Remove: "openai" | "openrouter"

export type STTProvider = "groq" | "simplismart";
// Remove: "fireworks" | "deepgram"
```

#### `worker/src/services/llm/index.ts`
```typescript
// BEFORE (6 providers)
import { chatComplete as openaiChatComplete } from "./openai";
import { chatComplete as openRouterChatComplete } from "./openrouter";
// ...

// AFTER (4 providers)
import { chatComplete as groqChatComplete } from "./groq";
import { chatComplete as basetenChatComplete } from "./baseten";
import { chatComplete as cerebrasChatComplete } from "./cerebras";
import { chatComplete as simplismartChatComplete } from "./simplismart";

export async function chatCompleteByProvider(
  provider: LLMProvider,
  opts: ChatCompleteOptions,
): Promise<ChatResult> {
  switch (provider) {
    case "baseten":
      return basetenChatComplete(opts);
    case "cerebras":
      return cerebrasChatComplete(opts);
    case "simplismart":
      return simplismartChatComplete(opts);
    case "groq":
    default:
      return groqChatComplete(opts);
  }
}
```

#### `worker/src/services/stt/index.ts`
```typescript
// BEFORE (4 providers)
import { transcribeWav as transcribeFireworks } from "./providers/fireworks";
import { transcribeWav as transcribeDeepgram } from "./providers/deepgram";
// ...

// AFTER (2 providers)
import { transcribeWav as transcribeGroq } from "./providers/groq";
import { transcribeWav as transcribeSimplismart } from "./providers/simplismart";

export async function transcribeWav(
  wav: Uint8Array,
  opts: TranscribeOptions,
): Promise<TranscriptionResult> {
  const provider = opts.provider ?? STT_DEFAULT_PROVIDER;

  switch (provider) {
    case "simplismart":
      return transcribeSimplismart(wav, opts.apiKey, { ... });
    case "groq":
    default:
      return transcribeGroq(wav, opts.apiKey, { ... });
  }
}
```

#### `worker/src/handlers/ws.ts`
Remove:
- `FIREWORKS_API_KEY`, `DEEPGRAM_API_KEY` from destructuring
- `OPENAI_API_KEY`, `OPENROUTER_API_KEY` from destructuring
- All `FIREWORKS_*`, `DEEPGRAM_*`, `OPENAI_*`, `OPENROUTER_*` endpoint imports
- Provider selection branches for deleted providers
- `buildOpenRouterProviderConfig()` function (~50 lines)
- `buildOpenRouterHeaders()` function (~10 lines)
- All OpenRouter env bindings (~20 lines of type definitions)

#### `worker/src/index.ts`
Remove from Bindings type:
```typescript
// DELETE
FIREWORKS_API_KEY?: string;
DEEPGRAM_API_KEY?: string;
OPENAI_API_KEY?: string;
OPENROUTER_API_KEY?: string;
```

### Verification
```bash
# Build should pass
npm run build:worker

# Tests should pass (after deleting test files)
npm run test

# Grep for any remaining references
grep -r "openai\|openrouter\|deepgram\|fireworks" worker/src/ --include="*.ts"
```

---

## Phase 2: Extract Pipeline Types

**Risk:** Low
**Behavior Change:** None (just moving types)

### Create `worker/src/pipeline/types.ts`

```typescript
import type { Context } from "hono";
import type { Session } from "../ws/session";

/**
 * Runtime configuration from env vars
 */
export interface RuntimeConfig {
  stt: {
    provider: "groq" | "simplismart";
    model: string;
    language: string;
    timeoutMs: number;
    prompt: string;
  };
  llm: {
    enabled: boolean;
    provider: "groq" | "baseten" | "cerebras" | "simplismart";
    model: string;
    temperature: number;
    timeoutMs: number;
    stream: boolean;
    currentDate?: string;
  };
  edit: {
    enabled: boolean;
    provider: "groq" | "baseten" | "cerebras" | "simplismart";
    model: string;
    temperature: number;
    timeoutMs: number;
    stream: boolean;
  };
}

/**
 * Timing metrics collected throughout the pipeline
 */
export interface TimingMetrics {
  wsAcceptAt: number;
  authStartAt?: number;
  authDurationMs?: number;
  authWasColdStart?: boolean;
  ocrDurationMs?: number;
  firstFrameAt?: number;
  lastFrameAt?: number;
  processingStartAt?: number;
  assembleMs?: number;
  sttDurationMs?: number;
  sttTtfbMs?: number;
  routerOverheadMs?: number;
  llmDurationMs?: number;
  llmTtfbMs?: number;
}

/**
 * Connection context passed through the pipeline
 * Replaces the 20+ closure variables in current ws.ts
 */
export interface ConnectionContext {
  // WebSocket
  server: WebSocket;
  socketClosed: boolean;

  // Environment
  env: Bindings;
  clientIP: string;
  cfColo: string;

  // Runtime config
  runtime: RuntimeConfig;

  // Session state
  session: Session;
  traceId: string;

  // Auth state
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  subscriptionActive: boolean;

  // Control
  abortController: AbortController | null;
  authTimeoutHandle: ReturnType<typeof setTimeout> | null;

  // Flags
  sessionActive: boolean;
  finalSent: boolean;
  completionLogged: boolean;

  // Timing
  timing: TimingMetrics;

  // Language preference
  clientLanguage?: string;
}

/**
 * Result from STT pipeline stage
 */
export interface TranscribeResult {
  text: string;
  timings: {
    startAt: number;
    headersAt: number;
    bodyDoneAt: number;
  };
  provider: string;
  model: string;
}

/**
 * Result from router decision
 */
export interface RouteDecision {
  tier: "bypass" | "default" | "advanced" | "edit";
  requiresLLM: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  triggeredRules: string[];
  reason: string;
}

/**
 * Result from LLM enhancement
 */
export interface EnhanceResult {
  text: string;
  bypassed: boolean;
  timings?: {
    startAt: number;
    headersAt: number;
    firstDeltaAt?: number;
    bodyDoneAt: number;
  };
  provider?: string;
  model?: string;
}

// Re-export Bindings type for convenience
export type { Bindings } from "../handlers/ws";
```

---

## Phase 3: Extract Auth Handler

**Risk:** Medium
**Behavior Change:** None (same logic, different file)

### Create `worker/src/pipeline/auth.ts`

```typescript
import { verifySupabaseJwt, WS_CLOSE_CODES, AUTH_TIMEOUT_MS } from "../auth";
import { safeClose } from "../utils/ws";
import { safely } from "../utils/safely";
import { logSessionAuth } from "../utils/sessionLogger";
import type { ConnectionContext } from "./types";

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  subscriptionActive?: boolean;
  error?: string;
  code?: number;
}

/**
 * Sets up auth timeout - closes connection if no auth within timeout
 */
export function setupAuthTimeout(ctx: ConnectionContext): void {
  ctx.authTimeoutHandle = setTimeout(() => {
    if (!ctx.authenticated && !ctx.socketClosed) {
      logSessionAuth({
        outcome: "timeout",
        duration_ms: AUTH_TIMEOUT_MS,
        cold_start: false,
        trace_id: ctx.traceId,
      });

      safely(() =>
        ctx.server.send(
          JSON.stringify({
            type: "auth_error",
            error: "Authentication timeout - please send auth message",
            code: WS_CLOSE_CODES.AUTH_TIMEOUT,
          }),
        ),
      );
      safeClose(ctx.server, WS_CLOSE_CODES.AUTH_TIMEOUT, "auth timeout");
    }
  }, AUTH_TIMEOUT_MS);
}

/**
 * Clears auth timeout (called when auth message received)
 */
export function clearAuthTimeout(ctx: ConnectionContext): void {
  if (ctx.authTimeoutHandle) {
    clearTimeout(ctx.authTimeoutHandle);
    ctx.authTimeoutHandle = null;
  }
}

/**
 * Handles auth message - verifies JWT and checks quota
 */
export async function handleAuth(
  ctx: ConnectionContext,
  token: string,
): Promise<AuthResult> {
  const supabaseUrl = ctx.env.SUPABASE_URL;

  if (!supabaseUrl) {
    return {
      success: false,
      error: "Server configuration error",
      code: WS_CLOSE_CODES.UNAUTHORIZED,
    };
  }

  // Verify JWT
  const jwtStartAt = Date.now();
  const jwtResult = await verifySupabaseJwt(token, supabaseUrl);
  const jwtDurationMs = Date.now() - jwtStartAt;

  ctx.timing.authDurationMs = jwtDurationMs;
  ctx.timing.authWasColdStart = jwtDurationMs > 500;

  if (!jwtResult.valid) {
    logSessionAuth({
      outcome: "invalid",
      duration_ms: jwtDurationMs,
      cold_start: ctx.timing.authWasColdStart,
      trace_id: ctx.traceId,
    });

    return {
      success: false,
      error: jwtResult.code === "expired" ? "Token has expired" : "Invalid token",
      code: WS_CLOSE_CODES.UNAUTHORIZED,
    };
  }

  // Check quota for free tier
  if (!jwtResult.subscriptionActive) {
    const wordsUsed = jwtResult.wordsUsedThisWeek ?? 0;
    const quotaLimit = jwtResult.quotaLimit ?? 1000;

    if (wordsUsed >= quotaLimit) {
      logSessionAuth({
        outcome: "quota_exceeded",
        duration_ms: jwtDurationMs,
        cold_start: ctx.timing.authWasColdStart,
        trace_id: ctx.traceId,
        user_id: jwtResult.userId,
      });

      return {
        success: false,
        error: "Free words used up this week",
        code: WS_CLOSE_CODES.QUOTA_EXCEEDED,
      };
    }
  }

  // Success
  logSessionAuth({
    outcome: "success",
    duration_ms: jwtDurationMs,
    cold_start: ctx.timing.authWasColdStart,
    trace_id: ctx.traceId,
    user_id: jwtResult.userId,
  });

  return {
    success: true,
    userId: jwtResult.userId,
    email: jwtResult.email,
    subscriptionActive: jwtResult.subscriptionActive,
  };
}

/**
 * Sends auth error and closes connection
 */
export function sendAuthError(
  ctx: ConnectionContext,
  error: string,
  code: number,
): void {
  safely(() =>
    ctx.server.send(
      JSON.stringify({
        type: "auth_error",
        error,
        code,
      }),
    ),
  );
  safeClose(ctx.server, code, error);
}

/**
 * Sends auth success
 */
export function sendAuthSuccess(ctx: ConnectionContext): void {
  safely(() =>
    ctx.server.send(
      JSON.stringify({
        type: "auth_ok",
        userId: ctx.userId,
      }),
    ),
  );
}
```

### Update `worker/src/handlers/ws.ts`

Replace inline auth logic with:
```typescript
import {
  setupAuthTimeout,
  clearAuthTimeout,
  handleAuth,
  sendAuthError,
  sendAuthSuccess,
} from "../pipeline/auth";

// In message handler for "auth" type:
if (parsed.type === "auth") {
  clearAuthTimeout(ctx);

  if (ctx.authenticated) {
    connLog.warn("[WS] duplicate auth ignored");
    return;
  }

  // Adopt client traceId
  if (parsed.traceId && parsed.traceId !== ctx.traceId) {
    ctx.traceId = parsed.traceId;
    ctx.session.traceId = parsed.traceId;
  }

  if (!parsed.token) {
    sendAuthError(ctx, "Token is required", WS_CLOSE_CODES.UNAUTHORIZED);
    return;
  }

  const result = await handleAuth(ctx, parsed.token);

  if (!result.success) {
    sendAuthError(ctx, result.error!, result.code!);
    return;
  }

  ctx.authenticated = true;
  ctx.userId = result.userId!;
  ctx.email = result.email!;
  ctx.subscriptionActive = result.subscriptionActive!;

  sendAuthSuccess(ctx);
  return;
}
```

---

## Phase 4: Extract Audio Handler

**Risk:** Low
**Behavior Change:** None

### Create `worker/src/pipeline/audio.ts`

```typescript
import { parseFrameHeader } from "../audio/codec";
import { safeClose } from "../utils/ws";
import type { ConnectionContext } from "./types";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB

export interface AudioFrameResult {
  success: boolean;
  error?: string;
}

/**
 * Handles binary audio frame
 * - Parses 16-byte header
 * - Validates sequence
 * - Accumulates payload
 * - Enforces size limit
 */
export function handleAudioFrame(
  ctx: ConnectionContext,
  data: ArrayBuffer,
): AudioFrameResult {
  const buf = new Uint8Array(data);

  // Validate minimum size (16-byte header)
  if (buf.byteLength < 16) {
    return { success: false, error: "frame too small" };
  }

  const { seq, nbytes } = parseFrameHeader(buf);

  // Validate payload size matches header
  if (16 + nbytes > buf.byteLength) {
    return { success: false, error: "payload size mismatch" };
  }

  const payload = buf.subarray(16, 16 + nbytes);
  const now = Date.now();

  // Track timing
  if (ctx.session.firstArrivalMs === null) {
    ctx.session.firstArrivalMs = now;
    ctx.timing.firstFrameAt = now;
  }
  ctx.session.lastArrivalMs = now;
  ctx.timing.lastFrameAt = now;

  // Track sequence gaps
  if (ctx.session.lastSeq !== null && seq !== ctx.session.lastSeq + 1) {
    ctx.session.seqGaps += 1;
  }
  ctx.session.lastSeq = seq;

  // Enforce size limit
  if (ctx.session.totalBytes + payload.byteLength > MAX_AUDIO_BYTES) {
    ctx.server.send(
      JSON.stringify({
        type: "error",
        code: 4003,
        body: "audio too large",
        retryable: false,
      }),
    );
    safeClose(ctx.server, 1009, "payload too large");
    return { success: false, error: "audio too large" };
  }

  // Accumulate
  ctx.session.chunks.push(payload);
  ctx.session.totalBytes += payload.byteLength;
  ctx.session.frames += 1;

  return { success: true };
}
```

---

## Phase 5: Extract Transcription Pipeline

**Risk:** Medium
**Behavior Change:** None

### Create `worker/src/pipeline/transcribe.ts`

```typescript
import { concat, wrapWav } from "../audio/codec";
import { transcribeWav } from "../services/stt";
import { buildSTTPrompt } from "../services/stt/prompt";
import { logSessionAudio, logSessionSTT } from "../utils/sessionLogger";
import type { ConnectionContext, TranscribeResult } from "./types";

/**
 * Assembles WAV from accumulated chunks and calls STT
 */
export async function transcribe(
  ctx: ConnectionContext,
): Promise<TranscribeResult | null> {
  const { session, runtime, env } = ctx;

  // Early return for empty/canceled sessions
  if (session.canceled || session.chunks.length === 0 || session.totalBytes === 0) {
    return null;
  }

  // Assemble WAV
  const assembleStart = Date.now();
  const pcm = concat(session.chunks, session.totalBytes);
  const wav = wrapWav(pcm, session.rate, 1, 16);

  // Release memory early
  session.chunks = [];

  ctx.timing.assembleMs = Date.now() - assembleStart;

  // Log audio stats
  logSessionAudio({
    frames: session.frames,
    bytes_kb: Number((session.totalBytes / 1024).toFixed(2)),
    streaming_duration_ms:
      session.firstArrivalMs && session.lastArrivalMs
        ? session.lastArrivalMs - session.firstArrivalMs
        : null,
    seq_gaps: session.seqGaps,
    trace_id: session.traceId ?? "unknown",
  });

  // Build STT prompt with context
  const sttPrompt = buildSTTPrompt({
    basePrompt: runtime.stt.prompt,
    identity: session.identity,
    ocrWords: session.ocrWords.length > 0 ? session.ocrWords : undefined,
  });

  // Get API key
  const apiKey =
    runtime.stt.provider === "simplismart"
      ? env.SIMPLISMART_API_KEY
      : env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(`Missing API key for STT provider: ${runtime.stt.provider}`);
  }

  // Create abort controller
  ctx.abortController?.abort();
  ctx.abortController = new AbortController();

  // Call STT
  const sttStartTime = Date.now();
  const result = await transcribeWav(wav, {
    provider: runtime.stt.provider,
    apiKey,
    signal: ctx.abortController.signal,
    model: runtime.stt.model,
    language: ctx.clientLanguage || runtime.stt.language,
    prompt: sttPrompt,
    timeoutMs: runtime.stt.timeoutMs,
  });

  const sttDuration = Date.now() - sttStartTime;
  const ttfb = result.timings.headersAt - result.timings.startAt;

  // Track timing
  ctx.timing.sttDurationMs = sttDuration;
  ctx.timing.sttTtfbMs = ttfb;

  // Log STT completion
  logSessionSTT({
    outcome: "success",
    provider: runtime.stt.provider,
    model: runtime.stt.model,
    duration_ms: sttDuration,
    ttfb_ms: ttfb,
    text_length: result.text.length,
    trace_id: session.traceId ?? "unknown",
  });

  return {
    text: result.text,
    timings: result.timings,
    provider: runtime.stt.provider,
    model: runtime.stt.model,
  };
}
```

---

## Phase 6: Extract Router

**Risk:** Low
**Behavior Change:** None

### Create `worker/src/pipeline/router.ts`

```typescript
import { detectTriggers } from "../services/llm/triggers";
import { selectSmartRoute, selectEditRoute } from "../services/llm/smartRouting";
import type { ConnectionContext, RouteDecision } from "./types";

/**
 * Decides whether to bypass LLM or which tier to use
 *
 * Flow:
 * 1. Edit mode → always use edit tier
 * 2. LLM disabled → bypass
 * 3. Detect triggers → route to appropriate tier
 */
export function routeTranscript(
  ctx: ConnectionContext,
  sttText: string,
): RouteDecision {
  const { session, runtime } = ctx;

  // Edit mode: always use edit tier
  if (session.mode === "edit" && runtime.edit.enabled) {
    const editRoute = selectEditRoute(runtime);
    return {
      tier: "edit",
      requiresLLM: true,
      provider: editRoute.provider,
      model: editRoute.model,
      temperature: runtime.edit.temperature,
      timeoutMs: runtime.edit.timeoutMs,
      stream: runtime.edit.stream,
      triggeredRules: [],
      reason: "edit mode",
    };
  }

  // LLM disabled: bypass
  if (!runtime.llm.enabled) {
    return {
      tier: "bypass",
      requiresLLM: false,
      triggeredRules: [],
      reason: "llm disabled",
    };
  }

  // Detect triggers
  const triggerContext = detectTriggers(sttText);
  const routeDecision = selectSmartRoute(sttText, triggerContext, runtime);

  // Bypass tier: no LLM needed
  if (routeDecision.tier === "bypass") {
    return {
      tier: "bypass",
      requiresLLM: false,
      triggeredRules: routeDecision.triggeredRules,
      reason: routeDecision.reason,
    };
  }

  // Default or advanced tier: LLM needed
  return {
    tier: routeDecision.tier,
    requiresLLM: true,
    provider: routeDecision.provider,
    model: routeDecision.model,
    temperature: routeDecision.temperature ?? runtime.llm.temperature,
    timeoutMs: routeDecision.timeoutMs,
    stream: routeDecision.stream ?? runtime.llm.stream,
    triggeredRules: routeDecision.triggeredRules,
    reason: `triggers: ${routeDecision.triggeredRules.join(", ") || "none"}`,
  };
}
```

---

## Phase 7: Extract LLM Enhancement (Lazy Loaded)

**Risk:** Medium
**Behavior Change:** None (but enables lazy loading)

### Create `worker/src/pipeline/enhance.ts`

```typescript
import { prepareEditRequest, buildEditSystemPrompt } from "../services/llm/editPrompt";
import { composeDynamicPrompt, estimatePromptTokens } from "../services/llm/prompts";
import { detectTriggers } from "../services/llm/triggers";
import { logSessionLLM } from "../utils/sessionLogger";
import { safely } from "../utils/safely";
import type { ConnectionContext, RouteDecision, EnhanceResult } from "./types";

/**
 * Enhances transcript with LLM
 *
 * THIS MODULE IS LAZY LOADED - only imported when tier !== "bypass"
 *
 * @param ctx - Connection context
 * @param sttText - Raw STT output
 * @param route - Router decision
 * @param sttPrompt - Original STT prompt (for vocabulary)
 */
export async function enhance(
  ctx: ConnectionContext,
  sttText: string,
  route: RouteDecision,
  sttPrompt: string,
): Promise<EnhanceResult> {
  const { session, runtime, env, server } = ctx;

  // Bypass case (shouldn't reach here, but safety check)
  if (!route.requiresLLM) {
    return { text: sttText, bypassed: true };
  }

  // Lazy import LLM module
  const { chatCompleteByProvider } = await import("../services/llm");

  // Notify client
  safely(() =>
    server.send(
      JSON.stringify({
        type: "llm_status",
        state: "llm_processing",
        traceId: session.traceId,
        serverTs: Date.now(),
      }),
    ),
  );

  const routerStartTime = Date.now();

  // Get API key for provider
  const apiKey = getApiKeyForProvider(env, route.provider!);
  if (!apiKey) {
    console.warn(`[LLM] Missing API key for provider: ${route.provider}`);
    return { text: sttText, bypassed: true };
  }

  // Build prompt based on mode
  let systemPrompt: string;
  let userContent: string;

  if (route.tier === "edit") {
    const editPlan = prepareEditRequest({
      instructions: sttText,
      selection: session.selection,
    });
    systemPrompt = buildEditSystemPrompt({ sttPrompt });
    userContent = editPlan?.prompt ?? sttText;
  } else {
    const triggerContext = detectTriggers(sttText);
    systemPrompt = composeDynamicPrompt(triggerContext, {
      vocabulary: sttPrompt,
      model: route.model!,
      currentDate: runtime.llm.currentDate,
    });
    userContent = sttText;
  }

  const promptTokens = estimatePromptTokens(systemPrompt);
  const llmStartTime = Date.now();
  ctx.timing.routerOverheadMs = llmStartTime - routerStartTime;

  // Call LLM
  const result = await chatCompleteByProvider(route.provider as any, {
    apiKey,
    model: route.model,
    systemPrompt,
    userContent,
    stream: route.stream,
    temperature: route.temperature,
    timeoutMs: route.timeoutMs,
    signal: ctx.abortController?.signal,
    onDelta: route.stream
      ? (delta) => {
          if (!ctx.socketClosed && delta) {
            safely(() =>
              server.send(
                JSON.stringify({
                  type: "llm_delta",
                  delta,
                  traceId: session.traceId,
                }),
              ),
            );
          }
        }
      : undefined,
  });

  const llmDuration = Date.now() - llmStartTime;
  const ttfb = result.timings
    ? (result.timings.firstDeltaAt ?? result.timings.headersAt) - result.timings.startAt
    : 0;

  // Track timing
  ctx.timing.llmDurationMs = llmDuration;
  ctx.timing.llmTtfbMs = ttfb;

  // Log LLM completion
  logSessionLLM({
    outcome: "success",
    provider: route.provider!,
    model: route.model!,
    duration_ms: llmDuration,
    ttfb_ms: ttfb,
    router_overhead_ms: ctx.timing.routerOverheadMs,
    text_length: result.text.length,
    trace_id: session.traceId ?? "unknown",
  });

  return {
    text: result.text || sttText,
    bypassed: false,
    timings: result.timings,
    provider: route.provider,
    model: route.model,
  };
}

function getApiKeyForProvider(env: any, provider: string): string | undefined {
  switch (provider) {
    case "groq":
      return env.GROQ_API_KEY;
    case "baseten":
      return env.BASETEN_API_KEY;
    case "cerebras":
      return env.CEREBRAS_API_KEY;
    case "simplismart":
      return env.SIMPLISMART_API_KEY;
    default:
      return undefined;
  }
}
```

---

## Phase 8: Simplify Orchestrator

**Risk:** High (but all logic already extracted)
**Behavior Change:** None

### Rewrite `worker/src/handlers/ws.ts`

Target: ~200-250 lines (down from 1890)

```typescript
import type { Context } from "hono";
import { getClientIP } from "../utils/ip";
import { trackConnection, releaseConnection } from "../utils/connLimit";
import { createLogger } from "../utils/logger";
import { safeClose, safeJson } from "../utils/ws";
import { createEmptySession } from "../ws/session";
import { getRuntimeConfig } from "../config/runtime";
import { safely } from "../utils/safely";
import { parseClientMessage } from "../types/messages";

// Pipeline modules
import type { ConnectionContext } from "../pipeline/types";
import { setupAuthTimeout, clearAuthTimeout, handleAuth, sendAuthError, sendAuthSuccess } from "../pipeline/auth";
import { handleAudioFrame } from "../pipeline/audio";
import { transcribe } from "../pipeline/transcribe";
import { routeTranscript } from "../pipeline/router";

// Types
export type Bindings = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GROQ_API_KEY?: string;
  SIMPLISMART_API_KEY?: string;
  BASETEN_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
  SKIP_AUTH?: string;
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
};

/**
 * Message handler dispatch table
 */
const messageHandlers: Record<string, (ctx: ConnectionContext, parsed: any) => Promise<void> | void> = {
  auth: handleAuthMessage,
  start: handleStartMessage,
  end: handleEndMessage,
  context_ocr: handleOCRMessage,
  cancel: handleCancelMessage,
};

export function wsRoute(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.text("Expected a websocket connection", 426);
  }

  const clientIP = getClientIP(c.req.raw);
  const cfColo = (c.req.raw as any).cf?.colo ?? "unknown";

  if (!trackConnection(clientIP)) {
    return c.text("Too many connections from your IP. Please try again later.", 429);
  }

  const [client, server] = Object.values(new WebSocketPair());

  // Initialize connection context
  const ctx: ConnectionContext = {
    server,
    socketClosed: false,
    env: c.env,
    clientIP,
    cfColo,
    runtime: getRuntimeConfig(c.env),
    session: createEmptySession(),
    traceId: crypto.randomUUID(),
    authenticated: parseBoolish(c.env.SKIP_AUTH) === true,
    userId: null,
    email: null,
    subscriptionActive: false,
    abortController: null,
    authTimeoutHandle: null,
    sessionActive: false,
    finalSent: false,
    completionLogged: false,
    timing: { wsAcceptAt: Date.now() },
  };

  ctx.session.wsAcceptAt = ctx.timing.wsAcceptAt;
  ctx.session.traceId = ctx.traceId;

  server.accept();

  // Set up auth timeout (unless SKIP_AUTH)
  if (!ctx.authenticated) {
    setupAuthTimeout(ctx);
  }

  // Message handler
  server.addEventListener("message", async (evt: MessageEvent) => {
    try {
      if (typeof evt.data === "string") {
        const msg = safeJson(evt.data);
        const parsed = parseClientMessage(msg);
        if (!parsed) return;

        const handler = messageHandlers[parsed.type];
        if (handler) {
          await handler(ctx, parsed);
        }
      } else if (evt.data instanceof ArrayBuffer) {
        handleAudioFrame(ctx, evt.data);
      }
    } catch (e: any) {
      handleError(ctx, e);
    }
  });

  // Close handler
  server.addEventListener("close", (evt) => {
    handleClose(ctx, evt);
  });

  // Error handler
  server.addEventListener("error", (evt) => {
    handleSocketError(ctx, evt);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// Individual message handlers (imported or defined inline)
async function handleAuthMessage(ctx: ConnectionContext, parsed: any) { /* ... */ }
async function handleStartMessage(ctx: ConnectionContext, parsed: any) { /* ... */ }
async function handleEndMessage(ctx: ConnectionContext, parsed: any) {
  // Send processing status
  safely(() => ctx.server.send(JSON.stringify({ type: "status", state: "processing" })));

  // Transcribe
  const sttResult = await transcribe(ctx);
  if (!sttResult) {
    // Empty session
    ctx.server.send(JSON.stringify({ type: "final", text: "" }));
    safeClose(ctx.server, 1000, "done");
    return;
  }

  // Route decision
  const route = routeTranscript(ctx, sttResult.text);

  let finalText = sttResult.text;

  // Enhance if needed (LAZY LOAD)
  if (route.requiresLLM) {
    const { enhance } = await import("../pipeline/enhance");
    const enhanced = await enhance(ctx, sttResult.text, route, ctx.runtime.stt.prompt);
    finalText = enhanced.text;
  }

  // Send final
  ctx.server.send(JSON.stringify({ type: "final", text: finalText }));
  ctx.finalSent = true;

  // Background tasks
  scheduleBackgroundTasks(ctx, sttResult, finalText);

  safeClose(ctx.server, 1000, "done");
}
function handleOCRMessage(ctx: ConnectionContext, parsed: any) { /* ... */ }
function handleCancelMessage(ctx: ConnectionContext, parsed: any) { /* ... */ }
function handleClose(ctx: ConnectionContext, evt: any) { /* ... */ }
function handleSocketError(ctx: ConnectionContext, evt: any) { /* ... */ }
function handleError(ctx: ConnectionContext, e: Error) { /* ... */ }
function scheduleBackgroundTasks(ctx: ConnectionContext, stt: any, final: string) { /* ... */ }
function parseBoolish(value?: string): boolean | undefined { /* ... */ }
```

---

## Phase 9: Extract Background Tasks

**Risk:** Low
**Behavior Change:** None

### Create `worker/src/background/tasks.ts`

```typescript
import type { ConnectionContext } from "../pipeline/types";

/**
 * Schedules quota increment (for free tier users)
 */
export function scheduleQuotaIncrement(
  ctx: ConnectionContext,
  wordCount: number,
  executionCtx: ExecutionContext,
): void {
  if (ctx.subscriptionActive || !ctx.userId || wordCount === 0) {
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = ctx.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  executionCtx.waitUntil(
    (async () => {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_quota_simple`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            p_user_id: ctx.userId,
            p_word_count: wordCount,
          }),
        });
      } catch (error) {
        console.warn("[Background] Quota increment failed:", error);
      }
    })(),
  );
}

/**
 * Schedules analytics logging
 */
export function scheduleAnalytics(
  ctx: ConnectionContext,
  data: SessionCompletionData,
  executionCtx: ExecutionContext,
): void {
  // Implementation...
}
```

---

## Testing Strategy

### Unit Tests

Each extracted module should have unit tests:

```
worker/src/pipeline/
├── auth.test.ts        # Test JWT verification, quota checks
├── audio.test.ts       # Test frame parsing, accumulation
├── transcribe.test.ts  # Test WAV assembly, STT call mocking
├── router.test.ts      # Test tier decisions
└── enhance.test.ts     # Test LLM call mocking
```

### Integration Tests

```
worker/src/handlers/
└── ws.test.ts          # Full flow tests with mocked providers
```

### Verification Commands

```bash
# After each phase:
npm run build:worker   # Build should pass
npm run test           # Tests should pass
npm run lint           # No linting errors

# Final verification:
npm run dev:ws         # Local worker should work
# Test with app using dev:local
```

---

## Rollout Plan

| Phase | Description | Risk | Lines Changed | Verification |
|-------|-------------|------|---------------|--------------|
| 1 | Delete dead providers | Low | -500 | Build, tests |
| 2 | Extract pipeline types | Low | +150 | Build |
| 3 | Extract auth handler | Medium | +200, -300 | Build, tests, manual auth test |
| 4 | Extract audio handler | Low | +80, -50 | Build, tests |
| 5 | Extract transcription | Medium | +150, -200 | Build, tests, manual STT test |
| 6 | Extract router | Low | +50, -50 | Build, tests |
| 7 | Extract enhance (lazy) | Medium | +200, -300 | Build, tests, verify lazy load |
| 8 | Simplify orchestrator | High | Rewrite | Full integration test |
| 9 | Extract background tasks | Low | +50, -100 | Build, tests |

**Total estimated reduction:** 1890 lines → ~800 lines (-58%)

---

## Success Criteria

1. **Build passes** after each phase
2. **All tests pass** after each phase
3. **No behavior changes** (same responses, same timing)
4. **LLM module lazy loaded** (verify with console.log in dev)
5. **Cold start improved** for bypass tier (measure with timing logs)
6. **Code reviewable** (each module <250 lines)

---

## Open Questions

1. ~~Providers to remove~~ ✅ Confirmed: OpenAI, OpenRouter, Deepgram, Fireworks
2. ~~Edit mode~~ ✅ Keep as separate path
3. ~~OCR blocking~~ ✅ Keep as parallel (waitUntil)
4. **Cerebras:** Keep or remove? (Currently used for advanced tier)
5. **Simplismart LLM:** Keep or remove? (Currently used but seems unused in production)

---

## Appendix: Current vs Proposed Line Counts

| File | Current | Proposed |
|------|---------|----------|
| `handlers/ws.ts` | 1890 | ~200 |
| `pipeline/types.ts` | - | ~100 |
| `pipeline/auth.ts` | - | ~150 |
| `pipeline/audio.ts` | - | ~80 |
| `pipeline/transcribe.ts` | - | ~150 |
| `pipeline/router.ts` | - | ~50 |
| `pipeline/enhance.ts` | - | ~200 |
| `pipeline/ocr.ts` | - | ~60 |
| `background/tasks.ts` | - | ~50 |
| `services/llm/index.ts` | 54 | ~40 |
| `services/stt/index.ts` | 104 | ~60 |
| **Total** | **~2050** | **~1140** |

Net reduction: **~900 lines** (-44%)
