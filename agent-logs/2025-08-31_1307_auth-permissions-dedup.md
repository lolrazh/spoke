# Auth + Permissions Dedup and Polling Fixes

**Date:** 2025-08-31  
**Agent:** OpenAI Assistant (Codex CLI)  
**Status:** ✅ Completed  

## User Intention
The user wants a predictable, low-friction auth experience across sessions: sign-out must hide the pill and block dictation, sign-in should skip onboarding when already completed, and onboarding should be seamless (including Enter-to-submit for email). They also want the implementation to be robust (no false sign-outs on network blips) and maintainable by removing duplication (shared permissions logic) while postponing backend JWT enforcement.

## What We Accomplished
- ✅ **Removed local `signedIn` persistence** — Eliminated `auth:set-signed-in` and the `signedIn` flag, relying solely on Supabase session + `profiles.onboarding_done`.
- ✅ **Fixed auth polling logic** — Poll distinguishes network errors from true sign-outs to avoid kicking users during blips.
- ✅ **Deduplicated permissions logic** — Introduced `usePermissions` hook and refactored Onboarding and Settings to use it.
- ✅ **Returning user skip** — Ensured `profiles` row creation and immediate onboarding skip when `onboarding_done` is true.
- ✅ **Enter-to-submit email** — Pressing Enter on the email field triggers OTP send.
- ✅ **Docs updated** — `docs/AUTH.md` documents returning-user short-circuit and `ensureProfileRow()`; removed `auth:set-signed-in` from IPC list.
- ✅ (From earlier same session) **Renderer-ready scoping** — Onboarding no longer resurrects the pill; dictation gated by auth.

## Technical Implementation
- Centralized permission actions with a shared React hook `usePermissions` managing:
  - Initial checks via `checkPermissions`/`checkMicrophonePermission`
  - Request flows for microphone, accessibility, and input monitoring
  - Polling and one-time deep-link to System Settings with grace period
  - UI flags (`loading`, `justGranted`) and permission state
- Onboarding
  - Calls `ensureProfileRow()` after login and short-circuits onboarding when `onboarding_done` is true.
  - Uses `usePermissions` for all permission actions and displays.
  - Enter-to-submit email via `<form onSubmit>`.
- Settings Panel
  - Uses `usePermissions` to remove duplicated permission request logic.
- Main Process
  - Removed `auth:set-signed-in` handler and `signedIn` from `onboarding.json` structure.
- App Polling
  - Uses `supabase.auth.getUser()` and only signs out when `!error && !data.user`.

**Files Modified:**
- `src/main.ts` — Removed `signedIn` persistence and handler; kept onboarding `done`.
- `src/components/App.tsx` — Fixed 60s auth poll to ignore network errors.
- `src/components/Onboarding.tsx` — Added returning-user short-circuit; Enter submit; refactored to `usePermissions`.
- `src/components/SettingsPanel.tsx` — Refactored permissions to `usePermissions`.
- `src/hooks/usePermissions.ts` — New shared hook for permission checks/requests.
- `docs/AUTH.md` — Added returning-user logic; documented `ensureProfileRow()`; removed `auth:set-signed-in` from IPC.
- `agent-logs/` — This log; previous session: 2025-08-31_1224_auth-onboarding-fixes.md.

## Bugs & Issues Encountered
1. **Network blips treated as sign-out** — Polling via `getCurrentUser()` masked errors.
   - **Fix:** Use `supabase.auth.getUser()`, sign out only when no error and no user.
2. **Repeated onboarding for returning users** — Missing `profiles` row led to unknown onboarding state.
   - **Fix:** `ensureProfileRow()` + short-circuit when `onboarding_done` is true.
3. **Duplicated permission logic** — Onboarding and Settings drifted.
   - **Fix:** `usePermissions` hook consolidates checks, requests, polling, and UI flags.

## Key Learnings
- **Client session vs. network errors:** Supabase’s `getUser()` provides error separation necessary to avoid false sign-outs.
- **Cross-device onboarding state:** A DB-backed flag (`profiles.onboarding_done`) is the right source of truth; local flags are only optimizations.
- **DRY permission flows:** Centralizing permission logic reduces UX drift and fixes bugs once for all surfaces.

## Architecture Decisions
- **Remove local `signedIn` state:** Avoid dual sources of truth; rely on Supabase session + DB profile.
- **Introduce `usePermissions` hook:** Shared logic for permission UX; supports mock provider in Onboarding.
- **Defer backend JWT enforcement:** Keep Worker open for now; enforce auth on client until server-side gating is prioritized.

## Ready for Next Session
- ✅ **Auth/onboarding flow stable** — Pill visibility, PTT routing, and dictation gating aligned.
- 🔧 **Optional: debounce sign-out transitions** — Add a brief guard to avoid duplicate UX if `onAuthStateChange` and the poll fire together.
- 🔧 **Optional: identity linking** — To unify Google and magic-link identities for the same email.
- 🔧 **JWT-gated Worker** — Add Authorization header + verification in WS handshake when ready.

## Context for Future
This session completes the UX cleanup, eliminates duplication, and documents the flow. Building on 2025-08-31_1224_auth-onboarding-fixes.md, the app now consistently handles auth state across outages and devices, and is ready for server-side JWT enforcement when prioritized.
