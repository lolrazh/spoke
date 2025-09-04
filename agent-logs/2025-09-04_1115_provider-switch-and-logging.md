# LLM Provider Switch and Request Logging

**Date:** 2025-09-04  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
User wanted a clean, provider-agnostic way to add OpenAI GPT-4o alongside existing Groq usage, with the ability to set OpenAI as the default provider without env edits. They also wanted observability for each request: log model and endpoint for both STT and LLM to console and Sentry.

## What We Accomplished
- ✅ **Providerized LLM selection** - Added provider parsing and defaulted to OpenAI.
- ✅ **OpenAI GPT-4o integration** - Implemented provider client with SSE streaming + timings.
- ✅ **LLM facade** - Single entry `chatCompleteByProvider` for Groq/OpenAI.
- ✅ **Config switch** - Default provider/model set in `config.ts` (OpenAI + gpt-4o).
- ✅ **Request logging** - Console + Sentry logs of STT/LLM model and endpoint.
- ✅ **Tests** - Provider parsing and facade dispatch covered.
- ✅ **Docs** - Updated provider envs and usage guidance.

## Technical Implementation
- `config.ts`/`config/runtime.ts`: defaults + `provider` normalization.
- `services/llm/index.ts`: facade returning common `{ text, timings }`.
- `services/llm/openai.ts`: GPT‑4o client with SSE and timings parity to Groq.
- `handlers/ws.ts`: facade wiring; API key selection; request logging (model, endpoint, provider, stream, traceId).

**Files Modified:**
- `worker/src/config.ts` - OpenAI defaults, endpoints, provider type.
- `worker/src/config/runtime.ts` - Provider parsing into `RuntimeConfig.llm`.
- `worker/src/handlers/ws.ts` - Facade usage, key selection, STT/LLM request logs.
- `worker/src/services/llm/index.ts` - New facade.
- `worker/src/services/llm/openai.ts` - New OpenAI implementation.
- `worker/src/services/llm/index.test.ts` - Facade dispatch tests.
- `worker/src/config/runtime.test.ts` - Provider parse tests.
- `worker/README.md`, `worker/CLAUDE.md` - Docs on provider and keys.

## Bugs & Issues Encountered
1. **TS import extension error**
   - **Fix:** Import `./openai` without `.ts` per tsconfig.
2. **Missing OpenAI key binding in `ws.ts`**
   - **Fix:** Extend `Bindings` and guard with Sentry attribute when missing.

## Key Learnings
- A thin facade keeps orchestration simple and provider-agnostic.
- Matching timing metadata across providers simplifies metrics and client reporting.
- Logging request metadata (before calls) is low-effort and high value for traceability.

## Architecture Decisions
- **Facade pattern** to enable more providers later with minimal churn.
- **Config-first default** per user direction; env remains optional override.

## Ready for Next Session
- ✅ Provider switch completed and observable.
- 🔧 Optional: mirror providerization for STT if needed.

## Context for Future
This lays a scalable pattern for multi-provider support and improves diagnostics. Future sessions can add providers, tweak prompts/streaming, or extend logging/metrics with minimal changes.
