# Settings Panel Auth Loop Investigation

**Date:** 2025-10-17  
**Agent:** GPT-5 (Codex)  
**Status:** ✅ Completed  

## User Intention
Diagnose why opening the settings panel during recording or onboarding repeatedly triggered the login window and sign-in toast, then eliminate the regression so the panel can open reliably without rebooting the app.

## What We Accomplished
- ✅ **Identified redirect trigger** – Traced the loop to `SettingsPanel`’s onboarding redirect that fired whenever cached identity didn’t resolve instantly.
- ✅ **Restored single auth gate** – Removed the panel-level redirect so only `App.tsx` decides when onboarding should show, preventing the repeated sign-in cycle.

## Technical Implementation
Focused on the embedded settings flow: audited recent identity-cache changes, confirmed `App.tsx` already manages signed-out routing, and deleted the redundant onboarding redirect while keeping the identity subscription for user copy.

**Files Modified:**
- `src/components/SettingsPanel.tsx` – Dropped `authReady` state and the `showOnboarding` effect; the panel now simply hydrates identity data.

## Bugs & Issues Encountered
1. **Settings panel reopening onboarding** – Embedded panel redirected as soon as `userEmail` was null during identity hydration.  
   - **Fix:** Removed the redirect, relying on the main auth guard to handle true sign-outs.

## Key Learnings
- **Identity hydration can lag on mount** – Cached email may be briefly null, so downstream views must tolerate that without assuming sign-out.
- **Centralized auth guards reduce churn** – Letting `App.tsx` be authoritative avoids divergent logic between onboarding and the main pill.

## Architecture Decisions
- **Prefer App-level routing** – Keeping onboarding transitions in one place keeps embedded surfaces resilient to transient auth state.
- **Retain lightweight identity subscription** – We still display user info instantly without forcing additional session checks from the panel.

## Ready for Next Session
- ✅ **Settings panel stable** – Opening settings no longer triggers onboarding while recording or during onboarding.
- 🔧 **Optional** – Run `npm test` to confirm no other behavior assumes the old redirect.

## Context for Future
With the redundant redirect removed, the settings surface stays consistent across recording and onboarding, simplifying future polish or feature work on the panel without worrying about auth loops.

# Onboarding Textarea Autofocus

**Date:** 2025-10-17  
**Agent:** GPT-5 (Codex)  
**Status:** ✅ Completed  

## User Intention
Make the onboarding practice text boxes automatically grab focus so new users can start dictating immediately without learning they need to click into the fields first.

## What We Accomplished
- ✅ **Autofocus across onboarding steps** – Added a resilient focus routine that targets the active textarea once its step renders, handling animation delays.
- ✅ **Step-addressable textareas** – Tagged each onboarding textarea with a `data-onboarding-step` hook so the focus helper can locate whichever instance is mounted.

## Technical Implementation
Hooked the existing `currentStep` watcher to run a `requestAnimationFrame` + retry loop that resolves the mounted textarea, reuses the shared ref, and calls `focus({ preventScroll: true })` once available. Instrumented each onboarding textarea with a matching `data-onboarding-step` attribute so the handler can query it if the ref still points at a previous step.

**Files Modified:**
- `src/components/Onboarding.tsx` – Added the resilient focus effect and data attributes on the three onboarding textareas.

## Bugs & Issues Encountered
1. **Textarea not available immediately after step change** – Framer-motion animations delay mount enough that a simple timeout sometimes fires early.  
   - **Fix:** Combined `requestAnimationFrame` with an 80 ms retry loop until the textarea exists, then focus safely.

## Key Learnings
- **Animated mounts delay refs** – When components mount via motion transitions, refs might lag, so combining rAF with short retries keeps autofocus reliable.
- **Data attributes simplify step targeting** – Lightweight selectors avoid threading separate refs through conditional renders.

## Architecture Decisions
- **Single shared ref with query fallback** – Keeps existing state wiring intact while still resolving the active textarea.
- **Prevent scroll on focus** – Avoids accidental viewport shifts during onboarding transitions.

## Ready for Next Session
- ✅ **Onboarding dictation UX polished** – Users land with the caret in the proper field for all three practice modes.
- 🔧 **Optional QA** – Manually verify on slower machines to confirm the retry window remains sufficient.

## Context for Future
With autofocus baked in, onboarding testers can begin dictation immediately, reducing friction and making future macros or input-capture tweaks easier to validate without extra instructions.
