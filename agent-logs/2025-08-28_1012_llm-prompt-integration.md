# Dictation LLM Prompt Integration

**Date:** 2025-08-28  
**Agent:** Codex (terminal)  
**Status:** ✅ Completed  

## User Intention
The user wants the dictation app’s LLM to act as a minimal, intelligent post-editor for ASR output—preserving phrasing while fixing punctuation/case, applying selective domain-aware corrections (e.g., Silero VAD), normalizing quotes and spelled letters, and only formatting as lists when clearly warranted. They also want a pragmatic integration path and opted to hard‑code the new system prompt for reliability and simplicity.

## What We Accomplished
- ✅ **Authored a structured dictation system prompt** — Added a clear, sectioned prompt with strict fidelity rules, formatting heuristics, meta‑directive handling, spelled‑letters and quotes normalization, domain corrections, examples, and guardrails.
- ✅ **Committed proposal artifact** — Saved the prompt as a proposal for review and posterity at `SYSTEM_PROMPTS_RESEARCH/PROPOSALS/codex-proposal.md`.
- ✅ **Hard‑coded prompt in Worker** — Introduced a constant and passed it as `systemPrompt` to the LLM call so the Worker always uses it without external config.
- ✅ **Documented env/KV options** — Provided a path to later switch to Cloudflare plaintext env vars or KV without major refactors.

## Technical Implementation
- Created `DEFAULT_LLM_SYSTEM_PROMPT` constant (TypeScript string literal) containing the full Codex prompt.
- Imported and supplied it to `chatComplete` in the WebSocket handler’s LLM post‑processing path.
- Preserved existing defaults (temperature, model) and streaming behavior; only augmented the `systemPrompt` parameter.

**Files Modified:**
- `SYSTEM_PROMPTS_RESEARCH/PROPOSALS/codex-proposal.md` — Added Codex proposal content for the dictation system prompt.
- `worker/src/services/llm/prompt.ts` — New file exporting `DEFAULT_LLM_SYSTEM_PROMPT`.
- `worker/src/handlers/ws.ts` — Import prompt constant and pass as `systemPrompt` to `chatComplete`.

## Bugs & Issues Encountered
1. **Regex slip when locating callsite** — Minor ripgrep pattern error while searching for `chatComplete({`.
   - **Fix:** Used proper escaping and verified with line-numbered output.

## Key Learnings
- **Prompt shape matters** — Sectioned, explicit “do/don’t” rules with few‑shots steer models away from unnecessary paraphrase and formatting.
- **Operational simplicity wins** — Hard‑coding is acceptable when iteration pace is low; env/KV overrides can be layered later with minimal code.
- **Edge-case clarity** — Spelled-letter handling and quote normalization require precise, example-driven rules to avoid ambiguity.

## Architecture Decisions
- **Decision: Hard‑code prompt now** — Chosen for reliability and zero-config rollout.
- **Trade‑off: Flexibility vs. speed** — Loses hot‑swap edits via dashboard; acceptable given ease of adding an env override later.

## Ready for Next Session
- ✅ **Env override hook** — Simple enhancement: prefer `c.env.LLM_SYSTEM_PROMPT || DEFAULT_LLM_SYSTEM_PROMPT` in `ws.ts`.
- ✅ **KV storage (optional)** — Bind `PROMPT_KV` and `LLM_PROMPT_KEY` for versioned prompt management if needed.
- 🔧 **Additional few‑shots** — Add more domain examples (SDK names, product capitalization, common ASR near-misses) based on real transcripts.

## Context for Future
This integration makes the LLM a constrained post‑editor aligned with dictation UX. Adding an env/KV override later enables safe prompt iteration without deploys, while the hard‑coded fallback ensures resilience.

