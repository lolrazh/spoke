# Prompt Sanitization Follow-Up

**Date:** 2025-09-29  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
The user wanted to make sure the new identity-aware transcription prompts were truly safe to ship, not just functioning. Their goal was to harden the personalization flow so no malicious profile data could inject instructions into STT/LLM prompts while keeping the protocol/docs aligned for future contributors.

## What We Accomplished
- ✅ **Sanitized prompt identity tokens** - Added shared `sanitizeToken` helper that strips control chars, angle brackets, commas/colons, collapses whitespace, and clamps length before dedupe.
- ✅ **Expanded worker coverage** - Mirrored sanitizer in the worker prompt builder with a new vitest case exercising script-tag + control-char input.
- ✅ **Hardened identity store** - Normalized Supabase-provided name/email before caching and notifying listeners so the renderer never leaks raw values.
- ✅ **Updated protocol docs** - Documented optional `identity` payload in `docs/TRANSCRIPTION.md`, noting worker sanitization guarantees for downstream readers.

## Technical Implementation
- Introduced `sanitizeToken` utility (shared + worker) to enforce an allowlist (`[A-Za-z0-9@._-+' ]`) and max length (80 chars) before tokens enter prompts.
- Adjusted dedupe logic to operate on lowercase sanitized keys while preserving display casing.
- Extended worker prompt tests to confirm sanitizer output for `<script>` payloads and control characters.
- Ensured `emit` in `src/state/userIdentity.ts` normalizes values prior to storage/broadcast to avoid stale comparisons.
- Added docs snippet showing sanitized identity payload and describing worker-side filtering.

**Files Modified:**
- `shared/sttPrompt.ts` - Added `sanitizeToken`, updated dedupe logic.
- `worker/src/services/stt/prompt.ts` - Mirrored sanitizer and token handling.
- `worker/src/services/stt/prompt.test.ts` - Added sanitization test coverage.
- `src/state/userIdentity.ts` - Normalized emitted identity values.
- `docs/TRANSCRIPTION.md` - Documented `identity` payload and sanitization note.

## Bugs & Issues Encountered
1. **Prompt injection vector via raw identity tokens** - User profile strings could include `<script>` or delimiter characters, breaking vocab context and overriding the LLM system prompt.
   - **Fix:** Sanitized and length-limited tokens before inclusion in STT/LLM prompts, with regression tests to enforce behavior.

## Key Learnings
- **Prompt personalization requires strict allowlists**: even seemingly benign metadata (name/email) needs filtering to prevent instruction injection.
- **Shared helpers keep worker/client in sync**: mirroring sanitizer logic across renderer + worker avoids drift when both build prompts.
- **Docs need to codify contracts**: specifying sanitization in documentation helps future contributors rely on the invariant instead of re-validating.

## Architecture Decisions
- **Centralized sanitizer** - Implemented once per package (shared + worker) so future prompt builders can reuse the same guardrail without importing across bundler boundaries.
- **Length clamp at 80 chars** - Balances user vocab fidelity with predictable prompt size; avoids accidental runaway tokens.

## Ready for Next Session
- ✅ **Prompt enrichment is safe by default** - Sanitization + tests + docs mean future work can rely on the sanitized identity tokens.
- 🔧 **Consider renderer-side unit tests** - If deeper coverage is desired, add React hook tests to assert sanitized payloads in WS messages.

## Context for Future
This session locks down identity-aware prompting so personalization can expand (e.g., domain vocab, org units) without reopening injection risks. Future agents can build new prompt features on top of the sanitized token path with confidence.

