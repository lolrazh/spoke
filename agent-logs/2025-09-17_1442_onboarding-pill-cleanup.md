# Onboarding Pill Cleanup

**Date:** 2025-09-17  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
The user wanted the onboarding hotkey test to behave exactly like the production pill: stop overriding pill state, remove all bespoke gesture hacks, and rely on the standard single-shot paste instead of the fragile streaming textarea.

## What We Accomplished
- ✅ **Restored standard pill behaviour** — Removed all onboarding → pill puppeteering so the pill state machine reacts only to its own transcription lifecycle (`src/components/Onboarding.tsx`, `src/components/App.tsx`, `src/main.ts`).
- ✅ **Unified hotkey routing** — Forwarded helper hotkey events to both windows purely for visual feedback, letting the helper still target the main pill for audio/paste (`src/main.ts`).
- ✅ **Single paste onboarding tests** — Dropped the streaming textarea subscriptions and custom paste handlers so onboarding sees the same one-shot helper paste as the rest of the app; textboxes are now pure controlled inputs (`src/components/Onboarding.tsx`).

## Technical Implementation
- Removed `pillMirror*` IPC bridge and listeners; onboarding no longer emits mirror events, and the pill renderer no longer consumes them.
- Kept onboarding’s pill visibility prep but left `pttTarget` on `main`; helper down/up/cancel events are mirrored to the opposite window for keycap highlights.
- Eliminated onboarding’s `useTranscription` usage and delta mirroring; the textarea now only updates when the helper paste lands (or manual typing).

**Files Modified:**
- `src/components/Onboarding.tsx` — Removed transcription hook & mirror effects, simplified hotkey visuals, ensured single paste behaviour.
- `src/components/App.tsx` — Deleted pill mirror listeners.
- `src/main.ts` — Broadcast transcript updates globally and mirror helper hotkey events for onboarding visuals while keeping pill authoritative.
- `src/preload.ts` & `src/types/electron.d.ts` — Added transcript subscription bridge (used earlier, currently dormant but available).
- `src/components/SettingsPanel.tsx` — Minor copy tweak (already in tree).

## Bugs & Issues Encountered
1. **Textarea duplicating transcript** — Streaming effect and helper paste both wrote into onboarding textarea, causing doubled text.
   - **Fix:** Removed streaming subscription/paste handlers so only the helper paste updates textarea.
2. **Keycap state lost without puppeteering** — Once pill mirror events were gone, onboarding no longer saw PTT events.
   - **Fix:** Mirrored helper hotkey events to the non-target window for UI feedback.

## Key Learnings
- Onboarding can safely rely on the pill’s existing start/stop flows if we forward the raw helper events; no need for separate gesture logic.
- The streaming textarea path is brittle for shared surfaces; better to keep it as a debug/visualisation tool only.
- Broadcasting transcript updates via IPC keeps future streaming visualisations feasible without reintroducing puppeteering.

## Architecture Decisions
- **Single paste only:** Prefer the proven helper pipeline over UI streaming to avoid desyncs. Trade-off: lose progressive copy inside onboarding, but gain reliability.
- **Event mirroring instead of state mirroring:** Mirroring raw opt/cmd events keeps both windows in sync without coupling state machines.

## Ready for Next Session
- ✅ **Onboarding hotkey test** — behaves like production pill; ready for UX polish or metrics.
- 🔧 **Streaming preview (optional)** — If needed later, build it as a separate visual layer that doesn’t interfere with final paste.

## Context for Future
Onboarding now exercises the same dictation/paste pipeline as live usage, so bugs caught during onboarding should map directly to production behaviour. Future work can safely focus on UX improvements knowing the underlying flow is aligned.
