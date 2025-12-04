# Fix Free Tier Quota Sync & Hook

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ✅ Completed

## User Intention
The user needed to resolve a critical issue where the free tier quota (2000 words/month) was not syncing correctly between the database, the worker, and the client application. Specifically, the worker was receiving `wordsUsed: 0` in the JWT claims even when the database showed significant usage (e.g., 2735 words), allowing users to dictate indefinitely. The goal was to ensure the `custom_access_token_hook` correctly read from the database and embedded authoritative quota claims into the JWT, and that the client app updated its local display from these claims.

## The Debugging Journey (Investigation)

We initially faced a confusing situation where the database had the correct values, but the Worker (via JWT) and Client (via localStorage) were both wrong and out of sync.

**Symptoms:**
- **Database**: 2735 words (correct, updates properly via `increment_quota_simple()`)
- **Worker logs**: `wordsUsed: 0` (from JWT claims)
- **Client cache**: 1182 words (stale localStorage)

**Failed Attempts:**
- ❌ Re-running the hook SQL (assuming it wasn't updated) - No effect.
- ❌ Implementing client-side sync before fixing the hook - Failed because JWTs were missing claims.
- ❌ Verifying hook registration - It was registered but silent.

**The Breakthrough:**
We discovered that the `custom_access_token_hook` was failing silently. By manually executing the function in the SQL Editor (`SELECT public.custom_access_token_hook(...)`), we uncovered the root cause:
`ERROR: 0A000: UPDATE is not allowed in a non-volatile function`

The function was defined as `STABLE` (promising no side effects), but contained an `UPDATE` statement for the "lazy monthly reset" logic. Postgres blocked the write, causing the function to crash before adding claims.

## What We Accomplished (The Fix)

- ✅ **Fixed Database Hook:** Updated the `custom_access_token_hook` to be `VOLATILE` (allowing writes) and `SECURITY DEFINER` (bypassing RLS to ensure it can read/write profiles).
- ✅ **Verified Hook Execution:** Confirmed via manual SQL execution that the hook now returns JSON with correct `words_used_this_month` and `quota_reset_date` claims.
- ✅ **Implemented Client Sync:** Updated `src/components/App.tsx` to decode the refreshed JWT on app startup and sync the local `quotaCache` with the authoritative values from the server.
- ✅ **Verified Full Pipeline:** Confirmed that Database → Hook → JWT → Worker (Gating) & Client (UI) are now perfectly synchronized.

## Technical Implementation

### Database Hook (`custom_access_token_hook`)
- **Volatility:** Changed from `STABLE` to `VOLATILE`.
- **Permissions:** Added `SECURITY DEFINER` and `set search_path = public, auth`.
- **Logic:** Checks subscription status. If free tier, reads `words_used_this_month` from `profiles`. If `quota_reset_date` is past, resets usage to 0 and updates date. Embeds `words_used_this_month`, `quota_limit`, and `quota_reset_date` into JWT claims.

### Client-Side Sync (`App.tsx`)
- In the `refreshSession()` logic on startup:
  - Decodes the returned JWT access token (Base64 decode).
  - Extracts `words_used_this_month` and `quota_reset_date`.
  - Calls `updateQuotaFromServer()` to update the local `quotaCache` state.

**Files Modified:**
- `src/components/App.tsx` - Added JWT decoding and quota sync logic.
- Database Function `public.custom_access_token_hook` - Updated definition (SQL executed via dashboard).

## Bugs & Issues Encountered

1. **Silent Hook Failure (The "Stable" Bug)**
   - **Symptom:** Hook logs showed "success", but JWTs lacked quota claims. Worker saw 0 usage.
   - **Root Cause:** The function was defined as `STABLE`, but attempted an `UPDATE`. Postgres blocked it, and the error was swallowed or caused early exit.
   - **Fix:** Changed function definition to `VOLATILE`.

2. **RLS Blocking Reads**
   - **Symptom:** Potential for hook to read `NULL` or `0` if it lacked permissions to read the `profiles` table row.
   - **Fix:** Added `SECURITY DEFINER` to the function to run with owner privileges.

3. **Client Cache Desync**
   - **Symptom:** Local UI showed stale data from `localStorage` while database was different.
   - **Fix:** Implemented logic to "trust the server" on app startup by reading the fresh JWT claims.

## Key Learnings
- **Postgres Function Volatility:** `STABLE` functions *cannot* modify the database. If an auth hook needs to write data (like our lazy reset logic), it **must** be defined as `VOLATILE`.
- **Debugging Hooks:** The most effective way to debug a Supabase Auth hook is to manually call it in the SQL Editor (`SELECT public.custom_access_token_hook(...)`) with test data. This reveals errors that might be swallowed during the actual auth flow.
- **Security Definer:** Essential for hooks that need to access user data (like `profiles`) that might be protected by RLS, ensuring the hook has the necessary permissions regardless of the auth context.
- **JWT Inspection:** Always decode the actual JWT to verify claims when debugging auth issues.

## Ready for Next Session
- ✅ **Quota System:** Fully functional, server-authoritative, and synced.
- 🔧 **None:** The system is stable.

## Context for Future
The free tier quota system is now robust. The "truth" lives in the `profiles` table. The Worker enforces this truth via JWT claims (zero database reads on the hot path). The Client displays this truth by syncing from the JWT on startup and incrementing locally during the session. Any future changes to quota limits or logic should be done primarily in the `custom_access_token_hook`.
