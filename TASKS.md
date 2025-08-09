### Sonic Flow — Implementation Plan & Task Board

This document tracks the milestones and tasks from the recent code review. Each item is a small, reviewable unit of work. Agents should check off tasks as they complete them and add links to PRs/issues.

How to use
- Create small PRs per task or tightly related sub-tasks
- Reference the task ID in PR titles/descriptions (e.g., "M1.2: add zod schemas")
- Check the box when merged; paste PR link under the task
- Keep acceptance criteria boxes honest; only check when met

Legend
- [ ] unchecked = not done
- [x] checked = done
- Use the per-task "Notes/Links" line for PRs, issues, or context

Milestone index
- [ ] M0 — Baseline hygiene and guardrails
- [ ] M1 — API response validation and fetch hardening
- [ ] M2 — AudioContext race condition and worklet loading safety
- [ ] M3 — Timer, event, and async cleanup
- [ ] M4 — Helper process lifecycle and integrity
- [ ] M5 — CSP and BrowserWindow security hardening
- [ ] M6 — Refactor `src/main.ts` into cohesive modules
- [ ] M7 — Refactor `src/components/Onboarding.tsx`
- [ ] M8 — Audio streaming and compression (feature-flagged)
- [ ] M9 — Menu logic deduplication and constants
- [ ] M10 — Test and CI foundation

---

### Multi-worktree and Parallel Agents Plan

Goal: Enable multiple agents to work in parallel across different worktrees with minimal conflicts and maximum throughput.

What to land first
- Land M0 on `main`, then branch worktrees from that commit.
- Optional but recommended: M6a skeleton split (extract only `src/main/processes/helperManager.ts`, `src/main/csp.ts`, `src/main/windows.ts`) so main-process work happens in isolated files.

Parallel workstreams (run these in parallel; sequence items within each stream)
- A — API hardening: A1 (M1 API client + schemas) → A2 (M2 AudioContext manager). Then G1 (M8 streaming) behind a flag
- B — Timer/event cleanup: B1 (M3 timers/listeners cleanup in `src/components/App.tsx` and hooks)
- C — Onboarding refactor: C1 (M7 modularization of `src/components/Onboarding.tsx`; avoid `useTranscription` edits)
- D — Main-process stability/security: D0 (M6a skeleton) → D1 (M4 helper manager) → D2 (M5 CSP/preload hardening) → D3 (M6 extractions)
- E — Tests/CI foundation: E1 (M10). This stream is the sole owner of dependency changes
- F — Menus & constants: F1 (M9 after D3, or target new `menus/*` files once available)

Start order for maximum parallelism
1) Land M0 (and optional M6a). 2) Start A1, B1, C1, D1 (or D0→D1), and E1 together. 3) After A1 → do A2 → then G1. 4) After D1/D2 → do D3 → then F1.

Worktree and branch naming
- Worktrees: `wt-audio`, `wt-cleanup`, `wt-onboarding`, `wt-mainproc`, `wt-tests`, `wt-menus`, `wt-streaming`
- Branches:
  - A: `feature/m1-api-client` → `feature/m2-audioctx`
  - B: `chore/m3-timer-cleanup`
  - C: `refactor/m7-onboarding-split`
  - D: `refactor/m6a-main-skeleton` → `feature/m4-helper-manager` → `security/m5-csp` → `refactor/m6-main-extractions`
  - E: `infra/m10-tests-ci`
  - F: `refactor/m9-menu-dedup`
  - G: `feature/m8-audio-streaming`

Conflict hotspots and how to avoid them
- `src/main.ts` — mitigate by doing M6a early; then work inside extracted modules
- `src/hooks/useTranscription.ts` — touched by M1, M2, M8; sequence A1 → A2 → G1; no other streams touch it
- `package.json`/lockfile — single owner (E1). Others request deps via E or rebase after E lands
- `preload.ts` — owned by D2 until merged
- `src/types/*`, `tsconfig.json`, ESLint/rules — avoid parallel edits; single owner per change set
- Avoid repo-wide formatting or large renames during the parallelization phase

What causes merge conflicts here
- Concurrent edits to the same areas of `src/main.ts` or `src/hooks/useTranscription.ts`
- Multiple streams adding deps to `package.json`/lockfile
- Changing shared exports/types used widely in `src/types/*`
- Parallel edits to `preload.ts`
- Mass formatting/renames while other branches are active

Coordination rules
- One owner per hotspot file at a time
- Small, focused PRs that merge quickly; feature-flag risky changes
- Daily rebases on `main` to reduce conflict drift
- No drive-by refactors outside your stream’s scope
- Keep shared types/configs stable unless your stream owns that change

Merge strategy
- Protect `main` with required checks from E’s CI
- Prefer rebase over merge commits on feature branches
- Use a short-lived `staging` branch to integrate D (main-process) changes if many streams are active, then fast-forward `main`

ELI5 (why this plan helps)
- Think of the codebase as rooms in a house. We assign agents to different rooms so they don’t bump into each other. We avoid everyone painting the hallway (`src/main.ts`) at the same time by first adding doors (M6a skeleton) so each room is separate. Only one person edits the toolbox (`package.json`) so tools don’t go missing.

---

### M0 — Baseline hygiene and guardrails
Objective: Add guardrails so subsequent changes are safer and consistent.

- [ ] M0.1 Add `API_BASE_URL` env and `src/config/app.ts` to centralize URLs and app constants
  - Notes/Links:
- [ ] M0.2 Tighten ESLint/Prettier with minimal high-impact rules (e.g., no-floating-promises)
  - Notes/Links:
- [ ] M0.3 Add `ErrorBoundary` at app root and wrap root render
  - Notes/Links:
- [ ] M0.4 Add commit hooks (lint-staged) and Conventional Commits
  - Notes/Links:

Acceptance criteria
- [ ] App builds and runs unchanged; env var controls API host
- [ ] Errors render a friendly fallback UI (no white screens)

Rollback
- [ ] Revert new config files and root wrapper if regressions occur

---

#### ELI5 — What are we changing in M0 and what to test
- In plain terms: We add a safety net (error screen), centralize settings (API URL), and basic rules so mistakes are caught early.
- Changes: New config file, stricter lint rules, an ErrorBoundary wrapper, and commit hooks.
- Test:
  - Launch app normally (nothing should look different).
  - Temporarily throw an error in a component and confirm a friendly error UI appears.
  - Change API host via env; confirm network calls go to the new host.

---

### M1 — API response validation and fetch hardening
Objective: Validate and sanitize all external API responses; unify fetch behavior.

- [ ] M1.1 Create `src/services/apiClient.ts` with `fetchJson` wrapper (timeout, retries/backoff)
  - Notes/Links:
- [ ] M1.2 Add schema validation (e.g., zod) for responses (e.g., `TranscriptionResult`)
  - Notes/Links:
- [ ] M1.3 Replace direct fetches in `src/hooks/useTranscription.ts` with `apiClient`
  - Notes/Links:
- [ ] M1.4 Sanitize strings before UI insertion or OS paste/clipboard
  - Notes/Links:
- [ ] M1.5 Add feature flag to fall back to legacy fetch path
  - Notes/Links:

Acceptance criteria
- [ ] Malformed payloads are rejected with controlled errors
- [ ] Network failures are surfaced with consistent error objects

Rollback
- [ ] Toggle feature flag to restore old fetch path

---

#### ELI5 — What are we changing in M1 and what to test
- In plain terms: We stop trusting the internet blindly. We check that responses match the shape we expect.
- Changes: New API client wrapper, schemas to validate server responses, sanitized text before UI/clipboard.
- Test:
  - Simulate a bad payload (dev server or mock) and verify a clear error is shown, not a crash.
  - Verify successful payload updates UI and paste behavior still works.
  - Kill the network and confirm retries/backoff happen and user feedback is reasonable.

---

### M2 — AudioContext race condition and worklet loading safety
Objective: Ensure a single, well-lifecycle-managed `AudioContext` and safe worklet loading.

- [ ] M2.1 Create `src/utils/AudioContextManager.ts` with async init lock and lifecycle methods
  - Notes/Links:
- [ ] M2.2 Idempotent `addModule` for `public/audioworklet-processor.js`
  - Notes/Links:
- [ ] M2.3 Replace direct AudioContext creation in `useTranscription.ts` with manager
  - Notes/Links:
- [ ] M2.4 Validate/whitelist worklet URL and ensure local packaging
  - Notes/Links:

Acceptance criteria
- [ ] No multiple AudioContexts under rapid toggles
- [ ] Worklet loads once and is reused safely

Rollback
- [ ] Feature flag to fall back to current inline creation path

---

#### ELI5 — What are we changing in M2 and what to test
- In plain terms: Make sure we only create one microphone engine and load its plugin once.
- Changes: A manager that prevents double-creation and safely loads the audio worklet.
- Test:
  - Rapidly toggle transcription on/off; verify no errors and only one AudioContext exists (devtools logging).
  - Confirm audio still transcribes; CPU usage remains stable.

---

### M3 — Timer, event, and async cleanup
Objective: Eliminate memory leaks and orphaned timers/listeners.

- [ ] M3.1 Add `useTimeout` and `useInterval` hooks with auto-cleanup
  - Notes/Links:
- [ ] M3.2 Replace scattered timeouts/intervals in `src/components/App.tsx`
  - Notes/Links:
- [ ] M3.3 Wrap async effects with `AbortController` and standardize cleanups
  - Notes/Links:
- [ ] M3.4 Audit event listeners; ensure add/remove are balanced
  - Notes/Links:

Acceptance criteria
- [ ] No leaked timers in unmount scenarios
- [ ] No stale state updates after unmount

Rollback
- [ ] Revert targeted hook adoptions individually if regressions occur

---

#### ELI5 — What are we changing in M3 and what to test
- In plain terms: We tidy up clocks and listeners so they don’t keep running after the screen changes.
- Changes: Standard hooks for timeouts/intervals; abortable async patterns.
- Test:
  - Navigate away/unmount components while timers run; ensure no warnings about updates on unmounted components.
  - Watch memory while toggling views; verify it doesn’t creep upward.

---

### M4 — Helper process lifecycle and integrity
Objective: Ensure spawned helper processes are correctly managed and verified.

- [ ] M4.1 Create `src/main/processes/helperManager.ts` to centralize spawn/kill/track
  - Notes/Links:
- [ ] M4.2 Terminate children on `app.before-quit`, `window-all-closed`, and error paths
  - Notes/Links:
- [ ] M4.3 Add integrity check (codesign/SHA-256 in release) with clear error on failure
  - Notes/Links:
- [ ] M4.4 Add logging/metrics counters for spawn/kill events
  - Notes/Links:

Acceptance criteria
- [ ] No zombie children after app exit
- [ ] Integrity failures block execution with a clear message

Rollback
- [ ] Feature flag to bypass integrity checks if needed

---

#### ELI5 — What are we changing in M4 and what to test
- In plain terms: When we start our tiny helper app, we make sure it’s the real one and we always close it when we’re done.
- Changes: Central manager, integrity verification, and guaranteed cleanup on quit/crash.
- Test:
  - Launch and quit the app; confirm no zombie processes via Activity Monitor.
  - Corrupt or mismatch helper (in a controlled env) to see a clear error.

---

### M5 — CSP and BrowserWindow security hardening
Objective: Minimize attack surface without breaking dev flow.

- [ ] M5.1 Split dev vs prod CSP; remove `'unsafe-eval'` in prod
  - Notes/Links:
- [ ] M5.2 Limit `connect-src` to `self` and configured API hosts
  - Notes/Links:
- [ ] M5.3 Verify BrowserWindow options (`contextIsolation`, `sandbox`, `nodeIntegration`)
  - Notes/Links:
- [ ] M5.4 Audit and minimize `preload.ts` exposed API surface
  - Notes/Links:

Acceptance criteria
- [ ] App works in dev; prod CSP rejects unexpected connections/scripts

Rollback
- [ ] Slightly expand CSP in dev only; keep prod locked down

---

#### ELI5 — What are we changing in M5 and what to test
- In plain terms: We lock the doors and only allow our app to talk to our servers.
- Changes: Stricter Content Security Policy; safer BrowserWindow/preload defaults.
- Test:
  - Dev: App still runs; hot reload works.
  - Prod build: Only allowed network calls succeed; unexpected scripts are blocked.

---

### M6 — Refactor `src/main.ts` into cohesive modules
Objective: Reduce a ~2k-line file into focused modules without behavior change.

- [ ] M6.1 Extract `appLifecycle.ts`
  - Notes/Links:
- [ ] M6.2 Extract `ipc.ts`
  - Notes/Links:
- [ ] M6.3 Extract `trayMenu.ts`
  - Notes/Links:
- [ ] M6.4 Extract `pillMenu.ts`
  - Notes/Links:
- [ ] M6.5 Extract `permissions.ts`
  - Notes/Links:
- [ ] M6.6 Extract `windows.ts`
  - Notes/Links:
- [ ] M6.7 Integrate `processes/helperManager.ts` (from M4)
  - Notes/Links:
- [ ] M6.8 Extract `csp.ts`
  - Notes/Links:

Acceptance criteria
- [ ] No regressions; `main.ts` becomes a thin orchestrator

Rollback
- [ ] Revert individual extractions if any regression occurs

---

#### ELI5 — What are we changing in M6 and what to test
- In plain terms: We split one giant file into labeled folders so it’s not a spaghetti bowl.
- Changes: Move code into `main/*` files; keep behavior identical.
- Test:
  - Smoke test: app launches, tray/pill menus, onboarding, transcription.
  - Verify logs and IPC still function as before.

---

### M7 — Refactor `src/components/Onboarding.tsx`
Objective: Split a ~1.1k-line component into modular steps with a clearer flow.

- [ ] M7.1 Create `src/components/onboarding/OnboardingRoot.tsx`
  - Notes/Links:
- [ ] M7.2 Extract step components under `src/components/onboarding/steps/`
  - Notes/Links:
- [ ] M7.3 Create `state/onboardingMachine.ts` (or reducer) to centralize transitions
  - Notes/Links:
- [ ] M7.4 Move permission logic to `src/services/permissions.ts`
  - Notes/Links:
- [ ] M7.5 Wrap with `ErrorBoundary` and add minimal snapshot/component tests
  - Notes/Links:

Acceptance criteria
- [ ] Visual behavior unchanged; code is modular and easier to reason about

Rollback
- [ ] Revert step extraction order-by-order if needed

---

#### ELI5 — What are we changing in M7 and what to test
- In plain terms: We break a huge screen into smaller Lego pieces without changing how it looks.
- Changes: New components for steps; a small state manager for transitions; permission logic moved to a service.
- Test:
  - Run onboarding end-to-end; visuals and steps should be identical.
  - Test all permission paths using `test-permission-scenarios.sh`.

---

### M8 — Audio streaming and compression (feature-flagged)
Objective: Reduce memory and bandwidth by streaming and compressing audio.

- [ ] M8.1 Add `AUDIO_STREAMING_ENABLED` feature flag
  - Notes/Links:
- [ ] M8.2 Implement chunked buffering with rolling window to cap memory
  - Notes/Links:
- [ ] M8.3 Implement streaming transport (WebSocket or chunked HTTP with backpressure)
  - Notes/Links:
- [ ] M8.4 Add optional encoder (e.g., Opus/FLAC) in worklet/WASM; measure CPU/memory
  - Notes/Links:
- [ ] M8.5 Update `apiClient` to support streaming endpoints with graceful fallback
  - Notes/Links:

Acceptance criteria
- [ ] Memory usage no longer grows with long sessions
- [ ] Observable network savings when compression enabled

Rollback
- [ ] Disable feature flag to restore current behavior immediately

---

#### ELI5 — What are we changing in M8 and what to test
- In plain terms: Instead of saving a big bucket of sound then sending it, we send small sips continuously and optionally squeeze them smaller.
- Changes: Streaming transport, rolling buffer to cap memory, optional codec.
- Test:
  - Long session transcription: memory stays stable.
  - Toggle feature flag on/off to compare network usage and behavior.

---

### M9 — Menu logic deduplication and constants
Objective: DRY pill/tray menus and replace magic numbers with shared tokens.

- [ ] M9.1 Create `src/main/menus/buildMenu.ts` for shared builders
  - Notes/Links:
- [ ] M9.2 Replace duplicated tray/pill menu logic with shared function
  - Notes/Links:
- [ ] M9.3 Add/normalize constants in `src/config/uiTokens.ts` (e.g., `180ms`, `2000ms`)
  - Notes/Links:

Acceptance criteria
- [ ] Same menu behavior; fewer divergent code paths; no scattered magic numbers

Rollback
- [ ] Revert per menu if any regression

---

#### ELI5 — What are we changing in M9 and what to test
- In plain terms: We make one menu recipe instead of two similar ones, and we give names to mystery numbers.
- Changes: Shared menu builder; timing constants in `uiTokens`.
- Test:
  - Menus show the same items and actions as before in tray and pill.

---

### M10 — Test and CI foundation
Objective: Establish automated tests and CI with quick wins on critical paths.

- [ ] M10.1 Add Vitest for unit tests and Playwright for E2E
  - Notes/Links:
- [ ] M10.2 Seed unit tests: `apiClient` schemas and `AudioContextManager`
  - Notes/Links:
- [ ] M10.3 Seed unit tests: onboarding state transitions / permissions logic
  - Notes/Links:
- [ ] M10.4 Add one Playwright E2E: launch → onboarding happy path → pill toggle
  - Notes/Links:
- [ ] M10.5 GitHub Actions: lint + unit + E2E; cache deps; artifacts on failure
  - Notes/Links:
- [ ] M10.6 Add CodeQL and Dependabot
  - Notes/Links:

Acceptance criteria
- [ ] CI green; PRs blocked on lint/test; basic E2E reliable locally/CI

Rollback
- [ ] Keep existing manual scripts (`test-onboarding.sh`, `test-permission-scenarios.sh`) as fallback

---

#### ELI5 — What are we changing in M10 and what to test
- In plain terms: We teach robots to double-check our work every time we change something.
- Changes: Unit tests, one E2E, CI workflow, CodeQL, Dependabot.
- Test:
  - CI pipeline runs on PRs: lint, unit, E2E; all green.
  - Flaky tests addressed until reliable.

---
Cross-cutting trackers

- [ ] FF.1 Feature flags documented (`AUDIO_STREAMING_ENABLED`, fetch hardening, integrity checks)
  - Notes/Links:
- [ ] DOC.1 Update `README` and add `CONTRIBUTING.md` for new scripts/flows
  - Notes/Links:
- [ ] SEC.1 Add `SECURITY.md` summarizing CSP, integrity checks, and reporting
  - Notes/Links:
- [ ] OBS.1 Optional lightweight telemetry counters (spawn/kill, streaming enabled, crashes)
  - Notes/Links:

Changelog (append entries at the top)
- YYYY-MM-DD: Created task board and initial milestone/task list


