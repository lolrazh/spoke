# Free Tier Quota Implementation

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ✅ Completed  

## User Intention

The user wanted to implement a free tier quota system (2000 words/month limit) for Sonic Flow while maintaining three core principles: minimal latency, minimal database reads/writes, and separation of concerns. The initial request was to review and improve the architecture outlined in FREE_TIER_V2.md, with specific concerns about whether the app or worker should communicate with the database, and how to avoid the auth/latency issues experienced in a previous implementation that broke production. The underlying goal was to build a production-ready free tier system that gates users at the quota limit without compromising the dictation experience.

## What We Accomplished

- ✅ **Quota Cache Module** (`src/state/quotaCache.ts`) - Created localStorage-based quota tracking with subscriber pattern, following the existing `userIdentity.ts` pattern for consistency
- ✅ **Custom Access Token Hook** - Updated Supabase Postgres function to add quota claims (`words_used_this_month`, `quota_limit`, `quota_reset_date`) to JWT for free tier users, with lazy monthly reset logic and error handling
- ✅ **Database Sync Function** - Created `sync_quota_simple()` SQL function for periodic quota persistence from app to database
- ✅ **Worker JWT Verification** - Extended JWT verification to extract quota claims and added `QUOTA_EXCEEDED` (4021) close code
- ✅ **Worker Auth Handler** - Updated WebSocket auth logic to allow free tier users under quota limit instead of blocking all non-paying users
- ✅ **App Integration** - Integrated quota tracking into transcription flow with local increment and periodic sync (every 5 dictations or 5 minutes)
- ✅ **Client Error Handling** - Added quota exceeded error handling in `useTranscription.ts` with appropriate user-facing messages

## Technical Implementation

### Architecture Decision: Client-Side Writes (App → DB)

After extensive discussion, we chose a **client-authoritative** quota tracking approach:

**Flow:**
```
User dictates → Worker checks JWT quota (instant) → 
Transcription completes → App increments local cache → 
Every 5 dictations/5 min: App syncs to Supabase →
On app restart: refreshSession() gets fresh JWT with server quota
```

**Key Components:**

1. **Local Cache** (`quotaCache.ts`):
   - localStorage keys: `sf.quotaWordsUsed`, `sf.quotaResetDate`, `sf.quotaLastSynced`
   - Subscriber pattern for reactive UI updates
   - Offline-aware with `navigator.onLine` checks
   - 5-minute timer for time-based sync

2. **Database Schema** (existing):
   - `profiles.words_used_this_month` (integer)
   - `profiles.quota_reset_date` (timestamptz)

3. **Custom Access Token Hook**:
   - For free users: reads quota from profiles table
   - Implements lazy monthly reset (if `reset_date < NOW()`, resets counter to 0)
   - Adds JWT claims: `words_used_this_month`, `quota_limit` (2000), `quota_reset_date`
   - Error handling: falls back to basic subscription claim if quota logic fails
   - Does NOT touch Pro users (preserves existing logic)

4. **Worker Changes**:
   - JWT verification extracts `wordsUsedThisMonth` and `quotaLimit` from payload
   - Auth handler checks quota for free users: `if (wordsUsed >= quotaLimit) → close(4021)`
   - Allows free users under quota (logs event: `auth.free_tier_allowed`)
   - New close code: `WS_CLOSE_CODES.QUOTA_EXCEEDED = 4021`

5. **Sync Strategy**:
   - **Triggers**: Every 5 dictations OR every 5 minutes (whichever comes first)
   - **Additional**: On app blur/close, when limit reached
   - **Stop syncing**: After quota limit hit (resume next month after reset)
   - **Method**: Calls `sync_quota_simple(user_id, words_used)` RPC

**Files Modified:**

Worker:
- `worker/src/auth/supabaseJwt.ts` - Added quota fields to `JwtVerifyResult` type and extraction logic
- `worker/src/auth/index.ts` - Added `QUOTA_EXCEEDED: 4021` close code
- `worker/src/handlers/ws.ts` - Updated auth handler to check quota instead of blocking all free users (lines 296-339)

App:
- `src/state/quotaCache.ts` - **NEW** - Complete quota cache module (415 lines)
- `src/components/App.tsx` - Initialize quota cache on startup (lines 351-360)
- `src/hooks/useTranscription.ts` - Quota tracking integration after transcription (lines 1557-1586), added `WS_CLOSE_QUOTA_EXCEEDED` constant and handler (lines 44-47, 651-666)

Database:
- `custom_access_token_hook()` - Updated to add quota claims for free users (deployed via Supabase SQL Editor)
- `sync_quota_simple(user_id, words_used)` - New function for app-to-DB quota sync (deployed via Supabase SQL Editor)

## Bugs & Issues Encountered

1. **Initial blocking of all free users**
   - **Symptom:** Error `[SF] Auth failed: Active subscription required code: 4020` - user couldn't dictate
   - **Root Cause:** Worker was blocking all users without `subscription_active: true`, which was the old payment-gated logic
   - **Fix:** Updated worker to check quota for free users: allow if `wordsUsed < quotaLimit`, block with 4021 if over limit

2. **SQL file cleanup confusion**
   - **Symptom:** User had SQL migration files sitting in `supabase/migrations/` after running them
   - **Resolution:** User deleted them (functions already deployed to Supabase dashboard)
   - **Note:** Functions are documented in Supabase SQL Editor history, no need to keep local copies

## Key Learnings

- **JWT Claim Propagation**: JWT claims are updated on `refreshSession()` call, not automatically. The Custom Access Token Hook runs synchronously during token issuance, so fresh quota data requires an explicit session refresh (already implemented on app startup from PR 175).

- **Lazy Monthly Reset**: Implementing reset logic in the Custom Access Token Hook (rather than a cron job) is elegant because it runs exactly when needed (on first JWT refresh of new month), requires no additional infrastructure, and self-heals if reset date is null.

- **Fire-and-forget Sync**: The `syncQuotaToServer()` function never blocks the transcription flow - it's called asynchronously after transcription completes, and failures are logged but don't break the user experience.

- **Worker Separation of Concerns**: The worker change was minimal (10 lines in auth handler) and didn't touch any transcription logic. The fear of "worker becoming a mess" was about *where* and *when* DB access happened, not about its existence. JWT-based gating keeps the worker stateless.

- **localStorage Pattern Consistency**: Following the `userIdentity.ts` pattern made `quotaCache.ts` easy to implement and understand. The subscriber pattern allows multiple UI components to react to quota changes without prop drilling.

## Architecture Decisions

- **Client-side quota writes vs Server-side writes**
  - **Decision:** App writes quota to database (client-authoritative)
  - **Trade-off:** Security (users can tamper with localStorage/RPC calls) vs Simplicity (no worker DB writes)
  - **Rationale:** For early-stage product with mostly honest users, shipping fast outweighs perfect security. Can tighten later when abuse patterns emerge. Worker stays focused on transcription + JWT validation.
  - **Accepted Risk:** Tech-savvy users can bypass quota by editing localStorage or blocking RPC calls
  - **Mitigation:** JWT validation on startup (server wins on mismatch), quota gating at auth time (instant blocking)

- **Sync frequency: Every 5 dictations OR 5 minutes**
  - **Decision:** Dual trigger system (counter-based and time-based)
  - **Rationale:** Balances database load (4,000 writes/day at 1,000 users × 20 dictations/day), UX freshness (progress bar updates every ~5 dictations), and resilience (5-min timer catches pauses)
  - **Alternative rejected:** Every dictation (200k writes/day at scale, defeats JWT optimization purpose)

- **Hardcoded 2000 word limit**
  - **Decision:** Quota limit compiled into code (`const QUOTA_LIMIT = 2000`)
  - **Rationale:** User confirmed hardcoded is fine, configurable was "a pain in the ass"
  - **Future:** Can easily change to env var or database column if needed

- **Quota gating at auth time (not post-transcription)**
  - **Decision:** Worker checks `wordsUsed >= quotaLimit` during WebSocket auth handshake, before any audio is streamed
  - **Rationale:** User requirement: "If user runs out of quota they should be blocked immediately when they try to dictate. What happens with the worker is that they speak and speak and only at the end we block them. That's terrible UX."
  - **Result:** User sees "Monthly word limit reached" before recording starts, not after wasting their time speaking

## Ready for Next Session

- ✅ **Free tier fully functional** - Users can dictate up to 2000 words/month, get blocked at limit with clear message
- ✅ **Database schema ready** - `words_used_this_month` and `quota_reset_date` columns exist and work
- ✅ **JWT claims flowing** - Custom Access Token Hook adds quota to JWT, worker validates it
- ✅ **Local cache working** - Progress bar can subscribe to quota updates (implementation pending)
- 🔧 **Progress bar UI needed** - `quotaCache.ts` provides `subscribeQuota()` hook, but no UI component built yet
- 🔧 **Security consideration** - Current implementation is client-authoritative (can be bypassed). See "Context for Future" section.

## Context for Future

This implementation prioritizes **shipping speed and UX** over **abuse prevention**. The quota system works end-to-end and provides good UX (instant blocking at limit, no latency), but is vulnerable to client-side tampering. 

**For future tightening (when product scales):**
- Move quota writes to worker (`executionCtx.waitUntil()` for fire-and-forget)
- Worker counts words after transcription and calls `increment_quota_simple(user_id, word_count)`
- Maintains all current UX benefits (JWT gating at auth, zero latency) while making quota server-authoritative
- Estimated effort: 10 lines in `worker/src/handlers/ws.ts` after transcription completes

**Current implementation is "good enough to ship" if:**
1. Abuse is not a major concern at current scale
2. Most users are honest (true for $5/month dictation app)
3. Plan to monitor for abuse patterns and tighten when needed

The architecture is already JWT-based (fastest path for gating), uses pre-connect (eliminates first-word loss), and has lazy monthly reset (no cron needed). The only question is who writes the quota counter.

**Related Documentation:**
- `FREE_TIER_V2.md` - Implementation plan followed during this session
- `FREE_TIER.md` - Old plan (database query approach, not used)
- `agent-logs/2025-12-02_1900_payments-auth-optimization.md` - Custom Access Token Hook for subscription claims
- `agent-logs/2025-12-03_2225_post-payment-jwt-refresh.md` - JWT refresh strategy on app startup
