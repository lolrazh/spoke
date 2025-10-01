# LLM Routing & Telemetry Enhancements

**Date:** 2025-09-30  
**Agent:** Droid (GPT-5-Codex)  
**Status:** ✅ Completed  

## User Intention
Enable smarter post-ASR handling by detecting spelling/formatting cues and routing those dictations to Kimi K2 while surfacing the chosen model in observability so downstream tooling can monitor when advanced formatting is invoked.

## What We Accomplished
- ✅ **Added regex-driven Kimi routing rules** – detected spelled sequences, “can you” prompts, and expanded formatting keywords (uppercase, caps, emphasize, etc.) to switch from Llama 4 to Kimi K2.
- ✅ **Propagated LLM metadata to telemetry** – included provider/model/route rules in websocket metrics, `/metrics/session` payloads, and Sentry spans for observability.
- ✅ **Updated tests for router & metrics** – expanded routing unit tests and session summary coverage to validate the new telemetry fields.

## Technical Implementation
- Introduced `selectLLMRoute` updates to recognise additional trigger phrases and return matched rule IDs alongside provider/model overrides.
- Extended websocket handler to log routing decisions, attach provider/model metadata to Sentry spans, dataset logging, and final metrics payloads.
- Enhanced `buildSessionSummary` to persist LLM details that `/metrics/session` forwards to logging/Sentry.

**Files Modified:**
- `worker/src/services/llm/routing.ts` – added “can you”, formatting keyword variants, rule metadata handling.
- `worker/src/services/llm/routing.test.ts` – broadened coverage for new regex triggers.
- `worker/src/handlers/ws.ts` – persisted routing results into metrics, dataset logging, and spans.
- `worker/src/utils/summary.ts` – surfaced LLM provider/model/rules in summary output.
- `worker/src/utils/summary.test.ts` – asserted presence of LLM metadata in summaries.
- `worker/src/index.ts` – forwarded LLM metadata into Sentry span attributes.
- `src/hooks/useTranscription.ts` – typed client metrics to accept LLM model/route data.

## Bugs & Issues Encountered
1. **Legacy lint/test failures** – ESLint control-regex rule and stale runtime-model expectations still fail the global lint/test commands.  
   - **Workaround:** Documented as pre-existing; targeted tests for new logic pass.

## Key Learnings
- **Routing extensibility:** Centralising regex rules with IDs makes it straightforward to audit which heuristics triggered in telemetry.
- **Telemetry alignment:** `/metrics/session` summaries already flow to Sentry, so adding LLM metadata there provides end-to-end observability without extra pipelines.
- **Test isolation:** Running targeted Vitest suites keeps feedback fast even when broader suites have unrelated breakages.

## Architecture Decisions
- **Expose route metadata end-to-end** – Chose to bubble provider/model/rule list through worker metrics and client payloads so both Sentry and analytics can inspect routing frequency.
- **Regex-first heuristic routing** – Accepted regex-based detection for speed and maintainability; alternative ML-based intent detection deemed unnecessary for now.

## Ready for Next Session
- ✅ **Routing + telemetry live** – New rules and observability hooks are implemented and unit-tested.
- 🔧 **Global lint/test debt** – Address legacy ESLint control-regex errors and runtime default-model assertions when bandwidth allows.

## Context for Future
With routing metadata now reaching Sentry, product teams can analyse how often advanced formatting requests occur and tune Kimi rules or prompts; future sessions can iterate on heuristics or split traffic without touching telemetry plumbing.
