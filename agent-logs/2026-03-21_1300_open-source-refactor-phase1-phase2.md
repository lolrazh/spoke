# Open-Source Refactor: Phase 1 + Phase 2

**Date:** 2026-03-21
**Agent:** Claude Opus 4.6 (1M context)
**Status:** ✅ Completed

## User Intention
User wanted to execute a massive architectural refactor to convert Spoke from a hosted, auth-gated product into a local-first, open-source desktop app. The goal was to decompose monolithic files (main.ts at 5,084 lines, App.tsx at 1,916 lines, Onboarding.tsx at 2,599 lines), extract core seams without breaking existing behavior (Phase 1), and then productize the local MLX STT runtime so it works in packaged builds (Phase 2). The refactor plan was already documented in `docs/OPEN_SOURCE_REFACTOR.md`.

## What We Accomplished

### Phase 1: Extract Core Seams (36 commits)
- ✅ **Fixed 3 broken tests** - smartRouting parse error, runtime default mismatch, useTranscription missing dependency + stale cache
- ✅ **Extracted pill state machine** - `src/state/pillStateMachine.ts` (170 lines, 21 unit tests)
- ✅ **Decomposed main.ts from 5,084 → 3,239 lines (-36%)** - 13 service modules extracted
- ✅ **Extracted renderer hooks** - useProviderSelection, useMicVisualizer, useSharePreference, useOnboardingAuth
- ✅ **Shared provider logic** - SettingsPanel now uses same useProviderSelection hook as Onboarding (eliminated duplication)
- ✅ **Added 25 new tests** - pill state machine (21) + provider selection (4)
- ✅ **Updated OPEN_SOURCE_REFACTOR.md** with Phase 1 completion status

### Phase 2: Productize Local MLX Runtime (15 commits)
- ✅ **Sidecar packaging** - PyInstaller build script, --weights-dir CLI arg, forge.config.ts extraResource + signing
- ✅ **Model manager core** - Download, SHA256 verify, atomic install, state persistence, error recovery
- ✅ **IPC bridge** - stt:get-model-status, stt:install-model, stt:remove-model, progress events
- ✅ **Settings UI** - ModelInstallCard with 5 visual states (not_installed, downloading, installing, ready, broken)
- ✅ **Provider catalog integration** - modelInstalled field, "Needs Model" badge, sidecar spawn gated on readiness
- ✅ **Error hardening** - Concurrent install guard, remove-during-download guard, interrupted download recovery
- ✅ **Auto-restart** - Sidecar restarts once on unexpected exit when local provider is selected
- ✅ **34 new tests** - modelManager (19), useModelStatus (8), ModelInstallCard (6), providerCatalog (4 expanded)

## Technical Implementation

### Phase 1 Architecture: Module Extraction Pattern
Each extraction followed the same pattern:
1. Identify self-contained state + functions
2. Create new module with `init()` or callback injection for external deps
3. Replace inline code with imports
4. Clean up unused imports
5. Run tests, commit

**Callback injection** was used for modules that needed `mainWindow` or `rebuildTrayMenu` (updateController, micManager, floatingBar) to avoid tight coupling to main.ts globals.

### Phase 2 Architecture: Model Manager
- **State machine:** `not_installed → downloading → installing → ready | broken`
- **Persistence:** `userData/local-stt/model-state.json`
- **Download:** Node.js https with redirect following, progress via content-length
- **Verification:** SHA256 streaming hash via `crypto.createHash`
- **Atomic install:** Download to `.tmp/`, verify, `fs.renameSync` to final path
- **Path split:** Binary in `extraResource` (immutable), weights in `userData` (mutable). Connected via `--weights-dir` CLI arg.

**Files Created (Phase 1 — 18 modules):**
- `src/main/providerStore.ts` (292) — STT preferences, API key secrets, OpenAI transcription
- `src/main/sidecarEngine.ts` (233) — Local STT sidecar lifecycle
- `src/main/selectionInspect.ts` (232) — AX text field inspection
- `src/main/notchReporter.ts` (232) — Notch detection + sanitization
- `src/main/permissions.ts` (321) — macOS permission IPC handlers
- `src/main/updateController.ts` (293) — Auto-update management
- `src/main/preferences.ts` (124) — Mic/pill/app preference I/O
- `src/main/pasteDaemon.ts` (146) — Paste helper daemon lifecycle
- `src/main/floatingBar.ts` (91) — Timed hide/show management
- `src/main/micManager.ts` (99) — Mic device selection + broadcast
- `src/main/windowAnimation.ts` (60) — smoothShow/smoothHide
- `src/main/helperPaths.ts` (29) — Native helper binary paths
- `src/main/iconPaths.ts` (64) — Icon path resolution
- `src/state/pillStateMachine.ts` (170) — Pill UI state machine
- `src/hooks/useProviderSelection.ts` (92) — Provider loading/selection
- `src/hooks/useMicVisualizer.ts` (138) — Web Audio mic visualization
- `src/hooks/useSharePreference.ts` (106) — Transcription sharing toggle
- `src/hooks/useOnboardingAuth.ts` (232) — Auth lifecycle for onboarding

**Files Created (Phase 2 — 9 files):**
- `src/main/modelManager.ts` — Model download/install/remove state machine
- `src/main/sidecarPaths.ts` — Dev vs packaged path resolution
- `src/hooks/useModelStatus.ts` — Renderer hook for model lifecycle
- `src/components/ModelInstallCard.tsx` — Settings UI for install/progress/remove
- `local-stt/build-sidecar.sh` — PyInstaller build script
- `build/entitlements/sidecar.plist` — Sidecar code signing entitlements
- `src/main/modelManager.test.ts` — 19 tests
- `src/hooks/useModelStatus.test.ts` — 8 tests
- `src/components/ModelInstallCard.test.tsx` — 6 tests

**Files Modified (key changes):**
- `local-stt/sidecar.py` — Added `--weights-dir` CLI arg
- `forge.config.ts` — Added spoke-stt to extraResource + signing + entitlements
- `src/preload.ts` — Added model management IPC channels
- `src/types/electron.d.ts` — Added model IPC type declarations
- `src/types/shared.ts` — Added ModelInstallState, ModelStatus, ModelManifest
- `src/core/transcription/providerCatalog.ts` — Added modelInstalled field
- `src/main/providerStore.ts` — Snapshot includes model readiness
- `src/components/SettingsPanel.tsx` — ModelInstallCard + "Needs Model" badge
- `src/test/setup.ts` — Upgraded mocks to vi.fn() + added model mocks

## Bugs & Issues Encountered
1. **smartRouting.test.ts parse error** - Extra closing brace at line 257
   - **Fix:** Removed orphan `});` and fixed indentation
2. **runtime.test.ts wrong default** - Test expected `stream: true` but config default was `false`
   - **Fix:** Aligned assertion with `LLM_DEFAULT_STREAM = false`
3. **useTranscription.test.tsx missing dependency** - `@testing-library/react` not installed
   - **Fix:** Installed as devDependency, cleared auth token cache between tests
4. **Orphan closing brace in main.ts** - Left behind when removing preSpawnPasteHelper function
   - **Fix:** Removed the stray `}` at line 652
5. **M5 changes not committed** - Opus subagent amended into M4 commits instead of creating new ones
   - **Fix:** Staged and committed separately with proper message

## Key Learnings
- **Callback injection > DI containers** for Electron main process modules — passing `rebuildTrayMenu` as a callback is cleaner than a full DI framework
- **The remaining main.ts (~3,200 lines) is orchestration** — window factories, tray menus, PTT daemon, and auth deep linking all reference `mainWindow` and share mutable state. These need Phase 4 (auth removal) before clean extraction
- **Ralph Loop runs indefinitely** — when the refactor was done, the loop kept firing. Had to use `/ralph-loop:cancel-ralph` to stop it
- **Opus subagents work well for milestone-sized tasks** — giving them full context + file paths + patterns to follow produced correct code with minimal fixup
- **vi.fn() mocks in test setup are critical** — plain functions can't be spied on; upgrading to vi.fn() early saves test debugging later

## Architecture Decisions
- **Weights in userData, binary in extraResource** — Weights are mutable (downloaded, can be removed), binary is immutable (ships with app). Connected via `--weights-dir` CLI arg.
- **Single manifest, not per-file** — One JSON manifest describes all model files, checksums, and URLs. Simpler than managing separate manifests.
- **Provider stays selectable without model** — User can select "Local Moonshine" even without the model. The guard is at transcription time, showing a clear error. Better UX than greying out the option.
- **State machine in module, not in Electron Store** — File-backed JSON persistence (`model-state.json`) rather than electron-store. Matches the existing providerStore pattern.
- **Auto-restart limited to one attempt** — Prevents restart loops. If the sidecar fails twice, user must manually retry.

## Ready for Next Session
- ✅ **Phase 1 complete** — All acceptance criteria met, documented in OPEN_SOURCE_REFACTOR.md
- ✅ **Phase 2 code complete** — Model manager, IPC, UI, provider integration all wired
- ✅ **240 tests passing** across 34 test files
- ✅ **GitHub default branch** fixed from mlx-moonshine back to main
- 🔧 **PyInstaller build not tested** — `local-stt/build-sidecar.sh` exists but hasn't been run yet (needs venv + pyinstaller installed)
- 🔧 **Model manifest URL** — Hardcoded to `https://download.spoke.so/models/moonshine-v2/manifest.json` which doesn't exist yet. Need to host the manifest + weights.
- 🔧 **Packaged build not tested** — Need to run `build-sidecar.sh` then `npm run package` to verify end-to-end

## Context for Future
Phase 1 + 2 establish the local-first architecture. Phase 3 (BYO cloud providers) can now build on the provider contracts and catalog. Phase 4 (remove auth from core UX) will unlock the final main.ts decomposition — the remaining 3,200 lines are mostly auth-coupled orchestration that becomes deletable once Supabase is removed. The model manifest and weights hosting need to be set up before the local STT flow can be tested end-to-end in production.
