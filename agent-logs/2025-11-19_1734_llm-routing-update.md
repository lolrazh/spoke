# LLM Router Filter Removal

**Date:** 2025-11-19  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
User wanted the LLM router to stop treating every “can you …” phrasing as a signal to switch to the advanced formatting model. The deeper goal was to keep routine “can you” prompts on the default provider to avoid unnecessary latency and cost while leaving the other precision-focused heuristics intact.

## What We Accomplished
- ✅ **Removed “can you” routing heuristic** – deleted the `can-you-instruction` rule from `DEFAULT_LLM_ROUTING_RULES`, so those prompts now remain on the runtime default provider/model unless other rules apply.
- ✅ **Refreshed router tests** – pruned the dedicated “can you” case, simplified the router-disabled scenario, and reran `npm run test -- worker/src/services/llm/routing.test.ts` to confirm coverage stays green.

## Technical Implementation
- Updated `selectLLMRoute`’s default rule set to only include spelled-sequence, spelling, formatting, and length-based triggers while preserving provider-aware edit model selection.
- Adjusted Vitest coverage to reflect the leaner heuristic set and verified the route-selection behavior through targeted tests.

**Files Modified:**
- `worker/src/services/llm/routing.ts` – removed the `can-you-instruction` entry from the default rules.
- `worker/src/services/llm/routing.test.ts` – deleted the old test case and updated router-disabled assertions.

## Bugs & Issues Encountered
1. **Legacy test still expected the removed trigger** – Vitest failed until the “can you” assertions were deleted.  
   - **Fix:** Updated the spec to match the new heuristic list and re-ran the targeted suite.

## Key Learnings
- **Router heuristics are easy to tune** – centralizing regex rules keeps edits localized to one list plus its dedicated tests.
- **Spell instructions still cover the old example sentences** – even without the “can you” rule, transcripts like “Can you spell…” continue to route correctly because of the explicit spell-trigger regex.

## Architecture Decisions
- **Rule removal over configuration** – chose to eliminate the heuristic entirely instead of adding another flag, keeping router configuration simple.
- **Maintain telemetry compatibility** – by only changing rule membership, downstream telemetry (from `2025-09-30_1825_llm-routing-telemetry.md`) continues to work without schema changes.

## Ready for Next Session
- ✅ **Router + tests updated** – heuristic set and coverage are current, no follow-up refactors required.
- 🔧 **Monitor routing telemetry** – review upcoming logs/metrics to confirm “can you” traffic now stays on the default provider and that other heuristics still fire as expected.

## Context for Future
Builds on `2025-09-30_1825_llm-routing-telemetry.md` by narrowing the heuristic set; routing telemetry can now quantify the impact of dropping this rule and guide any subsequent tuning of the regex-based router.
