# Auth/Onboarding Flow Fixes

**Date:** 2025-08-31  
**Agent:** OpenAI Assistant (Codex CLI)  
**Status:** ✅ Completed  

## User Intention
User wanted a coherent, predictable auth and onboarding experience: signing out should hide the pill and disable dictation; signing in should bypass onboarding if already completed and make the pill immediately usable. They also wanted frictionless login UX (pressing Enter submits email) and clarity around provider/account behavior without adding backend JWT enforcement yet.

## What We Accomplished
- ✅ **Stopped pill from reappearing during onboarding** — Scoped `renderer-ready` handling to the sender window so onboarding no longer resurrects the pill.
- ✅ **Blocked dictation when signed out** — Added an auth gate before any `trans.start()` and routed to onboarding with a notification if not signed in.
- ✅ **Clean sign-out UX** — Explicitly hide the floating bar, cancel active recording, and route PTT to onboarding on sign-out or session loss.
- ✅ **Light session polling** — Added 60s check to catch server-side deletions or expired sessions and force the sign-out UX.
- ✅ **Skip onboarding for returning users** — Ensured a `profiles` row exists on login and bypassed onboarding immediately if `onboarding_done` is true.
- ✅ **Enter-to-submit email** — Pressing Enter in the onboarding email field now triggers the OTP flow.
- ⚠️ **Deferred backend auth (JWT)** — We intentionally postponed WS JWT verification; planned as a later phase.

## Technical Implementation
- Electron main now shows/hides windows based on the actual sender of `renderer-ready`, preventing onboarding from showing the pill.
- Renderer `App.tsx` injects an auth check before mic permission gating; on sign-out or null session, it cancels transcription and hides the pill.
- Settings sign-out also hides the pill before showing onboarding.
- Added `ensureProfileRow()` to create a `profiles` row after login; onboarding checks `onboarding_done` to close immediately for returning users.
- Onboarding email form wrapped in `<form>` with `onSubmit` to support Enter.

**Files Modified:**
- `src/main.ts` — Scoped `renderer-ready` to sender window; no pill show on onboarding ready.
- `src/components/App.tsx` — Auth+mic gate before dictation; cancel & hide on sign-out; added 60s auth poll.
- `src/components/SettingsPanel.tsx` — Hide floating bar on sign-out prior to showing onboarding.
- `src/lib/supabaseClient.ts` — Added `ensureProfileRow()`; existing helpers intact.
- `src/components/Onboarding.tsx` — Call `ensureProfileRow()` on mount and after auth callback; skip onboarding if done; added Enter-to-submit for email.

## Bugs & Issues Encountered
1. **Pill resurrects after sign-out** — Onboarding renderer triggered global `renderer-ready` which always showed the pill.
   - **Fix:** Bound `renderer-ready` to the sender; only the pill window can show the pill.
2. **Can still dictate via click after sign-out** — Worker endpoint is open; clicks called `trans.start()` without auth gating.
   - **Fix:** Added auth gate in renderer; show onboarding and block start when signed out.
3. **Returning users forced through onboarding** — Missing/unknown `profiles` row meant `onboarding_done` couldn’t be checked.
   - **Fix:** `ensureProfileRow()` on login; immediately close onboarding if `onboarding_done` is true.
4. **Email Enter key didn’t submit** — Email field wasn’t in a form; no submit handler.
   - **Fix:** Wrapped in `<form onSubmit>` and used `type="submit"`.

## Key Learnings
- **Supabase client sessions persist locally**, but server awareness (e.g., deleted users) needs polling or push until JWT gating is in place.
- **Identity ≠ email** in Supabase: different providers create different user IDs unless explicitly linked.
- **Electron IPC needs sender scoping** for global events; otherwise unrelated windows can trigger unintended UI changes.
- **UI must enforce auth intent** even if the backend is open; guard all entry points (`Fn` and click).

## Architecture Decisions
- **Postpone JWT WS enforcement** — Keep the Worker open for now; add client-side gating and polling for UX correctness first.
- **Use profile flag (`onboarding_done`)** — DB is the source of truth across devices; local `onboarding.json` remains as a fast local skip.
- **Light polling over push for now** — 60s check is sufficient; push/broadcast can be added later.

## Ready for Next Session
- ✅ **Renderer/main auth flow stabilized** — Pill/show logic and dictation gating are coherent.
- 🔧 **JWT-gate Worker** — Verify Supabase token on WS handshake; surface 401 to client.
- 🔧 **Identity linking** — Optional: link Google to magic-link/email to keep one user ID.
- 🔧 **Realtime sign-out** — Optional: add Supabase webhook + broadcast to instantly kick clients.

## Context for Future
This session aligned the desktop UX with clear auth intent, removing confusing edge cases around sign-out/sign-in. It sets the stage to add server-side JWT enforcement and optional realtime logout without changing the user-facing flow.
