# Free Tier Quota Sync Debugging (FAILED)

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ❌ Investigation Failed - Issue Unresolved

## User Intention

User discovered that free tier quota is completely out of sync across the entire system. The fundamental issue: the `custom_access_token_hook()` Postgres function should be reading `words_used_this_month` from the database and embedding it in JWT claims, but the worker consistently receives `wordsUsed: 0` even though the database has the correct value (2735 words).

**Key Symptom:**
- **Database**: 2735 words (correct, updates properly via `increment_quota_simple()`)
- **Worker logs**: `wordsUsed: 0` (from JWT claims)
- **Client cache**: 1182 words (stale localStorage)

**User's Goal:** Understand WHY the JWT doesn't contain the correct quota data and fix the sync pipeline so the worker blocks users when they exceed 2000 words.

## What We Attempted

- ❌ **Verified Hook SQL Exists** - Confirmed `custom_access_token_hook()` function exists in Supabase with quota logic
- ❌ **Re-ran Hook SQL** - Executed complete hook SQL with quota claims logic (user said it made no difference)
- ❌ **Added Client-Side JWT Decoding** - Added code to App.tsx to decode JWT and sync quota cache on startup (reverted - didn't work)
- ❌ **Checked Hook Registration** - Verified hook is registered in Authentication → Hooks
- ❌ **Checked Schema** - Confirmed `words_used_this_month` and `quota_reset_date` columns exist and are populated
- ❌ **Reviewed Implementation Logs** - Analyzed PR #176 and Dec 4 implementation log (found documentation but unclear if SQL was executed)

## The Three Different Values Problem

At the time of debugging, the system showed THREE completely different quota values:

```
1. DATABASE (source of truth):
   - words_used_this_month: 2735
   - Location: profiles table
   - Updated by: worker via increment_quota_simple()
   - Status: ✅ Working correctly

2. WORKER (from JWT claims):
   - wordsUsed: 0
   - quotaLimit: 2000
   - remaining: 2000
   - Source: JWT payload (payload.words_used_this_month)
   - Log: {"event":"auth.free_tier_allowed","wordsUsed":0,"quotaLimit":2000}
   - Status: ❌ WRONG - should be 2735

3. CLIENT CACHE (localStorage):
   - wordsUsed: 1182
   - resetDate: null
   - Log: [QuotaCache] Hydrated from cache: {wordsUsed: 1182, ...}
   - Status: ❌ WRONG - stale from previous session
```

## Root Cause Hypothesis (Unconfirmed)

The most likely issue is that **the `custom_access_token_hook()` is not actually running** or **not being invoked by Supabase Auth** during JWT generation/refresh, despite being registered in the dashboard.

**Evidence:**
1. Worker consistently receives `wordsUsed: 0` (default when claim is missing)
2. User confirmed database values are correct and updating
3. User confirmed they ran the hook SQL multiple times
4. Hook is registered in Supabase dashboard

**Possible Causes (Not Verified):**
- Hook is registered but not being called by Supabase Auth
- Hook is running but encountering a silent error (no logs visible)
- Hook is running but the claims aren't being added to the JWT properly
- Supabase project has caching issues preventing hook updates
- There's a different hook overriding this one
- User ID mismatch between auth.users and profiles table

## What We Failed To Do

- ❌ **Decode an actual JWT and inspect it** - Never actually looked at a real JWT payload from the app to see what claims it contains
- ❌ **Check Supabase Postgres Logs** - Never verified if the hook is actually being called (would show `raise log` statements)
- ❌ **Verify User ID Consistency** - Never confirmed the user_id in JWT matches the ID in profiles table
- ❌ **Test with a Fresh User** - Never tried creating a new user to see if hook works for them
- ❌ **Check for Multiple Hooks** - Never verified there isn't another auth hook overriding this one
- ❌ **Manual JWT Generation Test** - Never manually called the hook function with test data to verify it works

## Attempted Fixes That Failed

### Fix 1: Client-Side JWT Decoding (App.tsx)

**Attempt:** After `refreshSession()`, decode the JWT access token and extract `words_used_this_month` to sync local cache.

**Code Location:** `src/components/App.tsx` lines 497-537

**Why It Failed:** The JWT itself doesn't contain the quota claims, so there's nothing to decode. The problem is upstream (hook not adding claims).

**Status:** Reverted by user

### Fix 2: Re-running Hook SQL

**Attempt:** Ran the complete `custom_access_token_hook()` SQL with quota logic in Supabase SQL Editor.

**Why It Failed:** User confirmed it made no difference. Either:
- The hook was already correct and the issue is elsewhere
- The hook isn't being invoked by Supabase
- There's a caching issue

**Status:** No effect

## Diagnostic Checklist for Next Session

### Step 1: Verify Hook Is Being Called

```sql
-- Add logging to hook to see if it runs
-- In Supabase SQL Editor, update the hook:
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  has_subscription boolean;
  user_words_used integer;
  user_quota_reset_date timestamptz;
  needs_reset boolean;
begin
  -- LOG: Function entry
  raise log 'HOOK CALLED: user=%', event->>'user_id';
  
  select exists(
    select 1 from public.subscriptions
    where user_id = (event->>'user_id')::uuid
    and status = 'active'
  ) into has_subscription;
  
  raise log 'HOOK: subscription_active=%', has_subscription;
  
  claims := event->'claims';
  claims := jsonb_set(claims, '{subscription_active}', to_jsonb(has_subscription));
  
  if not has_subscription then
    begin
      raise log 'HOOK: FREE USER - fetching quota';
      
      select 
        coalesce(words_used_this_month, 0),
        quota_reset_date
      into user_words_used, user_quota_reset_date
      from public.profiles
      where id = (event->>'user_id')::uuid;
      
      raise log 'HOOK: quota from DB - words=%', user_words_used;
      
      needs_reset := user_quota_reset_date is null or user_quota_reset_date < now();
      
      if needs_reset then
        raise log 'HOOK: RESETTING quota';
        update public.profiles
        set 
          words_used_this_month = 0,
          quota_reset_date = date_trunc('month', now() + interval '1 month')
        where id = (event->>'user_id')::uuid
        returning 
          words_used_this_month,
          quota_reset_date
        into user_words_used, user_quota_reset_date;
      end if;
      
      claims := jsonb_set(claims, '{words_used_this_month}', to_jsonb(user_words_used));
      claims := jsonb_set(claims, '{quota_limit}', to_jsonb(2000));
      claims := jsonb_set(claims, '{quota_reset_date}', to_jsonb(user_quota_reset_date));
      
      raise log 'HOOK: ADDED quota claims - words=%', user_words_used;
      
    exception when others then
      raise warning 'HOOK ERROR: % - SQLERRM: %', sqlstate, sqlerrm;
    end;
  end if;
  
  event := jsonb_set(event, '{claims}', claims);
  raise log 'HOOK: RETURNING event';
  return event;
end;
$$;
```

**Then check logs:**
1. Restart app (triggers refreshSession)
2. Go to Supabase Dashboard → Logs → Postgres Logs
3. Filter for "HOOK"
4. **If you see logs:** Hook is running - check what values it's reading
5. **If you see NO logs:** Hook is NOT being called - registration issue

### Step 2: Decode a Real JWT

In the app DevTools console:

```javascript
// Get current session
const { data: { session } } = await window.supabase.auth.getSession();
const token = session.access_token;

// Decode payload (middle part)
const parts = token.split('.');
const payload = JSON.parse(atob(parts[1]));

// Log full payload
console.log('JWT Payload:', JSON.stringify(payload, null, 2));

// Check for quota claims
console.log('Quota claims:', {
  words_used_this_month: payload.words_used_this_month,
  quota_limit: payload.quota_limit,
  quota_reset_date: payload.quota_reset_date,
  subscription_active: payload.subscription_active
});
```

**Expected:**
- `subscription_active: false` (you're free tier)
- `words_used_this_month: 2735` (from DB)
- `quota_limit: 2000`
- `quota_reset_date: "2025-01-01T00:00:00Z"` (or similar)

**If missing:** Hook isn't adding claims to JWT

### Step 3: Verify User ID Consistency

```sql
-- Check if user ID exists in both tables
SELECT 
  u.id as auth_user_id,
  u.email,
  p.id as profile_id,
  p.words_used_this_month,
  p.quota_reset_date
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.id = 'e5dce022-0596-4324-8cda-3291019f725a'::uuid;
```

**Expected:** Both IDs should match, words_used_this_month should be 2735

**If profile_id is NULL:** Profile row doesn't exist - hook can't read quota

### Step 4: Manual Hook Test

```sql
-- Manually call the hook with test event
SELECT public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', 'e5dce022-0596-4324-8cda-3291019f725a',
    'claims', '{}'::jsonb
  )
);
```

**Expected Output:** JSONB with `claims.words_used_this_month = 2735`

**If error:** Hook has a bug
**If no quota claims:** Hook logic isn't executing properly

### Step 5: Check Hook Registration

1. Supabase Dashboard → Authentication → Hooks
2. Screenshot the "Custom Access Token Hook" section
3. Verify `public.custom_access_token_hook` is selected
4. Try UNSELECTING and RE-SELECTING the hook, then Save
5. Restart app and test again

### Step 6: Force JWT Refresh

In app DevTools console:

```javascript
// Force refresh
const { data, error } = await window.supabase.auth.refreshSession();
console.log('Refresh result:', { data, error });

// Get fresh session
const { data: { session } } = await window.supabase.auth.getSession();
console.log('New token (first 50 chars):', session.access_token.substring(0, 50));

// Decode new token
const payload = JSON.parse(atob(session.access_token.split('.')[1]));
console.log('New payload quota:', payload.words_used_this_month);
```

**Expected:** After refresh, new JWT should have updated quota

**If still 0 or missing:** Hook isn't running on refresh

## Key Learnings

1. **Documentation ≠ Implementation** - PR #176 documented the hook behavior but it's unclear if the SQL was ever executed in production

2. **Multiple Sources of Truth = Chaos** - Having quota in database, JWT claims, and localStorage creates 3 points of failure

3. **JWT Inspection is Critical** - Should have decoded an actual JWT immediately to confirm what claims it contains

4. **Postgres Logs Are Essential** - Can't debug a database function without seeing if/when it runs

5. **Supabase Hook Registration is Opaque** - No clear feedback on whether hooks are actually being invoked

## Architecture Notes

**Current Flow (Intended):**
```
1. App starts → refreshSession()
2. Supabase Auth → Calls custom_access_token_hook()
3. Hook → Reads profiles.words_used_this_month (2735)
4. Hook → Adds to JWT: { words_used_this_month: 2735, quota_limit: 2000 }
5. App → Stores JWT
6. User dictates → App sends JWT to worker
7. Worker → Decodes JWT → Reads words_used_this_month: 2735
8. Worker → Blocks (2735 >= 2000) → close(4021)
```

**Actual Flow (Observed):**
```
1. App starts → refreshSession()
2. Supabase Auth → ??? (hook may not be called)
3. JWT generated with subscription_active but NO quota claims
4. App → Stores JWT
5. User dictates → App sends JWT to worker
6. Worker → Decodes JWT → words_used_this_month: undefined → defaults to 0
7. Worker → Allows (0 < 2000) → ✅ auth.free_tier_allowed
8. User dictates infinitely ❌
```

## Files Referenced

- `worker/src/handlers/ws.ts` (lines 298-335) - JWT quota check
- `worker/src/auth/supabaseJwt.ts` (lines 108-116) - JWT claim extraction
- `src/state/quotaCache.ts` - Local quota cache (not synced with JWT)
- `src/components/App.tsx` (lines 497-510) - JWT refresh on startup
- Database: `custom_access_token_hook()` function
- Database: `profiles.words_used_this_month` column

## Ready for Next Session

- ❌ **Issue unresolved** - Worker still sees wordsUsed: 0
- ✅ **Diagnostic plan created** - 6-step checklist above
- ✅ **User reverted failed changes** - App.tsx back to original
- 🔧 **Next action:** Run diagnostic Step 1 (add logging to hook and check Postgres logs)

## Context for Future

The quota system WRITES correctly (database updates properly), but READS incorrectly (JWT doesn't get quota claims). This is a one-way failure - data flows INTO the database but doesn't flow back OUT via JWT claims. The `custom_access_token_hook()` is either not running, not reading correctly, or not adding claims to the JWT payload. Without seeing actual Postgres logs or decoded JWTs, we can't determine which.

**Critical Next Step:** Decode an actual JWT from the app to see if `words_used_this_month` claim exists. If it doesn't exist, the hook isn't working. If it exists but has the wrong value, the hook is reading wrong data.

**User's Frustration:** Understandable - multiple attempts to fix the hook SQL made no difference, suggesting the problem is not the SQL itself but either hook invocation or JWT claim propagation.
