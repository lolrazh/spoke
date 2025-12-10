# User-Specific Metrics & Analytics

**Last Updated:** 2025-11-12
**Status:** ✅ Implemented

## Purpose

This document describes the user-specific metrics collection system for Spoke. The goal is to track **who is using the app and how much**, enabling:

- **Usage analytics:** Understand which users are power users vs casual users
- **Performance monitoring:** Track average latency metrics across all users with ability to filter by user
- **Product insights:** Identify usage patterns, feature adoption, and user retention
- **Individual statistics:** Future capability to show users their own usage stats (total dictation time, word count, etc.)

This is separate from our existing Sentry logging, which is primarily for real-time debugging and error monitoring.

---

## Why We Need This

### Current State: Sentry-Only Logging

Right now, every dictation session logs metrics to Sentry via the `/metrics/session` endpoint. This gives us:

- ✅ Real-time visibility into session performance
- ✅ Error tracking and debugging capabilities
- ✅ Structured logs searchable by `session.trace_id`

However, Sentry has limitations for our analytics needs:

- ❌ **Not designed for long-term storage** - Logs are typically retained for 30-90 days
- ❌ **Not designed for analytics queries** - Can't easily answer "who dictated the most words this month?"
- ❌ **Expensive at scale** - Free tier is limited, paid tiers get expensive with high volume
- ❌ **No user-centric views** - Hard to aggregate data by user over time
- ❌ **No persistent historical data** - Can't track user growth, retention, or trends over months/years

### What We Need: Long-Term User Analytics

We need to answer questions like:

- Who are our top 10 users by total dictation time?
- What's the average latency for all users this week?
- How many users dictated more than 1000 words this month?
- What percentage of users enable LLM features?
- Are users coming back day after day (retention)?
- How has average dictation length changed over time?

These require a proper database that stores data long-term and supports complex analytical queries.

---

## Architecture Decisions

### Decision 1: Supabase vs Cloudflare D1

We chose **Supabase (PostgreSQL)** over Cloudflare D1 for several reasons:

**Why Supabase:**

1. **Already integrated** - We're already using Supabase for user authentication and profiles, so we have the infrastructure and user IDs available
2. **Mature ecosystem** - PostgreSQL has decades of tooling for analytics, dashboards, and data visualization
3. **Easy external access** - Can query directly from analytics tools like Metabase, Grafana, Retool, or even custom admin dashboards
4. **Powerful SQL** - PostgreSQL's window functions, aggregations, and indexing are ideal for analytics
5. **Built-in user management** - User IDs from `auth.users` table automatically link to metrics
6. **Generous free tier** - 500MB database storage and 50,000 monthly active users
7. **Future-proof** - Easy to build user-facing statistics dashboards in the app later

**Why Not Cloudflare D1:**

- Harder to query from external tools (would need to build API endpoints)
- Newer service with less mature analytics tooling
- Would need custom integration to link with Supabase user IDs
- No built-in dashboard/visualization tools

**Trade-off:** Worker needs to make an HTTP call to Supabase (~50-100ms overhead), but this happens **after** the user already got their transcription result, so it doesn't impact perceived latency.

---

### Decision 2: Worker-Side vs Client-Side Database Writes

We chose to write metrics from the **Worker** rather than the **Client** for several reasons:

**Why Worker-Side:**

1. **Data integrity** - Worker has authoritative data; clients could theoretically send fake/manipulated metrics
2. **Single source of truth** - All metrics are calculated in one place (the Worker already computes everything)
3. **Simpler client** - Electron app doesn't need Supabase client, credentials, or database write logic
4. **Non-blocking** - Database write happens **after** WebSocket sends final result back to client, so user doesn't wait
5. **Easier debugging** - All logging/metrics logic is centralized in Worker
6. **Security** - Supabase service key stays in Worker environment, never exposed to client
7. **Consistency** - Guarantees every transcription that completes gets logged (no client-side failures)

**Why Not Client-Side:**

- Would require embedding Supabase client and credentials in Electron app
- Users could inspect and potentially manipulate data
- Client could fail to write (network issues, app crash) leading to missing data
- Duplicates metric-calculation logic between Worker and Client
- Harder to audit and debug (data flowing from multiple sources)

**Implementation Detail:** The database write happens asynchronously after the Worker has already sent the final transcription result to the client. This means zero impact on user-perceived latency.

---

## Data Flow Comparison

### Current Flow (Sentry Only)

```
1. User speaks → Electron App records audio
2. App sends audio → Worker via WebSocket
3. Worker transcribes → Groq API
4. Worker sends result → App pastes text (USER SEES RESULT)
5. App sends metrics → Worker POST /metrics/session
6. Worker logs to Sentry → For real-time debugging
```

### New Flow (Sentry + Database)

```
1. User speaks → Electron App records audio
2. App sends audio → Worker via WebSocket
3. Worker transcribes → Groq API
4. Worker sends result → App pastes text (USER SEES RESULT)
5. App sends metrics → Worker POST /metrics/session
6. Worker logs to Sentry → For real-time debugging (keep this)
7. Worker writes to Supabase → For long-term analytics (NEW)
```

**Key Point:** Step 7 happens in the background after the user already has their result. No additional latency.

---

## What Data We Track

### Always Tracked (Metadata Only)

These metrics are stored for every dictation session. **No transcription text is ever stored** - only metadata about usage patterns and performance.

**User & Session:**
- `id` - Unique row identifier (auto-generated UUID)
- `user_id` - Supabase auth user ID (links to profiles table)
- `session_id` - Client-generated UUID for this dictation (unique, used for Sentry correlation)
- `created_at` - When the dictation session started (auto-generated)
- `completed_at` - When the session finished

**Timing Metrics (milliseconds):**
- `dictation_ms` - How long the user spoke (PTT down → stop)
- `e2e_ms` - End-to-end latency (stop → text pasted)
- `total_ms` - Total session time (PTT down → paste complete)

**Performance Metrics (milliseconds):**
- `stt_ms` - Speech-to-text processing time
- `llm_ms` - LLM processing time (null if not used)

**Audio Metrics:**
- `audio_duration_ms` - Actual length of audio captured (first frame → last frame arrival)

**Result Metrics (Privacy-Preserving):**
- `word_count` - Number of words in the transcription result (calculated from text length, not stored)

**Feature Usage:**
- `pipeline` - Mode used: `edit` | `dictation` | `stt+llm` | `stt`
- `stt_provider` - Which STT provider was used (e.g., "groq", "fireworks", "deepgram")
- `stt_model` - Which STT model was used (e.g., "whisper-large-v3")
- `llm_provider` - Which LLM provider was used (e.g., "groq") - null if not used
- `llm_model` - Which LLM model was used (e.g., "llama-3.3-70b-versatile") - null if not used

**WebSocket Info:**
- `ws_close_code` - WebSocket close code (1000 = normal closure)
- `ws_close_reason` - WebSocket close reason (e.g., "done")

### Privacy: No Transcription Text Storage

**Important:** We do **NOT** store the actual transcription text. We only store:
- How many words (count)
- How long they spoke
- Performance metrics

This tells us **how** users are using the app without knowing **what** they're saying. All transcription content remains completely private.

---

## Database Schema

### Table: `dictation_logs`

A single table stores one row per dictation session for all users.

**Current Schema:**

```sql
CREATE TABLE dictation_logs (
  -- Identifiers
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,

  -- Timing metrics (milliseconds)
  dictation_ms integer,
  e2e_ms integer,
  total_ms integer,

  -- Performance metrics (milliseconds)
  stt_ms integer,
  llm_ms integer,

  -- Audio metrics
  audio_duration_ms integer,

  -- Result metrics
  word_count integer,

  -- Feature usage
  pipeline text,
  stt_provider text,
  stt_model text,
  llm_provider text,
  llm_model text,

  -- WebSocket info
  ws_close_code integer,
  ws_close_reason text
);
```

**Why one table for everyone?**
- This is standard database design for analytics
- Makes aggregation queries simple: "sum up all dictation_ms grouped by user_id"
- Efficient with proper indexing
- Easy to filter by user, date range, features, etc.

**Indexes for Fast Queries:**
- Primary index on `id`
- Index on `user_id` (for per-user queries)
- Index on `created_at` (for time-based queries)
- Composite index on `(user_id, created_at)` (for user timeline queries)
- Index on `pipeline` (for filtering by mode)
- Unique constraint on `session_id` (prevent duplicates & enable Sentry correlation)

**Retention Policy:**
- Raw session data retained indefinitely (it's just metadata, very small)
- Can archive old data (>1 year) to cheaper storage if needed
- Daily/monthly aggregates can be precomputed for faster dashboard queries

---

## Comparison with `/metrics/session` Endpoint

### What `/metrics/session` Does Now

The existing endpoint already:
1. Receives client-side metrics (POST from Electron app)
2. Merges them with server-side metrics
3. Builds a unified session summary
4. Logs to Sentry with structured JSON
5. Creates Sentry span for tracing

This is all preserved and continues to work exactly as before.

### What We're Adding

We're simply adding **one additional step** to `/metrics/session`:

After logging to Sentry, also write the same data to Supabase for long-term storage.

**Why both?**
- **Sentry:** Real-time monitoring, error tracking, debugging active issues
- **Supabase:** Historical analytics, user trends, long-term performance tracking

They serve complementary purposes. Sentry tells you "what's happening right now," and Supabase tells you "what's been happening over time."

### Data Mapping

The data we store in `dictation_logs` comes directly from the session summary that's being constructed in `buildSessionSummary()`:

| Session Summary Field | Database Column | Notes |
|----------------------|-----------------|-------|
| `sessionId` | `session_id` | Unique identifier for correlation with Sentry |
| `meta.userId` | `user_id` | From client auth |
| `durations.dictationMs` | `dictation_ms` | How long user spoke |
| `durations.e2eMs` | `e2e_ms` | Post-dictation latency |
| `durations.totalMs` | `total_ms` | Total session time |
| `durations.sttMs` | `stt_ms` | STT processing time |
| `durations.llmMs` | `llm_ms` | LLM processing time (null if not used) |
| `traffic.firstToLastArrivalMs` | `audio_duration_ms` | Audio stream duration |
| (calculated from dataset text) | `word_count` | Splits text on whitespace, counts words |
| `pipeline` | `pipeline` | edit \| dictation \| stt+llm \| stt |
| `stt.provider` | `stt_provider` | e.g., "groq", "fireworks", "deepgram" |
| `stt.model` | `stt_model` | e.g., "whisper-large-v3" |
| `llm.provider` | `llm_provider` | e.g., "groq" (null if not used) |
| `llm.model` | `llm_model` | e.g., "llama-3.3-70b-versatile" (null if not used) |
| `ws.closeCode` | `ws_close_code` | 1000 = normal closure |
| `ws.closeReason` | `ws_close_reason` | e.g., "done" |
| (current timestamp) | `created_at` | Auto-generated DEFAULT NOW() |
| (current timestamp) | `completed_at` | Set when row is inserted |

---

## Example Analytics Queries

Once data is in Supabase, we can answer analytical questions:

**Top 10 users by total dictation time this month:**
- Filter where `created_at` is in current month
- Group by `user_id`
- Sum `dictation_ms` per user
- Sort descending and take top 10

**Average end-to-end latency this week:**
- Filter where `created_at` is in last 7 days
- Calculate average of `e2e_ms`
- Can group by day to see trends

**LLM feature adoption rate:**
- Count sessions where `llm_ms IS NOT NULL` (LLM was used)
- Divide by total session count
- Can group by user to see who uses LLM
- Can also filter by `pipeline = 'edit'` or `pipeline = 'dictation'` to see mode-specific usage

**Power users (>1000 words dictated this month):**
- Filter where `created_at` is in current month
- Group by `user_id`
- Sum `word_count` per user
- Filter where sum > 1000

**User retention (came back multiple days):**
- Group by `user_id` and date of `created_at`
- Count distinct dates per user
- Identify users with multiple days

These queries will be exposed via:
1. SQL views in Supabase for common queries
2. Custom admin dashboard endpoints
3. Direct connections to analytics tools like Metabase
4. Future in-app statistics pages for users

---

## Implementation Plan

### Phase 1: Core Infrastructure ✅ **COMPLETE**
- ✅ Created `dictation_logs` table in Supabase
- ✅ Added Supabase client to Worker (`worker/src/db/supabase.ts`)
- ✅ Modified `/metrics/session` endpoint to write to database after logging to Sentry
- ✅ Added error handling (non-blocking, doesn't break transcription if DB write fails)
- ✅ Added word counting logic (splits text on whitespace)
- ✅ Added STT model tracking
- ✅ Tested in development environment
- ✅ Ready for production deployment

### Phase 2: Analytics Layer (Future)
- Create Supabase views for common analytical queries
- Set up Row Level Security policies
- Create admin dashboard API endpoints
- Build simple analytics dashboard (internal use)

### Phase 3: User-Facing Features (Future)
- Add "Your Statistics" page in app settings
- Show personal metrics: total time, word count, session history
- Add data export feature ("download my data")
- Visualizations (charts, graphs, trends)

### Phase 4: Advanced Analytics (Future)
- Retention cohort analysis
- Feature adoption funnels
- Performance regression detection
- A/B testing infrastructure
- Integration with external analytics tools

---

## Security & Privacy

### Data Protection

**What we store:**
- Usage metadata (durations, counts, timestamps)
- Performance metrics (latencies, processing times)
- Feature flags (which features used)

**What we DON'T store:**
- Actual transcription text content (currently disabled for all users)
- Audio recordings
- Application window titles
- Any other user-generated content

### User Rights

Users have the right to:
- View their own data (future feature)
- Export their data (future feature)
- Request deletion of their data (GDPR compliance)

When a user deletes their account:
- Profile is deleted from `profiles` table
- All dictation_logs for that `user_id` are deleted (CASCADE constraint)
- Historical aggregates are anonymized

### Access Control

- Worker uses Supabase service key (not exposed to clients)
- Row Level Security policies ensure users can only query their own data (when we add user-facing features)
- Admin queries use service key for cross-user analytics

---

## Monitoring & Reliability

### Non-Blocking Design

Database writes are non-blocking:
- If Supabase is down, transcription continues to work
- Failed writes are logged to Sentry as errors
- Could add retry logic with exponential backoff if needed

### Error Handling

- Database write failures don't break the transcription flow
- Errors logged to Sentry for monitoring
- Can add dead letter queue for failed writes if needed

### Performance

- Database writes happen after user gets result (zero perceived latency)
- Properly indexed table ensures fast queries even with millions of rows
- Can add caching layer for frequently accessed metrics if needed

---

## Future Considerations

### Potential Enhancements

1. **Daily aggregates table** - Precompute daily stats per user for faster dashboard queries
2. **Real-time analytics** - Use Supabase Realtime for live usage dashboards
3. **Data export API** - Let users download their usage history as CSV/JSON
4. **Webhook integration** - Trigger events on milestones (e.g., 1000 dictations)
5. **Machine learning** - Analyze patterns for feature recommendations
6. **Cost tracking** - Estimate API costs per user based on usage

### Migration Path

If we need to change the schema:
- Supabase supports migrations (unlike our current no-migration approach)
- Can add columns without breaking existing queries
- Can create new tables and views without touching production data
- Can backfill data from Sentry logs if needed

---

## Related Documentation

- `INSTRUMENTATION.md` - Describes the Sentry logging pipeline that feeds into this system
- `AUTH.md` - Explains user authentication and profile management (source of user_ids)
- `TRANSCRIPTION.md` - Details the transcription flow that generates the metrics we track

---

## Changelog

- **2025-11-12** - Initial documentation created
- **2025-11-12** - Implemented core infrastructure (Phase 1 complete)
  - Created `dictation_logs` table in Supabase
  - Added Supabase integration to Worker
  - Implemented word counting logic
  - Added STT model tracking (provider + model)
  - All metrics flowing correctly to database
- **2025-11-12** - Schema refinements
  - Removed unnecessary columns: `trace_id`, `ws_accept_to_final_ms`, `app_version`
  - Kept only essential metrics for analytics
  - Added `stt_model` column for provider transparency
- **2025-11-12** - Privacy decisions
  - Transcription text storage disabled (only metadata tracked)
  - Word count calculated from text length but text itself not persisted
