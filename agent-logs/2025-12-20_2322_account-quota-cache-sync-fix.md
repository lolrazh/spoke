# Account & Quota Cache Sync Fix

**Date:** 2025-12-20 (Updated: 2025-12-22 13:18)  
**Agent:** Claude Opus 4.5 
**Status:** ⚠️ Partial - Quota/tier fixed, identity (email/name) NOT fixed  

## User Intention

User experienced a critical bug where after signing in with a new account (going through onboarding):
1. Settings Panel showed the **old account's data** (name, Pro tier status)
2. Word count was out of sync (showing 56 words locally vs 250-300 words actually dictated)
3. Database was updating correctly - issue was purely client-side cache

Notably, both accounts had the **same display name**, which made the bug more confusing.

## What We Accomplished

- ✅ **Quota/Tier Fix WORKS:** Clear `quotaCache` on ALL sign-out scenarios + sync from JWT on sign-in
- ✅ **TOKEN_REFRESHED handler:** Mid-session upgrades/quota resets now work without restart
- ❌ **Identity Fix FAILED:** Email/name still shows old account data after switching accounts

## What Failed

### Attempted Fix #1: Clear identity cache from App.tsx

Added `clearUserIdentityCache()` and `forceRefreshIdentity()` calls alongside quota cache handling in App.tsx auth listener.

**Why it failed:** 
- `userIdentity.ts` has its **own** `onAuthStateChange` listener
- Both listeners fire on the same event
- Race condition: `userIdentity.ts` re-populates cache before/after App.tsx clears it
- The two listeners fight over the same state

### Attempted Fix #2: Add user ID tracking to userIdentity.ts

Added `prevUserId` tracking to detect user changes in the `userIdentity.ts` SIGNED_IN handler.

**Why it failed:**
- Unknown - the fix was reverted before testing could confirm
- Possibly another race condition or initialization timing issue
- The module-level hydration from localStorage on startup may have interfered

### Attempted Fix #3: Unified Session Module (2025-12-22)

**Approach:** Created a completely new `userSession.ts` module that unified both identity AND quota into a single state with one auth listener.

**Implementation:**
- Created `src/state/userSession.ts` with combined `UserSession` type:
  ```typescript
  type UserSession = {
    userId: string | null;
    name: string | null;
    email: string | null;
    wordsUsed: number;
    isPro: boolean;
    resetDate: string | null;
    limit: number;
  }
  ```
- Single `onAuthStateChange` listener with atomic clear/update:
  - On user change: `clearSession()` clears ALL data before emitting new user
  - Decodes JWT for quota, uses session.user for identity
  - Background fetch for `profile.display_name` upgrade
- Migrated all consumers:
  - SettingsPanel: 2 subscriptions → 1 (`subscribeUserSession`)
  - useTranscription: Updated to use `getUserSession()`, `incrementWordsUsed()`
  - App.tsx: Removed all quota sync logic (~100 lines deleted)
  - supabaseClient: Updated to `clearSession()`, `forceRefreshSession()`

**Why it failed:**
- **Testing revealed it didn't work** - After implementing the full unification, user tested account switching and the bug persisted
- Full implementation was reverted back to separate `userIdentity.ts` + `quotaCache.ts` modules
- **Possible reasons:**
  - Auth listener in `userSession.ts` may not fire before SettingsPanel subscription initializes
  - Module initialization order issue (SettingsPanel mounts before `initUserSession()` completes)
  - Cache hydration from localStorage still happens before auth listener processes new user
  - The unified module was initialized in `App.tsx` but `SettingsPanel` may have subscribed too early
- **Learning:** Unifying the modules alone doesn't solve the timing/coordination issue if the initialization order is wrong

### Attempted Fix #4: User ID Tracking in userIdentity.ts (2025-12-22 13:20)

**Approach:** Mirror the EXACT pattern that fixed quota cache - add `prevUserId` tracking to `userIdentity.ts` and clear cache when user changes.

**Implementation:**
```typescript
// Added at module level
let prevUserId: string | null = null;

// In SIGNED_IN handler
if (event === "SIGNED_IN" && session?.user) {
  const currentUserId = session.user.id;
  
  // Clear cache if user changed (SAME AS QUOTA FIX)
  if (currentUserId !== prevUserId) {
    clearUserIdentityCache();
  }
  
  prevUserId = currentUserId;
  // ... rest of existing logic
}

// In SIGNED_OUT handler
if (event === "SIGNED_OUT") {
  clearUserIdentityCache();
  prevUserId = null;
  return;
}
```

**Why it should have worked:**
- ✅ Exact same pattern as quota cache fix (proven to work for quota)
- ✅ No race conditions (clears in same listener that manages cache)
- ✅ Atomic operation (clear before emit in same event tick)
- ✅ No module coordination issues (single listener)

**Test Results:**
- ✅ **Quota cache STILL works** - Tier (Pro/Free) displays correctly
- ✅ **Word count STILL works** - Synced from JWT correctly
- ❌ **Identity cache STILL BROKEN** - Shows old account name/email

**Critical Discovery:**
```
After account switch:
✅ quota.isPro = NEW USER (correct)
✅ quota.wordsUsed = NEW USER (correct)
❌ identity.name = OLD USER (wrong)
❌ identity.email = OLD USER (wrong)
```

**Why it failed:**
- **UNKNOWN** - The exact same clearing pattern works for quota but NOT for identity
- `clearUserIdentityCache()` is called (same function used on sign-out, which works)
- But somehow identity persists despite clear being called
- Suggests there's a **fundamental difference** in how identity cache behaves vs quota cache

**Possible explanations:**
1. **Emit timing issue:** Identity's `emit()` has change guard that might suppress updates:
   ```typescript
   if (identity.name === sanitized.name && identity.email === sanitized.email) return;
   ```
   If old data lingers after clear, this guard prevents new data from overwriting it.

2. **Cache hydration interference:** Identity module hydrates from localStorage on load (lines 17-32).
   If localStorage isn't actually cleared, hydration re-populates old data before auth fires.

3. **Multiple emit sources:** Identity has TWO places that call `emit()`:
   - Auth listener (immediate emit with session data)
   - `refreshIdentity()` (deferred DB fetch)
   
   If `refreshIdentity()` runs with stale DB data, it could overwrite the correct session data.

4. **SettingsPanel subscription timing:** If SettingsPanel subscribes BEFORE `clearUserIdentityCache()` runs,
   it might lock onto old cached data and never re-render.

**Key Question:**
Why does `clearUserIdentityCache()` work on sign-out but NOT on user change, even though it's the same function called the same way?

**Reverted:** Yes - returned to original code after testing confirmed it didn't work

## Root Cause Analysis (Updated 2025-12-22)

### **CRITICAL INSIGHT: Why Quota Works But Identity Doesn't**

After 4 fix attempts, we've discovered something fundamental:

**The Pattern:**
```typescript
// This WORKS (quota cache):
if (currentUserId !== prevUserId) {
  clearQuotaCache();
}

// This DOESN'T WORK (identity cache):
if (currentUserId !== prevUserId) {
  clearUserIdentityCache(); // ← Called but data persists!
}
```

**The Mystery:**
- Same clearing pattern
- Same timing (auth listener)
- Same isolation (no race conditions)
- Different results

**What This Means:**
There's a **fundamental architectural difference** between how quota and identity caches behave that we haven't identified yet. The problem is NOT:
- ❌ Race conditions (Fix #4 eliminated these)
- ❌ Multiple listeners (Fix #4 used single listener)
- ❌ Module coordination (Fix #4 was self-contained)

The problem IS:
- ❓ Something about how identity cache persists that quota cache doesn't
- ❓ Different initialization/hydration behavior
- ❓ Different emit/subscription timing
- ❓ Different localStorage persistence mechanism

### The Quota Cache Issue (FIXED)

| Cache | localStorage Keys | Cleared on Sign-Out? |
|-------|-------------------|---------------------|
| `quotaCache.ts` | `sf.quotaWordsUsed`, `sf.quotaResetDate`, `sf.isPro` | ❌ **NO!** → Now ✅ YES |

The `clearQuotaCache()` function existed but was never called. Now it's called on all sign-out paths.

### The Identity Cache Issue (NOT FIXED)

| Cache | localStorage Keys | Problem |
|-------|-------------------|---------|
| `userIdentity.ts` | `sf.userName`, `sf.userEmail` | Has its own auth listener that fights with App.tsx |

The `userIdentity.ts` module:
1. Hydrates from localStorage on module load (before auth fires)
2. Has its own `onAuthStateChange` listener
3. Immediately emits identity from session on SIGNED_IN

**The fundamental problem:** Two separate auth listeners managing overlapping state without coordination.

## Technical Implementation (Quota Only)

```typescript
// In App.tsx onAuthStateChange:

// 1. On SIGNED_IN - clear quota if user changed, ALWAYS sync from JWT
if (event === "SIGNED_IN" && session?.user) {
  if (currentUserId !== prevUserIdRef.current) {
    clearQuotaCache();
  }
  setTimeout(() => {
    updateQuotaFromServer({
      wordsUsed: payload.words_used_this_month,
      isPro: payload.subscription_active === true,
    });
  }, 0);
}

// 2. On TOKEN_REFRESHED - sync quota for mid-session changes
if (event === "TOKEN_REFRESHED" && session?.access_token) {
  setTimeout(() => updateQuotaFromServer({ ... }), 0);
}

// 3. On SIGNED_OUT - clear quota cache
if (!session?.user) {
  clearQuotaCache();
}

// 4. On polling-detected sign-out - clear quota cache
clearQuotaCache();
```

## Files Modified

- `src/components/App.tsx`:
  - Added import for `clearQuotaCache` and `updateQuotaFromServer`
  - Added quota cache clearing on sign-out (auth listener + polling)
  - Added quota sync on SIGNED_IN (always, not just user change)
  - Added TOKEN_REFRESHED handler for mid-session subscription/quota changes

## What Needs To Be Done (Updated 2025-12-22)

### Priority 1: Investigate Why clearUserIdentityCache() Doesn't Work

**The smoking gun:** `clearUserIdentityCache()` is called but identity data persists.

**Debug steps:**
1. **Add comprehensive logging to clearUserIdentityCache():**
   ```typescript
   export function clearUserIdentityCache() {
     console.log("[UserIdentity] clearUserIdentityCache() CALLED");
     console.log("[UserIdentity] Before clear:", { name: identity.name, email: identity.email });
     
     identity = { name: null, email: null };
     
     console.log("[UserIdentity] After clear:", { name: identity.name, email: identity.email });
     console.log("[UserIdentity] localStorage before:", {
       name: localStorage.getItem(CACHE_KEY_NAME),
       email: localStorage.getItem(CACHE_KEY_EMAIL)
     });
     
     localStorage.removeItem(CACHE_KEY_NAME);
     localStorage.removeItem(CACHE_KEY_EMAIL);
     
     console.log("[UserIdentity] localStorage after:", {
       name: localStorage.getItem(CACHE_KEY_NAME),
       email: localStorage.getItem(CACHE_KEY_EMAIL)
     });
     
     // Notify listeners
     for (const listener of listeners) {
       console.log("[UserIdentity] Notifying listener with cleared state");
       listener(identity);
     }
   }
   ```

2. **Log SettingsPanel subscription:**
   ```typescript
   // In SettingsPanel
   useEffect(() => {
     console.log("[SettingsPanel] Subscribing to userIdentity");
     const unsubscribe = subscribeUserIdentity((id) => {
       console.log("[SettingsPanel] Received identity update:", id);
       setUserName(id.name);
       setUserEmail(id.email);
     });
     return unsubscribe;
   }, []);
   ```

3. **Track emit() calls after clear:**
   - Does `emit()` get called after clear?
   - What values does it emit?
   - Is the change guard suppressing updates?

### Priority 2: Compare Quota vs Identity Cache Mechanisms

**Side-by-side comparison needed:**

| Aspect | Quota Cache | Identity Cache |
|--------|-------------|----------------|
| Clear function | `clearQuotaCache()` | `clearUserIdentityCache()` |
| Hydration | Lines 59-84 | Lines 18-32 |
| Emit guard | None | Lines 39-40 (change guard) |
| Update sources | 1 (App.tsx auth listener) | 2 (auth listener + refreshIdentity) |
| Subscription timing | After init | Conditional on `initialized` |

**Key differences to investigate:**
- Identity has change guard in `emit()` - could this suppress updates after clear?
- Identity has deferred `refreshIdentity()` - could this overwrite cleared data?
- Identity has `initialized` flag in subscription - does this affect timing?

### Option A: Force Emit on Clear (Bypass Change Guard)

**Theory:** The change guard in `emit()` might prevent cleared state from propagating.

**Fix:**
Create a single "auth-derived state" module that owns:
- User ID
- Identity (name, email) 
- Quota/subscription

One listener, one place for cache management.

### Option B: Make userIdentity.ts Self-Aware (Targeted)
Add proper user ID tracking so it detects account switches internally:
- Track previous user ID
- Clear cache when user changes
- Handle the initialization timing issue (localStorage hydration vs. auth events)

### Option C: Investigate SettingsPanel State
Check if SettingsPanel is properly subscribing to identity changes or if there's a stale closure issue.

## Key Learnings (Updated 2025-12-22)

- **Two auth listeners is a footgun** - Race conditions are inevitable without explicit coordination
- **Cache hydration timing matters** - Module-level hydration from localStorage runs before auth events
- **Test account switching** - This flow exposes coordination issues that single-account testing misses
- **Debugging requires renderer console** - The logs we saw were main process; renderer logs would show the actual identity updates
- **Identical patterns ≠ identical results** - The same clearing pattern that works for quota fails for identity, suggesting fundamental architectural difference
- **Need comprehensive logging** - Can't debug what we can't see - need to instrument clearUserIdentityCache() and emit() to understand what's happening
- **Four fixing attempts, zero success** - Coordination fixes, unification, mirroring proven patterns all failed - suggests we're missing something fundamental about how identity cache works

## Test Results

| Feature | Before | After |
|---------|--------|-------|
| Tier (Pro/Free) display | ❌ Old account's tier | ✅ Correct tier |
| Word count | ❌ Out of sync | ✅ Synced from JWT |
| Email display | ❌ Old account | ❌ Still old account |
| Name display | ❌ Old account | ❌ Still old account |

## Related Files

- `src/state/quotaCache.ts` - Quota cache module (fixed)
- `src/state/userIdentity.ts` - User identity cache module (needs work)
- `src/components/SettingsPanel.tsx` - Subscribes to both caches
- `agent-logs/2025-12-04_1200_settings-panel-auth-race-fix.md` - Previous identity fix attempt
