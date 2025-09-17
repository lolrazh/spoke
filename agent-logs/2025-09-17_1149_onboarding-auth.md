# Onboarding Auth Card Refresh

**Date:** 2025-09-17  
**Agent:** GPT-5 (Codex)  
**Status:** ✅ Completed  

## User Intention
The user wanted the onboarding experience to reassure already signed-in users, letting them stay on the same screen while switching accounts without re-running the entire auth form. They also cared about preserving the visual language of existing UI patterns and ensuring the flow remains smooth and trustworthy.

## What We Accomplished
- ✅ **Refined signed-in summary card** - Tightened layout, left-aligned content, and added session validity cues while reusing the design system tokens
- ✅ **Streamlined auth pipeline** - Hid the email magic-link UI, funneled both initial sign-in and account switching through Google OAuth, and kept the onboarding step in place for continuity
- ✅ **State smoothing for account swaps** - Added switching/session guards so the UI stays rendered while Supabase refreshes, preventing Next navigation until the new session arrives
- ✅ **Clarified post-switch flow** - Tracked switch intent so OAuth callbacks keep the auth step visible, removed redundant helper copy, and moved error notices beneath the CTAs

## Technical Implementation
Tracking a new `sessionValid` flag ensures onboarding only advances once Supabase confirms the refreshed account, while `isSwitchingAccount` tempers button states and messaging. `switchAccountIntentRef` guards the OAuth callback so deliberate switches stay on the current step, and resets across success/failure paths to avoid sticky state. Google OAuth starts via a shared helper so both entry points follow the same code path, and the summary card now dims when waiting for a callback. Error messaging renders immediately under each CTA, avatar styling gained a square variant to match settings surfaces, and auth email logic remains wired even though the form is hidden for future reuse.

**Files Modified:**
- `src/components/Onboarding.tsx` - Added session/switching state, introduced switch intent guard, refreshed auth summary UI, and adjusted navigation gating and messaging
- `src/components/ui/avatar.tsx` - Introduced shape and small-size options for square badges

## Bugs & Issues Encountered
1. **Auth flicker during account swap** - UI briefly cleared while waiting for Supabase
   - **Fix:** Held the summary card in place, dimmed it, and blocked progression until `sessionValid` flips true
2. **Duplicate OAuth wiring** - Separate handlers for Google and Switch Account caused divergent behavior
   - **Fix:** Consolidated into `startGoogleOAuth` and used shared loading/error handling
3. **Permissions auto-advance after switch** - OAuth callback still advanced to the next step during account swaps
   - **Fix:** Checked `switchAccountIntentRef` inside the callback and returned early when the user initiated a switch

## Key Learnings
- **Onboarding gating** relies on both step state and session validity, so a dedicated flag prevents accidental forward navigation while auth is mid-flight.
- **Supabase callbacks** can lag behind the OAuth launch; keeping UI visible avoids jarring transitions.
- **Design tokens** already cover narrow card layouts, so reusing `onboarding-permission-row` keeps visuals consistent without new CSS.
- **Callback context** matters for flow control; lightweight refs can disambiguate intentional account swaps from initial sign-ins without new global state.

## Architecture Decisions
- **Stay on auth step during switches** - Chosen to minimize re-render churn and reassure users by maintaining context
- **Use local intent refs** - Scoped the switch guard to onboarding instead of introducing shared auth context, keeping the change low-risk
- **Keep magic-link code dormant** - Hidden in the UI but preserved in logic so it can return quickly if business needs change

## Ready for Next Session
- ✅ **Visual state guards** - Session and switching flags are hooked up and ready for additional transitions or telemetry
- 🔧 **Performance validation** - Consider profiling the auth step to confirm no lingering flicker or animation jank

## Context for Future
This work stabilizes the onboarding auth surface so future sessions can layer in profile enrichment, additional providers, or analytics without reworking the card layout or navigation flow.
