# macOS Signing + Notarization cleanup; Email Auth sanity

**Date:** 2025-09-11  
**Agent:** Codex CLI (OpenAI)  
**Status:** ⚠️ Partial  

## User Intention
Ensure the macOS app and its native helper are signed with the same Developer ID identity, let the top-level app be notarized (not the helper), and remove dev signing fallbacks so Gatekeeper accepts releases. Also validate whether signing changes could impact the email-based auth flow and capture learnings for continuity.

## What We Accomplished
- ✅ **Unified signing flow** — Removed helper pre-signing and configured Forge to sign the nested helper with the same identity and entitlements as the main app.
- ✅ **No dev fallback** — Eliminated Apple Development fallback; added a pre-make guard to fail if `APPLE_IDENTITY` isn’t set.
- ✅ **Config consistency** — Aligned helper bundle ID to `com.sonicflow.app.helper`; documented build + verification commands.
- ⚠️ **Email OTP investigation** — Reviewed code paths and provided concrete Supabase/redirect checks; not yet confirmed root cause or fix.

## Technical Implementation
- Moved to a single source of truth for signing: `APPLE_IDENTITY` (Developer ID Application) with Hardened Runtime.
- Let `electron-osx-sign` handle nested helper signing via `osxSign.binaries` and targeted `optionsForFile` entitlements.
- Removed shell-based helper `codesign` to avoid identity mismatch. Aligned CFBundleIdentifier across plist/script.
- Added `preMake` hook to hard-fail mac builds without `APPLE_IDENTITY` to prevent accidental dev-signed releases.

**Files Modified:**
- `native/build-helper.sh` — Set CFBundleIdentifier to `com.sonicflow.app.helper`; removed codesign step (helper remains unsigned until Forge signs it).
- `forge.config.ts` — Required `APPLE_IDENTITY`; added `osxSign.binaries` for the helper `.app` and its binary; used `inherit.plist` for helper; added `preMake` guard; kept `osxNotarize` for app-level notarization.

## Bugs & Issues Encountered
1. **Gatekeeper rejection (origin=Apple Development)** — Installed app was dev-signed, causing `spctl` rejection.
   - **Fix:** Remove old app from `/Applications`, rebuild with `APPLE_IDENTITY` (Developer ID), and notarize. Removed fallback to Apple Development to force correct identity.
2. **Helper pre-signed with dev identity** — Mixed identities between main app (Developer ID) and helper (Apple Development) risked notarization and Gatekeeper.
   - **Fix:** Stopped pre-signing in script; Forge now signs both app and nested helper consistently.
3. **Email OTP not delivered** — Email-based sign-in no longer sending/confirming.
   - **Workaround/Next checks:** Verify Supabase redirect allowlist (`https://auth.sonicflow.app/auth/callback`, `sonicflow://auth/callback`, `http://127.0.0.1:43112/auth/callback`), inspect Supabase Auth logs/provider (DKIM/SPF/SMTP), and ensure `auth.sonicflow.app` forwards query/fragment tokens to `sonicflow://auth/callback`.

## Key Learnings
- **Notarize the app, not the helper** — Helper is covered inside the notarized app/DMG; consistency of identity and hardened runtime across all nested code is critical.
- **No identity mixing** — Mixing Apple Development and Developer ID anywhere in the bundle leads to `spctl` rejection or notarization failures.
- **`electron-osx-sign` can sign nested helpers** — Listing both the embedded `.app` and its executable in `binaries` avoids nested code warnings and keeps signing deterministic.
- **Supabase email flows depend on redirect handling** — The website must forward either fragment tokens (#access_token) or `?token_hash&type=email` to the custom scheme callback the app validates.

## Architecture Decisions
- **Single identity source (`APPLE_IDENTITY`)** — Removed Apple Development fallback to guarantee consistent releases and surface misconfig early.
- **Delegate signing to Forge** — Centralizes signing logic (including helper) and reduces drift from shell scripts.

## Ready for Next Session
- ✅ **Release build path** — Config is ready for notarized Developer ID builds; helper is signed in lockstep.
- 🔧 **Email auth validation** — Implement/verify token forwarding on `auth.sonicflow.app`; confirm Supabase redirect allowlist and delivery settings.

## Context for Future
This signing cleanup stabilizes distribution and prepares for safe auto-updates. Next, close the loop on the email OTP flow (site forwarding + Supabase settings) and consider moving to App Store Connect API key auth for CI-friendly notarization.

