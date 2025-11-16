# Add Google Login to Homepage Intro

**Date:** 2025-11-15
**Agent:** Claude (Sonnet 4.5)
**Status:** ✅ Completed

## User Intention
User wanted to streamline the onboarding flow by reducing friction before authentication. Instead of requiring users to click "Start Setup" to see a separate auth page with the Google login button, they wanted the Google login button directly on the first intro screen. This eliminates an unnecessary navigation step, reducing the click count from 2 to 1 before users can begin authentication.

## What We Accomplished
- ✅ **Moved Google OAuth to IntroExperience** - Replaced "Start Setup" button with "Continue with Google" button directly on intro screen
- ✅ **Fixed PKCE code verifier error** - Resolved "both auth code and code verifier should be non-empty" error by removing duplicate callback handlers
- ✅ **Fixed OAuth error visibility** - Ensured errors display correctly by hiding intro overlay when OAuth callback fails
- ✅ **Fixed button flash on click** - Removed jarring visual flash when clicking Google login button
- ✅ **Maintained existing flow** - Onboarding component automatically skips auth step when user is already authenticated
- ❌ **Button scaling (reverted)** - Attempted to scale buttons proportionally to larger window size, but user didn't like the result and reverted

## Technical Implementation

**Google OAuth Integration in IntroExperience:**
- Added `getSupabase()` and `getGoogleOAuthUrl()` imports from supabaseClient
- Initialize Supabase client early on mount to ensure PKCE verifier storage is ready
- Added `handleGoogleLogin()` function to start OAuth flow (identical to Onboarding implementation)
- Added state management for auth loading and errors
- IntroExperience no longer registers auth callback handler (Onboarding handles this)

**Onboarding Callback Handler Split:**
- Split single useEffect into two separate effects:
  1. Initial auth check: Only runs in non-intro mode, handles returning user flow
  2. Auth callback listener: Always runs (even during intro), processes OAuth callbacks
- Added `setShowIntro(false)` in callback handler to hide intro after successful auth and on error
- Callback effect uses empty dependency array `[]` instead of `[introOnly]`

**Files Modified:**
- `src/components/intro/IntroExperience.tsx` - Added Google OAuth button, initialization, state management
- `src/components/Onboarding.tsx` - Split auth useEffect, added intro hiding logic on callback completion/error
- `src/components/ui/button.tsx` - Scaled button sizes (reverted)

## Bugs & Issues Encountered

1. **PKCE code verifier error after OAuth callback**
   - **Symptoms:** Error "Invalid request: both auth code and code verifier should be non-empty" after successful Google login
   - **Root Cause:** Both IntroExperience and Onboarding registered auth callback handlers. When OAuth completed, both handlers tried to exchange the same authorization code. First succeeded, second failed because OAuth codes can only be used once.
   - **Fix:** Removed callback handler from IntroExperience. Only Onboarding handles callbacks now. IntroExperience only initiates OAuth and initializes Supabase client early.

2. **Callback handler not firing during intro**
   - **Symptoms:** OAuth callback not processed when intro is showing
   - **Root Cause:** Onboarding's useEffect returned early if `introOnly === true`, preventing callback registration
   - **Fix:** Split useEffect into two separate effects - one for initial auth check (skips in intro mode), one for callback listener (always active)

3. **OAuth errors hidden behind intro overlay**
   - **Symptoms:** When OAuth callback failed, error was set in state but invisible to user because intro overlay remained visible
   - **Fix:** Added `setShowIntro(false)` in error handling path of callback, revealing the auth step with error message

4. **Button flash when clicking Google login**
   - **Symptoms:** Clicking "Continue with Google" caused jarring visual flash - button text changed to "Opening Google…", opacity dimmed to 50%, then immediately reverted back within ~50-200ms
   - **Root Cause:** Code set `authLoading=true` before opening browser, then immediately set it to `false` after. Since browser opens instantly, the loading state lasted only a split second, creating a distracting flash effect
   - **Fix:** Removed loading state entirely for successful OAuth flow. Browser opening provides immediate user feedback. Button stays constant (no text change, no opacity change, no disabled state). Only errors use authLoading for error display context.

## Key Learnings

- **Duplicate callback handlers cause PKCE failures** - OAuth authorization codes are single-use. Multiple handlers trying to exchange the same code will cause the PKCE error. Only one component should handle callbacks.

- **IntroOnly mode requires careful callback handling** - When a component conditionally returns early from useEffect based on props, it can prevent critical event listeners from being registered. Split conditional logic into separate effects.

- **PKCE flow requires early client initialization** - Supabase's PKCE flow stores the code verifier in localStorage when generating the OAuth URL. The client must be initialized before `getGoogleOAuthUrl()` is called, not lazily on first use.

- **Button scaling needs user testing** - Programmatic scaling calculations don't always match user aesthetic preferences. What seems "proportional" mathematically may not feel right visually. Always test UI changes with users before finalizing.

- **Instant feedback doesn't need loading states** - When an action provides immediate visual feedback (like opening a browser window), adding a loading state creates a distracting flash instead of improving UX. Only use loading states when the operation takes noticeable time (>300ms).

## Architecture Decisions

- **IntroExperience initiates, Onboarding handles callbacks** - Clear separation of concerns: IntroExperience shows UI and starts OAuth flow, Onboarding processes the callback and manages auth state transitions. This prevents race conditions and keeps each component focused.

- **Hide intro on both success and failure** - Ensures users always see the relevant next screen: name verification on success, auth step with error on failure. No stuck states.

- **Preserve existing auto-skip logic** - When Onboarding mounts and detects an authenticated user who hasn't completed onboarding, it automatically jumps to "name-verification" step. No changes needed to this logic.

## Ready for Next Session

- ✅ **Google login flow complete** - Intro → Google OAuth → Name verification works end-to-end
- ✅ **Error handling robust** - All error paths tested and display correctly
- ✅ **Code review passed** - Architecture, error handling, security, and UX all validated
- 🔧 **Button sizing needs revisiting** - User didn't like the scaled buttons. May need designer input or A/B testing to find the right balance between proportionality and aesthetics.

## Context for Future

This change reduces onboarding friction by eliminating an unnecessary click before authentication. The IntroExperience component now serves as both the first impression and the auth entry point. If future sessions need to add additional auth methods (email, Apple, etc.), they should be added to IntroExperience alongside the Google button, not on a separate auth step. The Onboarding component's auth step is now effectively skipped for new users, only shown if OAuth callback fails.
