# Selection Inspect Plumbing

**Date:** 2025-09-24  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
User wants a reliable edit-mode dictation workflow where selecting text before speaking routes the transcript to a GPT-4.1 editing pass. Before building the LLM integration, they asked to validate accessibility plumbing: detect selected text at dictation start, expose it to the renderer, and understand existing helper/worker flows to chart the roadmap.

## What We Accomplished
- ✅ **Mapped current dictation + helper stack** - Traced macOS helper output, main-process listeners, renderer hook lifecycle, and worker LLM usage to understand available signals and missing pieces.
- ✅ **Captured selection snapshot on dictation start** - Added base64-safe output in the helper, parsed it in main, bridged it through preload, and surfaced it from `useTranscription()` so the renderer sees context and selected text before streaming audio.
- ✅ **Documented roadmap for edit-mode** - Logged the sequencing for sending edit metadata to the worker and invoking GPT‑4.1 once the prompt + selection capture is stable.

## Technical Implementation
- Helper now emits both truncated plain text and base64 versions for `selectedText`/`context`, preventing truncation or newline ambiguity (`native/sonic-helper.c` lines 187-214, 396-408).
- Main process parses helper stdout, handles timeouts/errors, and exposes a `selection:inspect` IPC handler returning a typed snapshot (`src/main.ts` around lines 662-845, 3046-3064). Buffer parsing uses base64-first fallback and clamps context slices for performance.
- Preload bridges `window.selection.inspect(...)`, typed via `SelectionInspectSnapshot` additions in shared types (`src/preload.ts`, `src/types/shared.ts`, `src/types/electron.d.ts`).
- `useTranscription()` awaits `window.selection.inspect()` before opening the mic, caches the snapshot in state, and the pill UI logs trace entries when a selection is captured (`src/hooks/useTranscription.ts`, `src/components/App.tsx`). This confirms accessibility data arrives before audio streaming.

**Files Modified:**
- `native/sonic-helper.c` - Added base64 emit helper and wired it into `--inspect-text` output.
- `src/main.ts` - Implemented selection inspection parsing, IPC handler, and related helpers.
- `src/preload.ts` - Exposed the `selection.inspect` bridge.
- `src/hooks/useTranscription.ts` - Captures selection snapshot at session start and exposes it via hook state.
- `src/components/App.tsx` - Logs captured selection into pill debug trace for quick verification.
- `src/types/shared.ts` - Defined shared selection snapshot types.
- `src/types/electron.d.ts` - Declared renderer-side typings for the new bridge.

## Bugs & Issues Encountered
1. **Helper output truncated large selections** - Plain stdout occasionally clipped long selections at 512 chars.
   - **Fix:** Added base64 encoding so the renderer receives full UTF-8 payloads without delimiter issues.
2. **Inspector processes could hang** - Without guards, stuck AX calls would hold the event loop.
   - **Workaround:** The main-process wrapper now applies a 1.5s timeout and kills the helper if it stalls.

## Key Learnings
- **AX inspection must decode safely** - Plain `printf` snapshots are brittle; base64 ensures we don’t misparse line breaks or multi-byte characters.
- **Dictation start is the right hook for selection capture** - Waiting until `stop()` would miss context and feel laggy; doing it before mic spin-up keeps latency low.
- **Existing worker LLM flow is post-ASR polish** - Today it feeds final transcript into Groq/OpenAI/Baseten; edit mode will need a parallel branch keyed off selection metadata.

## Architecture Decisions
- **Expose inspection via main IPC** - Centralized spawn/parsing in main avoids duplicating parsing logic in renderers and keeps helper lifecycle consistent.
- **Context slice clamp (<=512 chars)** - Balances fidelity with helper performance; larger values slow AX reads disproportionately.

## Ready for Next Session
- ✅ **Selection snapshots available** - Renderers can branch on `trans.selection?.hadSelection` immediately.
- 🔧 **Worker edit pathway pending** - Need websocket message/schema updates and GPT‑4.1 edit scaffolding before edits execute end-to-end.

## Context for Future
Selection-aware dictation is now observable and stable: the helper, main process, and renderer agree on selected ranges and surrounding text. Next sessions can focus on branching the websocket protocol and worker pipeline to feed GPT‑4.1 with `{prompt, selection}` and reinject the edited text, eventually completing the edit-mode experience.

## Roadmap / Next Steps
1. Extend `start` payload (or send a new message) with the captured selection snapshot and user prompt metadata.
2. Update the worker session state to detect edit mode and call the GPT‑4.1 editing path instead of the default ASR correction flow.
3. Implement renderer-side edit handling: replace the original selection with model output, manage failure fallbacks, and surface UX cues.
4. Add targeted tests (unit + integration harness) covering selection capture, IPC serialization, and worker edit-mode branching to prevent regressions.
