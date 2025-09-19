# Fireworks STT Integration Checkpoint

**Date:** 2025-09-19  
**Agent:** Codex (GPT-5)  
**Status:** ⚠️ Partial  

## User Intention
User wanted to extend the transcription worker so it can switch between Groq Whisper and Fireworks Whisper Turbo, hoping Fireworks could unlock longer dictations without losing latency targets. They were testing the Fireworks path when the model started returning context-limit errors mid-session. The goal now is to capture where the integration stands and what remains before Fireworks can be production ready.

## What We Accomplished
- ✅ **Provider abstraction landed** – `worker/src/services/stt/index.ts` now fans out to Groq or Fireworks using normalized options and shared defaults.
- ✅ **Fireworks client implemented** – `worker/src/services/stt/providers/fireworks.ts` posts WAV/FormData with Sentry spans mirroring the Groq implementation and handles timeout/abort wiring.
- ✅ **Runtime + docs updated** – `worker/src/config/runtime.ts`, docs, and README describe how to flip providers and which env vars/keys drive each path; added unit coverage for the dispatcher/runtime helpers.
- ⚠️ **Fireworks sessions hit context ceiling** – Real WS runs against Fireworks fail with `context_length_exceeded`, so transcription never returns and we fall back to error handling.

## Technical Implementation
The worker now derives STT defaults in `worker/src/config.ts` (Groq-first, Fireworks commented) and exposes both providers through a thin dispatcher. `ws.ts` pulls `STT_PROVIDER` from runtime config, logs provider/model selection, and forwards WAV buffers to the chosen client while preserving the downstream LLM cleanup flow. Tests cover provider routing, runtime parsing, and Fireworks happy/error paths. Documentation calls out the new provider toggle, instrumentation span names, and differing auth headers (Bearer vs raw key).

**Files Modified:**
- `AGENTS.md` – Document assistant workflow updates for Fireworks-aware commands.
- `README.md` – Update architecture diagram and project structure notes to include Fireworks.
- `docs/INSTRUMENTATION.md` – Reference new STT span and attribute names for Fireworks.
- `docs/TRANSCRIPTION.md` – Add provider switcher guidance and Fireworks endpoint/auth details.
- `worker/src/config.ts` – Define Fireworks endpoints/models and widen `STTProvider` union.
- `worker/src/config/runtime.ts` / `.test.ts` – Allow env-driven provider/model overrides.
- `worker/src/handlers/ws.ts` – Select API key per provider and log the active endpoint before dispatching.
- `worker/src/services/stt/index.ts` & `.test.ts` – Introduce dispatcher and routing coverage.
- `worker/src/services/stt/providers/fireworks.ts` – New Fireworks client with Sentry spans and abort handling.
- `worker/src/services/stt/providers/groq.ts` – Ported existing client into provider folder; kept instrumentation in sync.
- `worker/src/services/stt/fireworks.test.ts` / `groq.test.ts` – Validate client behavior and error surfacing.
- `worker/worker-configuration.d.ts` – Add `FIREWORKS_API_KEY` binding.

## Bugs & Issues Encountered
1. **Fireworks returns `context_length_exceeded` on longer dictations** – Once audio spans roughly a minute, the API responds 400 and bubbles through `transcribeWav`, killing the session.
   - **Fix:** None yet; probable next step is trimming the prompt, chunking audio, or requesting larger context tier from Fireworks.
2. **No graceful fallback when Fireworks fails** – When Fireworks rejects, the worker throws, WS closes, and the renderer shows a generic error instead of reverting to Groq.
   - **Workaround:** Keep `STT_PROVIDER` defaulted to Groq in env; Fireworks remains experimental until error handling is added.

## Key Learnings
- **Fireworks uses raw `Authorization` key** – No `Bearer` prefix, unlike Groq, so bindings must stay distinct.
- **Sentry spans stay comparable** – Mirroring Groq attribute names lets dashboards overlay provider performance without schema tweaks.
- **Runtime toggles centralize config** – Pulling provider/model defaults from `getRuntimeConfig` keeps WS handler lean and env-driven.

## Architecture Decisions
- **Provider dispatcher abstraction** – Consolidated provider selection in one module to avoid sprawling conditionals in the WS handler.
- **Opt-in Fireworks defaults** – Left Groq as the compiled default while documenting how to flip constants so prod remains stable.

## Ready for Next Session
- ✅ **Provider scaffolding and tests** – Dispatcher, clients, and docs are in place for further tuning.
- 🔧 **Tackle Fireworks context limits** – Need to reduce payload, request higher context, or retry on failure before exposing to users.
- 🔧 **Add fallback/error UX** – Consider retrying with Groq or emitting a clearer UI error when Fireworks rejects.

## Context for Future
Once Fireworks’ context limits are handled, we can safely let users opt into the faster model while keeping Groq as a fallback. The current scaffolding should make future provider additions (or tier-specific Fireworks endpoints) straightforward without touching the WS message contract.
