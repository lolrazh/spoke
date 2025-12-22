# Worker Agent Operating Guide

> This AGENTS.md applies to the `worker/` directory only. It overrides the root AGENTS.md for files under this directory.

## Worker Overview

Cloudflare Worker handling WebSocket-based transcription pipeline:
- Audio ingestion via binary WebSocket frames
- Speech-to-text (STT) via multiple providers
- Optional LLM text refinement
- Optional OCR screen context extraction
- JWT-based authentication with Supabase
- Usage quota tracking and enforcement

## Directory Structure

```
worker/src/
├── index.ts              # Hono app entrypoint, routes
├── config.ts             # Canonical provider/model/endpoint constants
├── config/
│   └── runtime.ts        # Environment-driven config parsing
├── handlers/
│   └── ws.ts             # WebSocket upgrade and message handling
├── ws/
│   └── session.ts        # Per-connection session state
├── audio/
│   └── codec.ts          # PCM concatenation, WAV encoding
├── auth/
│   ├── jwt.ts            # JWT verification with JWKS fetch
│   └── supabase.ts       # Supabase client for DB operations
├── db/
│   └── quota.ts          # Usage tracking (words_used_this_week)
├── services/
│   ├── stt/
│   │   ├── index.ts      # STT dispatcher
│   │   └── providers/    # groq.ts, fireworks.ts, deepgram.ts, simplismart.ts
│   ├── llm/
│   │   ├── index.ts      # LLM dispatcher with router
│   │   ├── router.ts     # Model routing logic (length-based, edit mode)
│   │   └── *.ts          # baseten.ts, groq.ts, openai.ts, openrouter.ts, cerebras.ts, simplismart.ts
│   └── ocr/
│       ├── index.ts      # OCR dispatcher
│       └── groq.ts       # Vision model extraction
├── types/
│   └── bindings.ts       # Env type definitions for Cloudflare bindings
└── utils/
    ├── response.ts       # Standard JSON response helpers
    ├── timing.ts         # Performance timing utilities
    └── *.ts              # Other utilities
```

## Provider Configuration

### STT Providers (`STTProvider` type)
| Provider | Endpoint Constant | Default Model | API Key |
|----------|-------------------|---------------|---------|
| `simplismart` (default) | `SIMPLISMART_STT_TURBO_ENDPOINT` | `whisper-turbo` | `SIMPLISMART_API_KEY` |
| `groq` | `GROQ_STT_ENDPOINT` | `whisper-large-v3` | `GROQ_API_KEY` |
| `fireworks` | `FIREWORKS_STT_TURBO_ENDPOINT` | `whisper-v3-turbo` | `FIREWORKS_API_KEY` |
| `deepgram` | `DEEPGRAM_STT_ENDPOINT` | `nova-3` | `DEEPGRAM_API_KEY` |

### LLM Providers (`LLMProvider` type)
| Provider | Endpoint Constant | Default Model | Edit Model | API Key |
|----------|-------------------|---------------|------------|---------|
| `baseten` (default) | `BASETEN_LLM_ENDPOINT` | `deepseek-ai/DeepSeek-V3.2` | `moonshotai/Kimi-K2-Instruct-0905` | `BASETEN_API_KEY` |
| `groq` | `GROQ_LLM_ENDPOINT` | `llama-4-maverick-17b` | `kimi-k2-instruct` | `GROQ_API_KEY` |
| `openai` | `OPENAI_LLM_ENDPOINT` | `gpt-4.1-mini` | `gpt-4.1-mini` | `OPENAI_API_KEY` |
| `openrouter` | `OPENROUTER_LLM_ENDPOINT` | `qwen3-235b` | `qwen3-235b` | `OPENROUTER_API_KEY` |
| `cerebras` | `CEREBRAS_LLM_ENDPOINT` | `llama-3.3-70b` | `qwen-3-235b` | `CEREBRAS_API_KEY` |
| `simplismart` | `SIMPLISMART_LLM_ENDPOINT` | `gemma-3-27b-it` | `gemma-3-27b-it` | `SIMPLISMART_API_KEY` |

### OCR Provider
- Uses Groq vision model: `meta-llama/llama-4-scout-17b-16e-instruct`
- Endpoint: `GROQ_OCR_ENDPOINT`
- Max words extracted: 50 (configurable via `OCR_MAX_WORDS`)

## Environment Variables

Required in `worker/.dev.vars` for local development:

```bash
# STT (at least one required)
SIMPLISMART_API_KEY=xxx     # Default STT provider
GROQ_API_KEY=xxx            # Also used for OCR
FIREWORKS_API_KEY=xxx
DEEPGRAM_API_KEY=xxx

# LLM (at least one required)
BASETEN_API_KEY=xxx         # Default LLM provider
OPENAI_API_KEY=xxx
OPENROUTER_API_KEY=xxx
CEREBRAS_API_KEY=xxx

# Auth
SUPABASE_URL=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
SUPABASE_JWT_SECRET=xxx

# Optional overrides
STT_PROVIDER=simplismart    # groq | fireworks | deepgram | simplismart
LLM_PROVIDER=baseten        # groq | openai | baseten | openrouter | cerebras | simplismart
LLM_MODEL=xxx               # Override default model
LLM_STREAM=true             # Enable/disable streaming
```

## Development Commands

From `worker/` directory:
```bash
npm run dev          # Start local dev server (wrangler)
npm run deploy       # Deploy to Cloudflare
npm run tail         # Tail production logs
npm test             # Run Vitest tests
```

From root directory:
```bash
npm run dev:ws       # Alias for worker dev server
npm run dev:local    # Start Electron app pointing to local worker
```

## WebSocket Protocol

### Connection
```
ws://127.0.0.1:8787/ws (local)
wss://api.spoke.so/ws (production)
```

### Message Flow
1. **Client → Worker**: Binary PCM audio frames (16kHz, mono, 16-bit)
2. **Client → Worker**: JSON control messages (`{ type: "start" | "stop" | "cancel", ... }`)
3. **Worker → Client**: JSON responses (`{ type: "partial" | "final" | "error", ... }`)

### Message Types
- `start`: Initialize session with optional config (vocabulary, OCR data, edit mode)
- `stop`: End recording, trigger transcription pipeline
- `cancel`: Abort current session without transcription
- `partial`: Intermediate transcription result (if streaming)
- `final`: Complete transcription result
- `error`: Error with code and message

## Authentication & Authorization

1. **JWT Verification**: Bearer token in `Authorization` header, verified against Supabase JWKS
2. **Quota Check**: `words_used_this_week` checked against limit (free: 1000, pro: unlimited)
3. **Parallel Auth**: Auth runs in parallel with recording for paying users (no cold-start delay)
4. **Quota Update**: Word count incremented after successful transcription

Key files: `src/auth/jwt.ts`, `src/auth/supabase.ts`, `src/db/quota.ts`

## Adding a New Provider

### STT Provider
1. Create `src/services/stt/providers/<name>.ts` exporting `transcribe<Name>(wav, apiKey, opts)`
2. Add constants to `src/config.ts`: endpoint, model, type union
3. Add to `src/config/runtime.ts`: model mapping
4. Add routing in `src/services/stt/index.ts`
5. Add API key to `src/types/bindings.ts` and destructure in `src/handlers/ws.ts`

### LLM Provider
1. Create `src/services/llm/<name>.ts` exporting `complete<Name>(messages, apiKey, opts)`
2. Add constants to `src/config.ts`: endpoint, default model, edit model
3. Add to `src/config/runtime.ts`: provider/model parsing
4. Add routing in `src/services/llm/index.ts`
5. Add API key to `src/types/bindings.ts` and destructure in `src/handlers/ws.ts`

## Coding Standards (Worker-Specific)

- **No Node.js APIs**: Worker runs in Cloudflare's V8 isolate, not Node.js
- **Streaming Responses**: Use `ReadableStream` for LLM streaming
- **Base64 Encoding**: Chunk large arrays (8KB) to avoid stack overflow in `btoa()`
- **Error Handling**: Always return structured JSON errors, never throw unhandled
- **Timeouts**: Respect `STT_DEFAULT_TIMEOUT_MS` and `LLM_DEFAULT_TIMEOUT_MS` (25s default)
- **Logging**: Use structured logging for observability (Analytics Engine integration)

## Common Pitfalls

1. **Missing API Key Destructuring**: After adding a key to `bindings.ts`, also destructure it in `ws.ts` line ~165
2. **Base64 Stack Overflow**: Use chunked encoding for audio > 50KB
3. **Supabase in Auth Callbacks**: Wrap Supabase calls in `setTimeout(fn, 0)` to avoid breaking auth listeners
4. **Promise Caching**: Module-level cached promises can return stale data if not cleared

## Related Documentation

- `docs/TRANSCRIPTION.md` - Full pipeline architecture
- `docs/AUTH.md` - JWT claims, JWKS verification
- `docs/DATABASE.md` - Schema, RLS policies
- `docs/PAYMENTS.md` - Quota, subscription tiers
- Root `AGENTS.md` - Project-wide guidelines
