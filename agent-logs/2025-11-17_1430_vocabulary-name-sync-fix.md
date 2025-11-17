# Vocabulary Name Sync and Token Splitting Fix

**Date:** 2025-11-17
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User discovered two critical bugs with vocabulary handling for transcription: (1) When updating their display name in Supabase (e.g., "Sandeep Rajkumar" → "Sandeep"), the settings panel would update correctly but the vocabulary passed to the STT model would revert to the old OAuth name after auth token refresh, and (2) Full names were being treated as single vocabulary tokens, making it harder for the AI model to spell each name component correctly in longer dictations. The goal was to ensure Supabase profile remains the source of truth for identity, and to split names into individual tokens for better transcription accuracy.

## What We Accomplished
- ✅ **Fixed auth token refresh bug** - `subscribeToAuthChanges()` no longer overwrites cached identity with stale OAuth metadata on `TOKEN_REFRESHED` events
- ✅ **Split names into separate vocabulary tokens** - "Sandeep Rajkumar" now becomes ["Sandeep", "Rajkumar"], works for any number of name parts
- ✅ **Updated tests** - Added test cases for split names including three-part names (e.g., "John Doe Smith")
- ✅ **Code cleanup** - Removed unused parameter after linting feedback

## Technical Implementation

**Architecture Pattern:**
- Supabase `profiles.display_name` is the single source of truth for user names
- OAuth `user_metadata` is immutable (frozen at sign-in time) and should not overwrite profile data
- Auth state change handler now only acts on `SIGNED_IN` (fetch fresh) and `SIGNED_OUT` (clear)
- Token refreshes (`TOKEN_REFRESHED` events) are ignored to preserve cached identity

**Key Changes:**

1. **`subscribeToAuthChanges()`** (src/state/userIdentity.ts:118-133)
   - Changed from running on every auth event to selective handling:
     - `SIGNED_OUT` → Clear identity
     - `SIGNED_IN` → Fetch from Supabase profile via `refreshIdentity()`
     - `TOKEN_REFRESHED` and others → Ignored (no-op)
   - Previously used `user_metadata.name` which never updated after initial OAuth login

2. **`buildSTTPrompt()`** (shared/sttPrompt.ts:47-60 and worker/src/services/stt/prompt.ts:47-60)
   - Split `identity.name` by whitespace: `name.split(/\s+/).filter(Boolean)`
   - Each name part becomes a separate vocabulary token
   - Example: "Sandeep Rajkumar" → `["Sandeep", "Rajkumar"]` → vocabulary includes both separately

**Files Modified:**
- `src/state/userIdentity.ts` - Fixed `subscribeToAuthChanges()` to only update on sign-in/sign-out
- `shared/sttPrompt.ts` - Split name into individual tokens before formatting
- `worker/src/services/stt/prompt.ts` - Mirror the same name-splitting logic for worker
- `worker/src/services/stt/prompt.test.ts` - Updated expectations for split names, added three-name test case

## Bugs & Issues Encountered

1. **Auth token refresh overwrites cached identity with OAuth metadata**
   - **Symptom:** User updates name in Supabase → Settings panel shows new name → After ~1 hour, vocabulary reverts to old OAuth name
   - **Root cause:** `onAuthStateChange` callback was running on ALL events (including `TOKEN_REFRESHED`) and always emitting `user_metadata.name`, which is immutable Google OAuth data
   - **Fix:** Only handle `SIGNED_IN` (fetch from profile) and `SIGNED_OUT` (clear), ignore all other events

2. **Linter error: unused `session` parameter**
   - **Symptom:** Codex flagged unused parameter in callback: `async (event, _session) => {...}`
   - **Root cause:** Removed usage of `session` when fixing auth bug, but kept parameter declaration with underscore prefix
   - **Fix:** Removed `_session` parameter entirely since it's the last parameter and not needed

3. **Names treated as single vocabulary tokens**
   - **Symptom:** AI model struggles to spell "Sandeep" or "Rajkumar" correctly in long emails when vocabulary has "Sandeep Rajkumar" as one phrase
   - **Root cause:** `formatTokens()` was receiving full name as a single string token
   - **Fix:** Pre-split name by whitespace before passing to `formatTokens()`, so each part is individually sanitized and deduplicated

## Key Learnings

- **OAuth metadata is frozen at sign-in time** - `user_metadata.name` from Google OAuth never updates even if user changes their profile. Always fetch from `profiles.display_name` for current data.

- **Token refresh !== identity change** - `TOKEN_REFRESHED` events are about JWT token renewal (security), not user data changes. Identity should only update on actual sign-in/sign-out events.

- **Vocabulary granularity matters for AI** - Breaking "John Doe Smith" into ["John", "Doe", "Smith"] helps the LLM recognize each component independently, improving spelling accuracy in varied contexts (emails, signatures, etc.)

- **Subscription pattern works perfectly** - Both `SettingsPanel` and `useTranscription` subscribe to the same `userIdentity` state, so fixing the source automatically fixed both UI and vocabulary without coordination code.

- **JavaScript allows omitting trailing parameters** - Don't need to declare `_session` if you're not using it; callbacks can accept fewer parameters than the API provides.

## Architecture Decisions

- **Only fetch profile on SIGNED_IN, not on token refresh** - Avoids redundant database calls every hour while ensuring fresh data when user actually authenticates. Token refreshes happen silently in background and don't indicate profile changes.

- **Split names client-side before sending to worker** - Both client (`shared/sttPrompt.ts`) and worker (`worker/src/services/stt/prompt.ts`) have the same logic, ensuring vocabulary is consistent regardless of where prompt is built. Simple whitespace split handles all common name formats (first, first+last, first+middle+last, etc.).

- **Supabase profile as single source of truth** - OAuth metadata is immutable and only useful for initial setup. `profiles.display_name` is user-editable and should always override OAuth data in `refreshIdentity()`.

## Ready for Next Session
- ✅ **Vocabulary syncs correctly** - Name changes in Supabase persist through auth token refreshes, visible in settings and STT prompts
- ✅ **Name splitting works for any number of parts** - Tests cover 2-name and 3-name cases, regex handles any whitespace-separated format
- ✅ **No redundant Supabase calls** - Only fetches profile on actual sign-in, not on hourly token refreshes
- 🔧 **Linting infrastructure needs attention** - `npm run lint` has config issues unrelated to our changes, but code follows correct patterns

## Context for Future
This work ensures that user identity updates (name changes in profile) propagate correctly throughout the app without being overwritten by stale OAuth data. The name-splitting enhancement improves transcription accuracy for personal names, which is critical for professional use cases (emails, documents, signatures). These fixes enable future vocabulary intelligence work (as described in docs/INTELLIGENT_VOCABULARY.md) by ensuring the foundation—user identity and basic vocabulary injection—works reliably.

## Commits
- `aeea10f` - fix: prevent auth token refresh from overwriting user identity with stale OAuth metadata
- `3498c8c` - feat: split user names into separate vocabulary tokens for better transcription accuracy
- `821e94c` - fix: remove unused session parameter to satisfy linter
- `b1ccce4` - refactor: remove unused session parameter from auth state change handler
