# Long Dictation Routing Update

**Date:** 2025-10-04  
**Agent:** Factory Droid (OpenAI GPT-4.1)  
**Status:** ✅ Completed  

## User Intention
The user wanted to stop long dictations from losing their final sentences by steering those transcripts away from Groq’s llama model limits, capture the change in project documentation, and leave a historical log for future agents.

## What We Accomplished
- ✅ **Length-triggered Kimi fallback** – Added a 1200-char/180-word guard in `selectLLMRoute` so lengthy transcripts go straight to Kimi instead of llama
- ✅ **Regression coverage** – Extended `routing.test.ts` to assert the new thresholds and ensure shorter texts still flow through the default path
- ✅ **Documentation update** – Documented the routing behavior in `docs/TRANSCRIPTION.md` so future work references the new rule

## Technical Implementation
- Updated the routing helper to compute character/word counts alongside regex matches and prepend a `length-threshold` tag before returning the Kimi route.
- Tests now build synthetic transcripts over/under the threshold to validate the decision logic.
- Transcription docs gained a routing rule note tying the logic back to `worker/src/services/llm/routing.ts`.

**Files Modified:**
- `worker/src/services/llm/routing.ts` – Added length thresholds and `length-threshold` rule tagging
- `worker/src/services/llm/routing.test.ts` – New test cases covering the length fallback
- `docs/TRANSCRIPTION.md` – Noted the automatic reroute for long transcripts

## Bugs & Issues Encountered
1. **Llama truncation on long transcripts** – Groq’s default completion cap (~1024 tokens) clipped multi-minute dictations.
   - **Fix:** Bypass llama by routing long transcripts to Kimi, which carries a higher default output window.

## Key Learnings
- **Groq default caps:** Leaving `max_output_tokens` unset still enforces a relatively small window and surfaces as missing sentences when the LLM output replaces STT text.
- **Routing leverage:** Centralizing heuristics in `selectLLMRoute` made it straightforward to add global fallbacks without touching worker handlers.
- **Docs drift risk:** The pipeline doc still referenced older frame sizes—keeping it current avoids future confusion when debugging audio vs. LLM issues.

## Architecture Decisions
- **Length-based guard instead of token overrides** – Chosen to avoid destabilizing llama behavior while still protecting long-form dictations via Kimi’s higher limit.
- **Prepend rule tagging** – Ensures telemetry shows the length trigger alongside existing regex hits for easier observability.

## Ready for Next Session
- ✅ **Routing logic & tests** – Fresh thresholds and coverage are in place for continued tuning.
- 🔧 **Threshold calibration** – Consider monitoring real transcript lengths to refine the 1200-char/180-word cutoffs.

## Context for Future
Longer dictations now land on Kimi automatically, eliminating the token-limit truncation and giving future work a clear hook (adjusting thresholds or routing telemetry) if behavior needs further tuning.
