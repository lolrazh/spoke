# Free Tier Implementation (Local-First Quota)

## 📝 Quick Summary

**Storage:** localStorage (same pattern as `userIdentity.ts`)
**Sync Frequency:** Every 5 dictations OR every 5 minutes (whichever comes first)
**Tamper Protection:** JWT validates on startup (server wins)
**Worker Complexity:** ~5 lines (just read JWT claim and compare)

**Key Insight:** Local cache for instant progress bar updates + periodic sync for efficiency + JWT gate for security = Best of all worlds ✅

---

## 🎫 ELI5: The Nightclub Analogy

Imagine your app is like a **nightclub** with a bouncer at the door.

### **Current System (Pro Tier - Working)**

**The Wristband System:**
1. **Before you leave home** (app startup): You get a **wristband** (JWT) from the ticket office (Supabase)
2. **Wristband has a sticker** on it that says "PRO" or "FREE" (`subscription_active` claim)
3. **At the door** (WebSocket auth): Bouncer (Worker) looks at your wristband - takes 1 millisecond
4. **If sticker says "PRO"**: You walk right in, no questions
5. **If sticker says "FREE"**: Bouncer stops you immediately (4020 error)

**Why it's fast:** Bouncer just **reads your wristband** (JWT claim). No phone calls to headquarters (database).

---

### **New System (Free Tier with Quota)**

**The Punch Card System:**
1. **Before you leave home** (app startup): Wristband ALSO has a **punch card** printed on it
   - "You've used 1,200 out of 2,000 words this month"
2. **At the door** (WebSocket auth): Bouncer reads wristband in 1 millisecond:
   - Sticker says "FREE" ✅
   - Punch card says "1,200 / 2,000" ✅
   - **Bouncer thinks:** "1,200 < 2,000, you're good to go!"
   - You walk in immediately
3. **Inside the club** (transcription happens): You order drinks, have fun
4. **When you leave** (after transcription): Bartender sends a text to headquarters saying "User had 5 drinks tonight, update their card"
   - This happens AFTER you already left (fire-and-forget)
   - Doesn't slow you down at all

**Why PR 175 was slow:**
- **Old way:** Bouncer would let you in, but then CALL HEADQUARTERS on the phone BEFORE getting your first drink
- You'd stand there awkwardly waiting 50ms while bouncer is on hold
- Your first words got cut off because bartender was still waiting for approval

**New way:**
- Bouncer checks your pre-printed punch card (JWT claim) at the door - instant
- You get drinks immediately
- Headquarters updates your card later, in the background

---

## 🔄 How Sync Works

**Database (Source of Truth):**
- Gets updated after EVERY dictation (async write, fire-and-forget)
- Always has the latest count

**JWT (Cached Copy):**
- Updated on app startup (when you call `refreshSession()`)
- Auto-refreshes every ~55 minutes (Supabase default)
- Reads from database when refreshing

**Worker (Quota Checker):**
- Only reads JWT claims (never queries database)
- Sees whatever the JWT says

**Example Timeline:**
```
App Start:     JWT says 1800 words (reads from DB)
Dictation 1:   Worker sees 1800 → allows → DB writes 1850 ✅
Dictation 2:   Worker sees 1800 → allows → DB writes 1900 ✅
Dictation 3:   Worker sees 1800 → allows → DB writes 2050 ✅ (over limit!)
(55 min later or app restart)
JWT Refresh:   JWT now says 2050 (reads from DB)
Dictation 4:   Worker sees 2050 → blocks ❌
```

**Lag Window:** Between JWT refreshes (~1 hour), user can go over limit by ~200-300 words. This is acceptable.

---

## 📊 When Reads & Writes Happen

### **Reads (Fast - JWT Claims)**

| Event | What Gets Read | Where | Speed |
|-------|---------------|-------|-------|
| **App starts** | `refreshSession()` → New JWT issued | Supabase Custom Hook queries DB | 100-300ms (one time) |
| **Every dictation** | Read JWT claims | Worker RAM | 1ms ✅ |

### **Writes (Async - Fire & Forget)**

| Event | What Gets Written | When | Blocking? |
|-------|------------------|------|-----------|
| **After transcription** | Increment `words_used_this_month` in profiles table | After text sent to user | No ❌ |
| **Monthly reset** | Reset counter to 0 + update reset date | Next JWT refresh after month ends | No ❌ |

---

## 🎯 Key Points

**Pro Tier (Already Working):**
- JWT has `subscription_active: true`
- Worker lets you in immediately
- No quota checks, no DB writes for quota
- Simple!

**Free Tier (What We're Building):**
- JWT has `subscription_active: false` + `words_used_this_month: 1800` + `quota_limit: 2000`
- Worker checks quota from JWT at auth time (instant)
- If under limit: transcribe immediately
- After transcription: update DB in background (user doesn't wait)
- If over limit: block at auth time (before WebSocket connection even fully opens)

**Trade-off:**
- User might go 200-300 words over limit between JWT refreshes
- Cost: $0.001 - $0.003 (negligible)
- Benefit: Zero latency, simple architecture, same pattern as Pro tier

---

## 🏗️ Architecture: Local-First with Periodic Sync

**Pattern:** Same as `userIdentity.ts` (localStorage cache + subscriber pattern)

### **Local Cache (localStorage)**
```typescript
Keys:
- sf.quotaWordsUsed: number
- sf.quotaResetDate: string (ISO timestamp)
- sf.quotaLastSynced: string (ISO timestamp)

Lifecycle:
1. Hydrate on startup (instant load)
2. Update immediately after each dictation (reactive UI)
3. Sync to server periodically (efficient)
4. Validate against JWT on app restart (tamper protection)
```

### **Sync Strategy: Every 5 Dictations OR Every 5 Minutes**

```typescript
Sync triggers (whichever comes first):
✅ Every 5 dictations (counter-based: count % 5 === 0)
✅ Every 5 minutes while app is running (timer-based)
✅ On app blur/close (ensure persistence)
✅ Immediately when quota limit reached (then stop syncing)

After limit hit:
❌ Stop syncing (no point, user is blocked)
✅ One final sync when limit reached
✅ Resume syncing next month after reset
```

**Why this frequency?**
- **DB load:** 1000 users × 20 dictations/day ÷ 5 = 4000 writes/day = 0.05 writes/sec ✅
- **Supabase limit:** Free tier 500 RPM, we'd use 0.003% ✅
- **UX:** Progress bar updates every ~5 dictations = reasonable freshness ✅
- **Resilience:** 5-min timer ensures sync even if user pauses dictating ✅
- **Simplicity:** `if (count % 5 === 0) sync()` ✅

### **Tamper Protection**
```typescript
On app startup:
1. refreshSession() → JWT has server quota (1800 words)
2. localStorage has local quota (100 words - user tampered!)
3. If mismatch: Server wins, overwrite localStorage
4. Progress bar shows: "1800/2000" ✅

On dictation start:
- Worker validates JWT quota at auth time (double gate)
- Even if user bypasses app, Worker blocks them
```

---

## 📋 Implementation Checklist

### **Milestone 1: Database Schema** ✅ (Already Done)
- [x] `profiles` table has `words_used_this_month` column
- [x] `profiles` table has `quota_reset_date` column

### **Milestone 2: Quota Cache Module**
- [ ] Create `src/state/quotaCache.ts` (same pattern as `userIdentity.ts`):
  - [ ] localStorage keys: `sf.quotaWordsUsed`, `sf.quotaResetDate`, `sf.quotaLastSynced`
  - [ ] Hydrate cache on startup (instant load)
  - [ ] Subscriber pattern for reactive updates
  - [ ] `incrementQuotaLocal(wordCount)` - update cache immediately
  - [ ] `syncQuotaToServer()` - batch sync to Supabase
  - [ ] `clearQuotaCache()` - called on sign-out
  - [ ] Offline-aware (check `navigator.onLine`)
- [ ] Test: Update cache, verify localStorage updates and subscribers notified

### **Milestone 3: Supabase Custom Access Token Hook**
- [ ] Update `custom_access_token_hook` Postgres function to:
  - [ ] Check if user has active subscription
  - [ ] For free users: read `words_used_this_month` and `quota_reset_date`
  - [ ] Implement lazy monthly reset (if reset_date < now, reset counter)
  - [ ] Add JWT claims: `subscription_active`, `words_used_this_month`, `quota_limit`
- [ ] Test: Sign in as free user, decode JWT, verify claims are present

### **Milestone 4: Worker JWT Verification**
- [ ] Update `worker/src/auth/supabaseJwt.ts`:
  - [ ] Extract `words_used_this_month` claim from JWT payload
  - [ ] Extract `quota_limit` claim from JWT payload
  - [ ] Add to return type: `wordsUsedThisMonth?: number, quotaLimit?: number`
- [ ] Test: Worker logs should show quota values during auth

### **Milestone 5: Worker WebSocket Auth Handler**
- [ ] Update `worker/src/handlers/ws.ts` auth section (lines ~297-316):
  - [ ] For free users (no subscription): check if `wordsUsed >= quotaLimit`
  - [ ] If over limit: send `auth_error` with code 4021 and close immediately
  - [ ] If under limit: allow connection, store `session.isFreeUser = true`
  - [ ] Remove old blocking logic from PR 175 (the check after transcription)
- [ ] Test: Free user with quota exceeded should get blocked at auth time

### **Milestone 6: Async Quota Increment (Server Sync)**
- [ ] Create SQL function `increment_quota_simple(user_id, word_count)`:
  - [ ] Simple UPDATE to increment `words_used_this_month`
  - [ ] No checking, no locking, just increment
- [ ] Update `worker/src/handlers/ws.ts` after transcription completes:
  - [ ] Count words in final text
  - [ ] For free users: call `c.executionCtx.waitUntil()` to increment quota
  - [ ] Fire-and-forget (don't await, don't block)
  - [ ] Log increment with trace ID for debugging
- [ ] Test: Check Supabase profiles table, verify counter increments after dictations

### **Milestone 7: App Integration**
- [ ] Update `src/hooks/useTranscription.ts`:
  - [ ] Import `incrementQuotaLocal` and `syncQuotaToServer`
  - [ ] After transcription success: call `incrementQuotaLocal(wordCount)`
  - [ ] Implement sync logic: every 5 dictations OR every 5 minutes
  - [ ] Stop syncing after quota limit reached
  - [ ] Verify 4021 error handling (already in PR 175)
- [ ] Update `src/components/App.tsx`:
  - [ ] On startup: hydrate quota cache from localStorage
  - [ ] After JWT refresh: validate cache against JWT claims
  - [ ] On blur/close: trigger final sync
- [ ] Test: Dictate, verify cache updates immediately, sync happens after 5 dictations

### **Milestone 8: Progress Bar UI**
- [ ] Create progress bar component (Settings panel or floating indicator):
  - [ ] Subscribe to quota cache updates
  - [ ] Show: "1,234 / 2,000 words this month"
  - [ ] Visual indicator: progress bar or circular progress
  - [ ] Upgrade button when approaching/at limit
- [ ] Test: Dictate, verify progress bar updates in real-time

### **Milestone 9: End-to-End Testing**
- [ ] **Test Case 1: Pro User**
  - [ ] Sign in as Pro user
  - [ ] Dictate 10 times
  - [ ] Verify: No quota checks, all succeed
  - [ ] Verify: No DB writes to `words_used_this_month`

- [ ] **Test Case 2: Free User Under Limit**
  - [ ] Create test user with 1800 words used
  - [ ] Restart app to get fresh JWT
  - [ ] Dictate 50 words
  - [ ] Verify: Auth succeeds, transcription works
  - [ ] Verify: DB shows 1850 words after dictation

- [ ] **Test Case 3: Free User At Limit**
  - [ ] Set test user to 2000 words used
  - [ ] Restart app to get fresh JWT
  - [ ] Try to dictate
  - [ ] Verify: Blocked at auth time (4021 error)
  - [ ] Verify: Error message shown in UI

- [ ] **Test Case 4: Free User Goes Over (Lag Window)**
  - [ ] Set test user to 1950 words used
  - [ ] Restart app to get fresh JWT with 1950
  - [ ] Dictate 100 words (DB now shows 2050)
  - [ ] Without restarting, dictate again
  - [ ] Verify: Second dictation succeeds (JWT still says 1950)
  - [ ] Restart app
  - [ ] Try to dictate
  - [ ] Verify: Now blocked (JWT refreshed, sees 2050)

- [ ] **Test Case 5: Monthly Reset**
  - [ ] Set test user to 2000 words used, reset_date to last month
  - [ ] Restart app to trigger JWT refresh
  - [ ] Verify: Custom Hook resets counter to 0
  - [ ] Try to dictate
  - [ ] Verify: Works (counter was reset)

### **Milestone 9: Cleanup & Documentation**
- [ ] Delete or archive `FREE_TIER.md` (old plan with DB query approach)
- [ ] Close PR 175 (won't be using this approach)
- [ ] Update `docs/DATABASE.md` with new quota system explanation
- [ ] Add comment in `worker/src/handlers/ws.ts` explaining JWT-based quota check
- [ ] Commit with message: "feat: implement JWT-based free tier quota (zero latency)"

---

## 🚀 Deployment Order

1. Deploy Custom Access Token Hook to Supabase (SQL Editor)
2. Deploy Worker with new auth logic
3. Deploy App with error handling (already in PR 175)
4. Test with real users
5. Monitor logs for any issues

---

## 🐛 Known Edge Cases

1. **User goes slightly over limit**: Acceptable, cost is negligible
2. **Increment fails silently**: User still got transcription, will sync on next success
3. **JWT doesn't refresh**: User can manually restart app to force refresh
4. **Monthly reset timing**: Happens lazily on first JWT refresh of new month

---

## 📚 Related Files

- `src/state/quotaCache.ts` - **NEW** - Local quota cache (same pattern as `userIdentity.ts`)
- `src/state/userIdentity.ts` - **REFERENCE** - Existing cache pattern to follow
- `worker/src/auth/supabaseJwt.ts` - JWT verification
- `worker/src/handlers/ws.ts` - WebSocket auth and quota check
- `src/hooks/useTranscription.ts` - Quota increment and sync logic
- `src/components/App.tsx` - JWT refresh and cache validation on startup
- Supabase: `public.custom_access_token_hook()` function

---

## ❓ FAQ: Answers to Architecture Questions

### **Q1: Where do we store quota locally?**
**A:** localStorage with keys `sf.quotaWordsUsed`, `sf.quotaResetDate`, `sf.quotaLastSynced`

Same pattern as existing `userIdentity.ts`:
- ✅ Already using localStorage (not electron-store package)
- ✅ Keys follow convention: `sf.*`
- ✅ Subscriber pattern for reactive updates
- ✅ Offline-aware with `navigator.onLine` checks

### **Q2: What's the sync frequency? How did we decide?**
**A:** Every 5 dictations OR every 5 minutes (whichever comes first) + on app blur/close

**Decision factors:**
1. **DB load at scale:** 1000 users × 20 dictations/day ÷ 5 = 4000 writes/day = 0.05 writes/sec ✅ Trivial
2. **Supabase limits:** Free tier 500 RPM, we'd use 0.003% ✅ Plenty of headroom
3. **UX freshness:** Progress bar updates every ~5 dictations = reasonable ✅
4. **Resilience:** 5-min timer catches pauses between dictations ✅
5. **Simplicity:** `if (count % 5 === 0) sync()` ✅ Easy to implement

**Why NOT every dictation?**
- ❌ 200k writes/day at scale (overkill)
- ❌ Adds network latency to transcription flow
- ❌ Defeats the JWT optimization purpose

**Why NOT only on app close?**
- ❌ Data loss if app crashes
- ❌ No sync during long sessions

**After quota limit hit:**
- Stop syncing (no point, user is blocked)
- One final sync when limit reached
- Resume next month after reset

### **Q3: How does tamper protection work?**
**A:** JWT validation on app startup (server always wins)

**Defense layers:**
```typescript
Layer 1 (App Startup):
- refreshSession() → JWT says 1800 words (server truth)
- localStorage says 100 words (user tampered)
- If mismatch → Overwrite localStorage with JWT value
- User sees: "1800/2000" ✅

Layer 2 (Every Dictation):
- Worker checks JWT quota at auth time
- Even if user bypasses app, Worker gate blocks
- Close code 4021 if over limit ✅

Layer 3 (Logging):
- Sync failures logged to Sentry
- Can detect tampering patterns ✅
```

**Result:** User can't cheat the system. Even if they edit localStorage to show 0 words, Worker will block them because JWT (which they can't edit) says 2000 words.

### **Q4: How complex is Worker validation?**
**A:** Minimal - just 5 lines of code (same pattern as subscription check)

```typescript
// In ws.ts auth handler (already doing this for subscription!)
if (!jwtResult.subscriptionActive) {
  const wordsUsed = jwtResult.wordsUsedThisMonth || 0;
  const quotaLimit = jwtResult.quotaLimit || 2000;

  if (wordsUsed >= quotaLimit) {
    safeClose(server, WS_CLOSE_CODES.QUOTA_EXCEEDED, 'quota exceeded');
    return;
  }
}
// Done! ✅
```

**Complexity breakdown:**
- ✅ Read JWT claim (already doing for subscription)
- ✅ Compare numbers: `wordsUsed >= quotaLimit`
- ✅ Close connection if over limit
- ✅ That's it!

**The app handles all complex stuff:**
- Local cache management
- Sync scheduling
- Progress bar updates
- Offline resilience

**Worker just enforces the gate** (simple bouncer job)
