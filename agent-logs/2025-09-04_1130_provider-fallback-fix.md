# Provider Fallback Fix and Request Logging

**Date:** 2025-09-04  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
User wanted OpenAI GPT‑4o to be the default LLM via config (not env), a clean provider-agnostic integration, and explicit logs of which STT/LLM models and endpoints are used per request (visible in console and Sentry). When issues surfaced (hardcoded model and incorrect provider fallback), user wanted those corrected immediately.

## What We Accomplished
- ✅ **Default LLM via config** - Set `LLM_DEFAULT_PROVIDER=openai` and `LLM_DEFAULT_MODEL=gpt-4o` in `worker/src/config.ts`.
- ✅ **Removed hardcoded OpenAI model** - OpenAI client now uses `LLM_DEFAULT_MODEL` (no in-file hardcode).
- ✅ **Fixed provider fallback logic** - Honors user-specified `LLM_DEFAULT_PROVIDER` when `LLM_PROVIDER` is invalid.
- ✅ **LLM facade in place** - `chatCompleteByProvider` dispatches to Groq/OpenAI with unified timings.
- ✅ **Request logging** - Console + Sentry logs for both STT and LLM (model, endpoint, provider, stream, traceId).
- ✅ **Tests and docs** - Dispatch/provider parsing tests added; docs updated with provider/env guidance.

## Technical Implementation
- Config defaults centralized in `worker/src/config.ts`; runtime parsing in `worker/src/config/runtime.ts` (including provider).
- `services/llm/index.ts` facade selects provider and returns `{ text, timings }` with streaming support.
- `services/llm/openai.ts` mirrors Groq SSE flow and timings capture.
- `handlers/ws.ts` logs STT/LLM request metadata before calls, routes LLM via facade, selects correct API key by provider.

**Files Modified:**
- `worker/src/config.ts` - Defaulted provider/model to OpenAI; added OpenAI endpoint/type.
- `worker/src/config/runtime.ts` - Added `provider` and fixed fallback to honor user default.
- `worker/src/services/llm/openai.ts` - Uses `LLM_DEFAULT_MODEL`; no hardcoded model strings.
- `worker/src/services/llm/index.ts` - Provider-agnostic facade.
- `worker/src/handlers/ws.ts` - Added STT/LLM request logging (console + Sentry); provider-aware routing.
- `worker/src/services/llm/index.test.ts` - Facade dispatch tests.
- `worker/src/config/runtime.test.ts` - Provider parsing tests.
- `worker/README.md`, `worker/CLAUDE.md` - Provider/env documentation.

## Bugs & Issues Encountered
1. **Hardcoded OpenAI model default**
   - **Fix:** Default now sourced from `LLM_DEFAULT_MODEL` in config (currently `gpt-4o`).
2. **Provider fallback ignored user default**
   - **Fix:** Use `userDefaultProvider = env.LLM_DEFAULT_PROVIDER || LLM_DEFAULT_PROVIDER` and `parseProvider(env.LLM_PROVIDER, userDefaultProvider)`.
3. **TS import extension error (earlier)**
   - **Fix:** Import modules without `.ts` extension per tsconfig.

## Key Learnings
- Keep defaults in one place (`config.ts`) and consume via runtime parsing to avoid drift.
- Facade pattern isolates provider variance and keeps orchestration minimal.
- Logging request metadata before external calls provides immediate traceability in both console and Sentry.

## Architecture Decisions
- **Config-first defaults** to meet “no env required” preference while still allowing env overrides.
- **Provider-agnostic facade** to support future providers with minimal changes.

## Ready for Next Session
- ✅ Provider selection is correct and observable.
- ✅ Default model is centrally configured and applied.
- 🔧 Optional: STT providerization if we add non-Groq STT later.

## Context for Future
This removes ambiguity around provider/model selection, improves observability, and sets a pattern for adding more providers or telemetry without touching the orchestration flow.
