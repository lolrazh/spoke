# User-Specific Metrics & Analytics Implementation

**Date:** 2025-11-12
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention

User wanted to implement comprehensive user-specific logging and analytics to understand who is using the app and how much. The goal was to move beyond Sentry's ephemeral logs to a persistent, queryable database that could answer questions like "who dictated the most words this month?" and "what's the average latency across all users?" They wanted to track usage patterns, performance metrics, and feature adoption without storing actual transcription text (privacy-first approach).

## What We Accomplished

- ✅ **Database Schema Design** - Created lean `dictation_logs` table in Supabase with 19 essential columns tracking timing, performance, audio metrics, and feature usage
- ✅ **Supabase Integration** - Built complete Worker integration with client initialization, insert logic, and error handling in `worker/src/db/supabase.ts`
- ✅ **Word Counting Logic** - Implemented privacy-preserving word counting that splits text on whitespace without storing the actual text
- ✅ **STT Model Tracking** - Added `stt_model` column and plumbing to track which STT model was used (e.g., "whisper-large-v3")
- ✅ **Client User ID Propagation** - Modified Electron app to fetch and send user ID in metrics payload
- ✅ **Non-Blocking Database Writes** - Integrated database writes into `/metrics/session` endpoint after Sentry logging, ensuring zero user-perceived latency
- ✅ **Comprehensive Documentation** - Created detailed `docs/USER_METRICS.md` explaining architecture decisions, privacy approach, and implementation details

## Technical Implementation

**Architecture Pattern:**
```
Client → Worker /metrics/session → Sentry (keep) → Supabase (new)
```

**Data Flow:**
1. User completes dictation
2. Client sends metrics to Worker via POST `/metrics/session`
3. Worker builds unified session summary
4. Worker logs to Sentry (existing)
5. Worker writes to Supabase `dictation_logs` table (new, non-blocking)

**Database writes happen AFTER transcription completes** - zero impact on user experience.

**Files Created:**
- `worker/src/db/supabase.ts` - Supabase client, word counting, insert logic

**Files Modified:**
- `worker/src/index.ts` - Added Supabase bindings, database write in `/metrics/session`
- `worker/src/utils/summary.ts` - Added `stt_model` to SttMetrics type, created `sttInfo` object returned in summary
- `worker/src/handlers/ws.ts` - Added `runtime.stt.model` to worker metrics
- `src/hooks/useTranscription.ts` - Added `userIdRef`, fetch user ID on mount, send in metrics payload
- `worker/package.json` - Added `@supabase/supabase-js` dependency
- `docs/USER_METRICS.md` - Comprehensive documentation (429 lines)

## Bugs & Issues Encountered

1. **Column Naming Confusion** - Initially used `SUPABASE_SERVICE_KEY` but user wanted consistency with existing `SUPABASE_SERVICE_ROLE_KEY`
   - **Fix:** Renamed binding to `SUPABASE_SERVICE_ROLE_KEY` across all files

2. **Missing STT Model** - STT metrics included provider but not model, so `stt_model` column couldn't be populated
   - **Fix:** Added `model` field to `SttMetrics` type, tracked `runtime.stt.model` in worker metrics, returned `sttInfo` in summary

3. **Over-Engineering Initial Schema** - First draft included too many granular columns (bytes, frames, paste_ms, capture_ms, etc.)
   - **Fix:** User streamlined to 19 essential columns focused on core metrics only

4. **Redundant trace_id Column** - Both `session_id` and `trace_id` stored the same value
   - **Fix:** Removed `trace_id` column, kept only `session_id` for Sentry correlation

## Key Learnings

- **Supabase vs Cloudflare D1** - Chose Supabase because: (1) already integrated for auth, (2) PostgreSQL has mature analytics tooling, (3) easy external tool connections, (4) user IDs already available. Trade-off: 50-100ms overhead for HTTP call, but happens post-transcription so no user impact.

- **Worker-Side vs Client-Side Writes** - Chose Worker because: (1) data integrity (client can't fake metrics), (2) single source of truth, (3) security (service key never exposed), (4) simpler client. Non-blocking design means zero latency impact.

- **Privacy-First Metrics** - Store only metadata (counts, timings, features used), never store actual transcription text. Word count calculated from text during processing but text itself not persisted. This gives usage insights without compromising user privacy.

- **Word Counting Approach** - Simple `text.trim().split(/\s+/).filter(Boolean).length` is sufficient. No need for complex NLP libraries - whitespace splitting works for word count analytics.

- **Pipeline Field Importance** - The `pipeline` field (edit | dictation | stt+llm | stt) is critical for understanding feature adoption and usage patterns across different modes.

## Architecture Decisions

- **Single Table Design** - One `dictation_logs` table for all users (standard analytics pattern). Makes aggregation queries simple: "sum up dictation_ms grouped by user_id". Alternative (one table per user) would require expensive join operations.

- **No Migrations Approach** - Manually creating tables via SQL editor instead of migration files. Aligns with existing project approach. For schema changes, can use `ALTER TABLE` commands as needed.

- **session_id for Correlation** - Using `session_id` (unique) as both primary key for database and correlation ID with Sentry. Removed redundant `trace_id` column. Sentry stores it as `session.trace_id` so searches still work.

- **Minimal Column Set** - Removed "nice to have" columns (app_version, ws_accept_to_final_ms, bytes, frames, etc.) in favor of lean schema with only essential analytics data. Can always add columns later if needed.

- **Non-Blocking Writes** - Database write wrapped in `safely()` helper and happens after response sent to client. If Supabase is down, transcription still works - just metrics aren't logged. Failed writes logged to Sentry for monitoring.

## Ready for Next Session

- ✅ **Production-Ready Code** - All code tested in development, ready for Worker deployment
- ✅ **Complete Documentation** - `docs/USER_METRICS.md` explains everything from architecture to example queries
- ✅ **Database Schema Created** - `dictation_logs` table with all indexes and RLS policies in place
- ✅ **Environment Variables Set** - Worker has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets configured
- 🔧 **Analytics Queries** - Next step is creating Supabase views for common queries (top users, average latency, feature adoption rates)
- 🔧 **Dashboard UI** - Future work to build admin dashboard or connect to Metabase/Grafana

## Context for Future

This implementation establishes the foundation for long-term user analytics and product insights. The lean schema (19 columns) captures essential usage patterns, performance metrics, and feature adoption without storing any user-generated content. Data is queryable indefinitely, enabling trend analysis, retention tracking, and data-driven product decisions. The non-blocking design means this analytics layer has zero impact on core transcription performance. Next phase would be building analytics views, dashboards, and potentially user-facing statistics ("you've dictated 10,000 words this month!").
