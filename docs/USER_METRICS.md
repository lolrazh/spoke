# User-Specific Metrics & Analytics

**Last Updated:** 2025-11-12
**Status:** 🚧 In Development

## Purpose

This document describes the user-specific metrics collection system for Sonic Flow. The goal is to track **who is using the app and how much**, enabling:

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

These metrics are always stored for every dictation session, regardless of privacy settings:

**User Identity:**
- `user_id` - Supabase auth user ID (links to profiles table)

**Timing:**
- `created_at` - When the dictation session started
- `completed_at` - When the session finished
- `dictation_ms` - How long the user spoke (milliseconds)
- `e2e_ms` - End-to-end latency from stop to paste
- `total_ms` - Total session time from start to completion

**Performance Metrics:**
- `stt_ms` - Speech-to-text processing time (Groq API)
- `llm_ms` - LLM processing time (if used, otherwise null)
- `paste_ms` - Text insertion time
- `ws_accept_to_final_ms` - Server-side processing time

**Audio Metrics:**
- `frames_produced` - Number of audio frames sent
- `bytes_produced` - Total audio data size in bytes
- `audio_duration_ms` - Actual length of audio captured

**Result Metrics (Privacy-Preserving):**
- `word_count` - Number of words in the result
- `character_count` - Number of characters in the result

**Feature Usage:**
- `llm_enabled` - Boolean, did the user enable LLM processing?
- `llm_provider` - Which LLM provider was used (e.g., "groq")
- `stt_provider` - Which STT provider was used (default: "groq")

**Client Context:**
- `app_version` - Electron app version (for debugging version-specific issues)
- `os_version` - macOS version

**Session Identifiers:**
- `session_id` - Client-generated UUID for this dictation
- `trace_id` - Same as session_id, used for correlating with Sentry logs

### Privacy: No Transcription Text Storage

**Important:** We do **NOT** store the actual transcription text by default. We only store:
- How many words (count)
- How many characters (count)
- How long they spoke

This tells us **how** users are using the app without knowing **what** they're saying.

**Note on share_transcriptions feature:** This feature (which allowed users to opt-in to sharing actual transcription text) is currently disabled app-wide. The `result_text` column will remain null for all sessions. This may be re-enabled in the future if needed for training datasets, but for now, all transcription content remains completely private.

---

## Database Schema

### Table: `dictation_logs`

A single table stores one row per dictation session for all users.

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
- Unique constraint on `session_id` (prevent duplicates)

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

The data we store in `dictation_logs` comes directly from the session summary that's already being constructed in `buildSessionSummary()`:

| Session Summary Field | Database Column |
|----------------------|-----------------|
| `sessionId` | `session_id` |
| `traceId` | `trace_id` |
| `userId` (from identity) | `user_id` |
| `durations.dictationMs` | `dictation_ms` |
| `durations.e2eMs` | `e2e_ms` |
| `durations.totalMs` | `total_ms` |
| `durations.sttMs` | `stt_ms` |
| `durations.llmMs` | `llm_ms` |
| `durations.pasteMs` | `paste_ms` |
| `durations.wsAcceptToFinalMs` | `ws_accept_to_final_ms` |
| `traffic.frames` | `frames_produced` |
| `traffic.bytesKB * 1024` | `bytes_produced` |
| `result.textLen` | `character_count` |
| (calculated from text) | `word_count` |
| `llm.provider` | `llm_provider` |
| (always "groq" currently) | `stt_provider` |
| `pttDownMs` (timestamp) | `created_at` |
| (current time) | `completed_at` |

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
- Count sessions where `llm_enabled = true`
- Divide by total session count
- Can group by user to see who uses LLM

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

### Phase 1: Core Infrastructure (Current)
- Create `dictation_logs` table in Supabase
- Add Supabase client to Worker
- Modify `/metrics/session` endpoint to write to database after logging to Sentry
- Add error handling (non-blocking, shouldn't break transcription if DB write fails)
- Test with development environment
- Deploy to production

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
- **2025-11-12** - Disabled `share_transcriptions` feature app-wide; transcription text no longer stored
