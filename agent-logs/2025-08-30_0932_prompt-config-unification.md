# Runtime Config & Prompt Unification

**Date:** 2025-08-30  
**Agent:** OpenAI Codex CLI  
**Status:** ✅ Completed  

## User Intention
Unify scattered prompt/config behavior for the Worker so settings (model, reasoning, streaming, timeouts, STT prompt/language) are centralized, easy to override via env, and safe to evolve. Prepare for dynamic per-user STT prompts, keep code neat, and avoid regressions—without impacting Sentry or latency.

## What We Accomplished
- ✅ **Unified runtime config** – Added `getRuntimeConfig(env)` consolidating LLM/STT settings with validation and sane defaults.
- ✅ **Centralized prompts** – Introduced `buildLLMSystemPrompt({ reasoning, currentDate })` and `DEFAULT_STT_PROMPT`/`buildSTTPrompt()`.
- ✅ **Handler refactor** – `ws.ts` now uses runtime config, threads client `language`, and builds a dated LLM system prompt.
- ✅ **Docs + examples** – Updated Worker README, CLAUDE.md, and `.dev.vars` with all envs (incl. `LLM_CURRENT_DATE`).
- ✅ **Tests added** – Unit tests for runtime config and prompt builders.
- ⚠️ **Temperature passthrough** – Runtime exposes temperature, but `chatComplete` still uses the default; planned follow-up.

## Technical Implementation
- `src/config.ts`: added `LLM_DEFAULT_REASONING`, `LLM_DEFAULT_STREAM`; moved STT vocab default to STT prompt module.
- `src/config/runtime.ts`: new parser exposes `llm { enabled, stream, model, reasoning, temperature, timeoutMs, currentDate }` and `stt { model, language, prompt, timeoutMs }`.
- `src/services/llm/prompt.ts`: prompt builder injects Reasoning and Current date.
- `src/services/stt/prompt.ts`: centralized STT prompt with optional extra vocab.
- `src/handlers/ws.ts`: uses runtime config; passes client language; builds prompts; no Sentry changes.

**Files Modified:**
- `worker/src/config.ts` – new LLM defaults, removed inline STT prompt
- `worker/src/config/runtime.ts` – new
- `worker/src/services/llm/prompt.ts` – new builder + default
- `worker/src/services/stt/prompt.ts` – new
- `worker/src/services/stt/groq.ts` – uses centralized STT prompt
- `worker/src/handlers/ws.ts` – uses runtime config + builders
- `worker/src/config/runtime.test.ts`, `worker/src/services/*/prompt.test.ts` – new tests
- `worker/README.md`, `worker/CLAUDE.md`, `worker/.dev.vars` – docs/examples updated

## Bugs & Issues Encountered
1. **Reasoning default inconsistency** – Prompt hardcoded “Reasoning: medium” while env fallback implied “low”.  
   - **Fix:** Added `LLM_DEFAULT_REASONING='medium'` and drove prompt from builder/runtime.
2. **STT prompt scattered in config** – Hard to override/extend.  
   - **Fix:** Moved to `services/stt/prompt.ts` and exposed `STT_PROMPT` env.

## Key Learnings
- Builder-based prompts prevent hidden drift and enable simple runtime injection (e.g., date/reasoning).
- A single runtime loader cuts duplication and makes env behavior explicit and testable.
- Centralization did not affect Sentry; observability is orthogonal to config plumbing.

## Architecture Decisions
- Preserve existing env names for backward compatibility; add new ones (e.g., `LLM_CURRENT_DATE`) without breaking changes.
- Client-provided language overrides default to support per-session STT behavior.

## Ready for Next Session
- ✅ Pass `temperature` from runtime to LLM request body.
- ✅ Normalize metric attribute prefixes (`stt.*` vs `groq.*`).
- 🔧 Design per-user STT prompt selection (e.g., user profile → builder input).

## Context for Future
This unification sets a consistent foundation for user-specific prompts and model tuning, reducing configuration drift and making future changes (per-tenant configs, feature flags) safer and faster.
