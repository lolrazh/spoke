# Offline Auth Cache Guard

**Date:** 2025-10-08  
**Agent:** Codex (GPT-5)  
**Status:** ✅ Completed  

## User Intention
The user wanted the desktop app to keep the signed-in state and cached profile details available even when the machine launches offline, instead of forcing them back through onboarding every time the network is down.

## What We Accomplished
- ✅ **Preserved cached identity offline** - Added an offline guard in `refreshIdentity()` so cached name/email stay intact when Supabase cannot be reached.
- ✅ **Made auth lookup offline-friendly** - Updated `getCurrentUser()` to rely on the locally persisted session first and avoid network calls while offline.
- ✅ **Verified Settings fallback** - Ensured SettingsPanel now hydrates from cache in both dev and prod builds when launching without connectivity.

## Technical Implementation
`refreshIdentity()` now short-circuits when `navigator.onLine` is false, while still clearing identity when Supabase explicitly returns no user. `getCurrentUser()` pulls from `auth.getSession()` before attempting `auth.getUser()`, only reaching out when online and logging failures instead of treating them as sign-outs.

**Files Modified:**
- `src/state/userIdentity.ts` - Added offline guard and refined refresh logic to only clear on confirmed sign-out.
- `src/lib/supabaseClient.ts` - Introduced local session-first lookup and offline-aware fallback for current user retrieval.

## Bugs & Issues Encountered
1. **Offline refresh cleared identity** - `refreshIdentity()` always set `{ name: null, email: null }` when Supabase calls failed.  
   - **Fix:** Added offline short-circuit and only clear when Supabase returns `null` user.
2. **getCurrentUser() forced network** - The helper went straight to `auth.getUser()`, which fails offline and triggered the Settings sign-out flow.  
   - **Fix:** Reordered lookups to check the cached session first, and bail when offline.

## Key Learnings
- **Supabase auth helpers** will throw/return errors when offline unless you rely on the locally persisted session; leverage `getSession()` before `getUser()`.
- **Identity cache flows** should react differently to “no session” vs “network failure” to avoid flashing onboarding.
- **navigator.onLine guard** is an inexpensive way to protect offline boot paths when network calls are optional.

## Architecture Decisions
- **Session-first auth checks** - Prioritized local session data to keep offline UX stable, accepting that the identity might be slightly stale until the network returns.
- **Selective cache clearing** - Only wipe the identity cache on explicit sign-out to balance correctness with offline resilience.

## Ready for Next Session
- ✅ **Offline cache verified** - Future work can assume cached identity remains across offline boots.
- 🔧 **Optional telemetry update** - Consider logging offline launches to understand how often users rely on cached identity.

## Context for Future
These changes ensure the pill UI and Settings remain populated while offline, letting future transcription, notification, or onboarding improvements layer on without reintroducing forced sign-ins during network blips.

