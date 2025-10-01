# Dynamic Prompt Identity Enrichment

**Date:** 2025-09-29  
**Agent:** Droid (GPT-5-Codex)  
**Status:** ✅ Completed  

## User Intention
The user wanted transcription prompts to dynamically include each signed-in user’s name and email so speech recognition and the downstream LLM respect user-specific vocabulary, with a quick way to inspect the assembled prompt in the renderer console. They also needed assurance that this enrichment would not introduce noticeable latency in the Cloudflare Worker pipeline.

## What We Accomplished
- ✅ **Added renderer identity store** - Centralized Supabase-derived name/email hydration with subscription hooks for real-time updates.
- ✅ **Extended WS start payload** - Sent identity metadata alongside the existing streaming session initiation without extra round trips.
- ✅ **Updated worker prompts** - Rebuilt STT and LLM prompt construction to append identity tokens per session and covered the behavior with unit tests.
- ✅ **Console verification** - Logged the active STT prompt to DevTools so users can confirm the final prompt contents during development.

## Technical Implementation
Created `src/state/userIdentity.ts` to cache Supabase user info, notify listeners, and reuse the settings panel’s LocalStorage seed. `useTranscription` now subscribes to that store, injects the identity into the WS `start` payload, and logs the composed prompt. On the worker side, `parseClientMessage`, session state, and prompt builders gained identity awareness, ensuring every transcription request builds a user-scoped prompt without relying on shared state. Prompt utilities were refactored/tested to dedupe tokens and include identity safely.

**Files Modified:**
- `src/hooks/useTranscription.ts` - Subscribes to identity store, emits prompt logs, augments WS payloads.
- `src/state/userIdentity.ts` - New identity caching and subscription module.
- `src/types/protocol.ts` / `worker/src/types/messages.ts` - Added identity payload types and parsing.
- `worker/src/ws/session.ts` / `worker/src/handlers/ws.ts` - Persist per-session identity and use it when building prompts.
- `worker/src/services/stt/prompt.ts` & `*.test.ts` - Enhanced prompt builder with identity/extra vocab awareness and coverage.
- `tsconfig.json`, `worker/tsconfig.json` - Adjusted includes for shared utilities.

## Bugs & Issues Encountered
1. **Shared prompt import failure in worker tests** - Moving prompt logic to a shared module broke path resolution in Wrangler/Vitest.
   - **Fix:** Duplicated the lightweight helper in worker scope while keeping logic identical, restoring build compatibility.

## Key Learnings
- **Prompt enrichment via start payloads** keeps Cloudflare Worker sessions stateless yet tailored, removing the need for global caches.
- **Supabase auth hooks can seed multiple surfaces** (settings card, prompts) without duplicate round trips by centralizing identity access.
- **Worker prompt utilities must remain self-contained**; cross-package imports require explicit bundler support that isn’t guaranteed in Wrangler.

## Architecture Decisions
- **Identity-in-start-message** - Chosen to ensure each WS connection carries the freshest user context with negligible serialization overhead, avoiding mutable worker globals.
- **Runtime prompt logging in renderer** - Preferred console logging over server-side logging so users can validate prompts locally without exposing PII in worker logs.

## Ready for Next Session
- ✅ **Identity-aware prompts deployed** - Worker and client codepaths now honor user-specific tokens.
- 🔧 **Global lint cleanup pending** - Existing lint warnings (unrelated to this work) remain if future sessions want a clean CI run.

## Context for Future
These changes lay groundwork for richer personalization (e.g., domain-specific vocab or preferences) by extending the identity payload; future sessions can expand the payload structure or reuse the identity store for other client features without reworking the worker protocol.
