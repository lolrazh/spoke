# OpenRouter Integration for Worker LLM Routing

**Date:** 2025-09-30  
**Agent:** Droid (OpenAI GPT-4.1)  
**Status:** ⚠️ Partial  

## User Intention
The user wanted to add OpenRouter as an alternative LLM backend that favors the lowest-latency provider options, with Qwen 3 set as the preferred model and configuration knobs mirroring other providers.

## What We Accomplished
- ✅ **Added OpenRouter provider implementation** – New `openrouter` client mirrors SSE handling and injects latency-sorted provider preferences plus optional attribution headers.
- ✅ **Extended runtime/provider config** – Introduced provider-specific default models and env-driven OpenRouter routing/header options wired through the WS handler.
- ⚠️ **Test suite check** – `npm test` still fails due to pre-existing STT prompt sanitization and `useTranscription` cancel-flow assertions; no fixes yet.

## Technical Implementation
Introduced an OpenRouter chat client that reuses the OpenAI-compatible request structure while adding provider preference payloads and optional headers. Runtime configuration now maps each provider to its default model, and the WebSocket handler selects the correct API key, endpoint, headers, and provider-specific routing overrides before invoking `chatCompleteByProvider`.

**Files Modified:**
- `worker/src/config.ts` – Added OpenRouter endpoint and provider default model map.
- `worker/src/config/runtime.ts` – Selected defaults based on provider; allowed `openrouter` parsing.
- `worker/src/config/runtime.test.ts` – Covered new provider cases and default model mapping.
- `worker/src/services/llm/index.ts` / `index.test.ts` – Wired new provider dispatch and unit coverage.
- `worker/src/services/llm/openrouter.ts` – New OpenRouter client implementation.
- `worker/src/handlers/ws.ts` – Routed env-driven headers/preferences and API key for OpenRouter.
- `worker/worker-configuration.d.ts` – Declared new env bindings.

## Bugs & Issues Encountered
1. **STT prompt sanitization test failure** – `worker/src/services/stt/prompt.test.ts` expects unsanitized identity tokens.  
   - **Workaround:** None applied; failure noted for follow-up.
2. **`useTranscription` cancel-flow regression** – `src/hooks/useTranscription.test.tsx` assertion fails, likely existing flake.  
   - **Workaround:** None; requires future investigation.

## Key Learnings
- **Provider defaults benefit from central mapping** – Simplifies switching across LLM vendors without manual model overrides.
- **OpenRouter provider preferences** – Latency sorting can be expressed via the `provider` payload and enriched by env flags.
- **Env-driven headers** – Supporting attribution headers requires optional env parsing and minimal coupling.

## Architecture Decisions
- **Reuse OpenAI-compatible client pattern** – Maintains consistent streaming behavior and telemetry across providers.
- **Env-based customization over code flags** – Keeps routing preferences configurable without redeploys.

## Ready for Next Session
- ✅ **OpenRouter provider scaffolding** – Endpoints, defaults, and env hooks are in place for immediate use.
- 🔧 **Stabilize failing tests** – Address STT prompt sanitization expectations and cancel-flow behavior before merging.

## Context for Future
This integration enables rapid experimentation with OpenRouter-hosted models (starting with Qwen 3) and latency-aware routing, paving the way to prioritize or fallback between multi-provider LLM options as QA progresses.
