# Open-Source Refactor Plan

## Status

This document is the execution plan for converting Spoke from a hosted, auth-gated product into a **local-first, open-source desktop app** with **optional cloud providers**.

It is intentionally opinionated:

- Keep **Electron** for the refactor.
- Make **local inference** the first-class path.
- Treat **cloud STT/LLM** as optional adapters.
- Remove **Supabase, Dodo, quota, and worker coupling** from the core UX.
- Re-evaluate **Tauri** only after the architecture is clean.

Do **not** start by rewriting the shell in Tauri or Electrobun. The current bottleneck is architecture, not Electron itself.

---

## Decision Summary

### Product Direction

The target app is:

- **macOS-first**
- **No required account**
- **No required hosted backend**
- **Local dictation/edit/history by default**
- **Optional cloud providers via user-supplied API keys**
- **Open-source friendly** in both runtime model and repo structure

### Shell Direction

The shell decision for the refactor is:

- **Now**: stay on Electron
- **Later**: compare Electron vs Tauri once the app core and provider contracts are extracted
- **Avoid**: Electrobun for this migration; it adds runtime/platform risk while the app is already undergoing a large architectural split

### Local Inference Direction

The local inference decision for the refactor is:

- Use **MLX** for Apple Silicon local STT
- Treat model weights as **optional runtime assets**, not repo contents
- Support a **download/install/bootstrap** flow inside the app
- Allow the initial public release to use a **Python MLX sidecar** if it is packaged cleanly and works on a fresh machine

---

## Current-State Findings

### What Already Exists

- There is already a real local STT branch in `src/hooks/useTranscription.ts`.
- There is already an MLX sidecar and converted model code in `local-stt/`.
- The worker already contains reusable prompt/routing/provider abstraction that should be preserved conceptually.
- The native macOS integration is already strong: tray, global shortcut, click-through pill, helper-based paste, permissions, and updater flow.

### What Is Not Actually Productized Yet

- The current local path expects `local-stt/.venv/bin/python` inside the app path.
- `local-stt/.venv/` and `local-stt/weights/` are ignored from git.
- The current Forge config does not package a usable local runtime.
- Therefore the local MLX path is a **dev integration**, not a shippable feature yet.

### Where the Coupling Lives

The current app is tightly coupled in a few oversized files:

- `src/main.ts`
- `src/components/App.tsx`
- `src/components/Onboarding.tsx`
- `src/components/SettingsPanel.tsx`
- `src/lib/supabaseClient.ts`
- `src/hooks/useTranscription.ts`

The current hot path also assumes hosted services:

- auth/session bootstrap
- quota sync
- payment/subscription state
- worker `/prepare` and `/transcribe`
- website billing portal

---

## Refactor Principles

1. **No shell rewrite first**
   Keep Electron while removing architectural coupling.

2. **No big-bang rewrite**
   Extract seams, keep the app working, then delete legacy systems.

3. **No auth in the hot path**
   Dictation must not depend on sign-in.

4. **Local-first by default**
   Cloud is an adapter, not the center of the design.

5. **Package runtime assets explicitly**
   Never rely on repo-local `.venv`, ignored weights, or dev-only paths.

6. **Prefer modular extraction before dependency removal**
   First move logic behind interfaces, then remove Supabase/worker/billing code.

7. **Keep PRs bite-sized**
   Every step below should be implementable as a focused, reviewable change.

---

## Target V1 Scope

### In Scope

- macOS app
- Push-to-talk dictation
- Edit mode using current selection
- Local transcription history
- Local STT install/download management
- Optional cloud STT/LLM via BYO API keys
- Native paste via helper
- Tray, shortcut, floating bar, updater
- Basic provider diagnostics and settings

### Out of Scope

- Required sign-in
- Free tier quotas
- Subscription billing
- Dodo portal and checkout
- Supabase-backed profiles and onboarding persistence
- Server-authoritative gating
- Cross-device sync
- Cross-platform parity
- Tauri migration during the initial refactor

### Recommended Deferrals

Defer these until the local-first architecture is stable:

- OCR screen context in v1, unless it can be cleanly reintroduced as a separate provider capability
- Hosted Spoke cloud as a default option
- Any multi-user or team telemetry features

---

## Target Architecture

### High-Level Flow

```text
Renderer UI
  -> Session Orchestrator
    -> Provider Registry
      -> Local STT Provider (MLX sidecar)
      -> Cloud STT Provider(s)
    -> Optional LLM Provider
    -> Native Insert Service
    -> Local History Store
```

### Architectural Layers

#### 1. Core Domain

Owns:

- transcription session orchestration
- mode handling (`dictation`, `edit`)
- provider selection
- generic errors and capabilities
- prompt/routing logic that is not transport-specific

Must not know about:

- Supabase
- Dodo
- Cloudflare Worker
- Electron-specific IPC details

#### 2. Provider Adapters

Own:

- local MLX sidecar lifecycle and health
- cloud STT requests
- cloud LLM requests
- provider-specific config validation

Must implement shared contracts from the core layer.

#### 3. Platform Services

Own:

- global shortcut
- permissions
- screenshots
- selection inspection
- native paste
- tray
- updater
- secret storage / Keychain access

#### 4. Renderer Features

Own:

- onboarding/setup UX
- settings UX
- pill state machine
- provider selection UI
- model install UX
- history UI

Must consume services/contracts, not call backend-specific logic directly.

---

## Recommended Folder Structure

Do **not** introduce a monorepo or workspace split in the first pass. First make the current repo modular.

### Near-Term Target

```text
src/
  core/
    transcription/
      sessionOrchestrator.ts
      providerContracts.ts
      sessionErrors.ts
      sessionTypes.ts
    prompts/
      routeTranscript.ts
      buildSttPrompt.ts
      editPrompt.ts
    config/
      providerCapabilities.ts

  providers/
    local/
      modelManager.ts
      sidecarClient.ts
      localSttProvider.ts
      runtimePaths.ts
      manifests.ts
    cloud/
      cloudSttProvider.ts
      cloudLlmProvider.ts
      providerRegistry.ts
      keychainStore.ts

  main/
    app/
      bootstrap.ts
    windows/
      mainWindow.ts
      onboardingWindow.ts
    tray/
      trayController.ts
    shortcuts/
      pttController.ts
    permissions/
      permissionController.ts
    nativeHelper/
      insertText.ts
      selectionInspect.ts
    localEngine/
      sidecarLifecycle.ts
      sttIpc.ts
    updates/
      updateController.ts

  preload/
    index.ts
    bridges/
      sttBridge.ts
      providerBridge.ts
      permissionsBridge.ts

  renderer/
    app/
      AppShell.tsx
    features/
      transcription/
      onboarding/
      settings/
      history/
    components/
      ui/
    state/
      localProfile.ts
      transcriptionHistory.ts

  shared/
    ipc/
    types/
```

### Deferred Structure

If the extracted contracts stabilize, then optionally split `src/core` and `src/providers` into publishable internal packages later.

---

## Phase Plan

## Phase 0: Freeze the Product Contract

### Goal

Make a few high-leverage decisions before coding the extraction.

### Tasks

- Confirm the target release is **macOS-only**.
- Confirm the initial open-source release has **no required login**.
- Confirm the first supported local STT path is **MLX + Moonshine**.
- Decide whether v1 includes:
  - local-only
  - local + BYO cloud keys
  - local + BYO cloud keys + optional hosted Spoke provider
- Decide whether OCR is:
  - deferred
  - local-only
  - cloud-only optional
- Decide whether the first local runtime is:
  - packaged Python sidecar
  - downloaded Python runtime
  - compiled sidecar wrapper

### Acceptance Criteria

- One approved architecture doc
- One approved v1 scope
- One approved local runtime strategy

---

## Phase 1: Extract Core Seams Without Changing Product Behavior

### Goal

Separate orchestration from transport/auth/billing without breaking the current app.

### Tasks

- Introduce `TranscriptionProvider`, `LlmProvider`, `SessionOrchestrator`, and `ProviderCapability`.
- Move reusable routing/prompt logic out of worker-shaped code and into `src/core`.
- Refactor `src/hooks/useTranscription.ts` to call provider adapters instead of embedding local/cloud branches directly.
- Add generic session errors:
  - `provider_not_configured`
  - `provider_unavailable`
  - `model_not_installed`
  - `permission_required`
  - `network_error`
  - `transcription_failed`
- Keep the old cloud path working through a compatibility adapter.
- Add unit tests around orchestrator behavior and provider selection.

### Suggested PR Slices

- PR 1: add core contracts and types
- PR 2: move prompt/routing logic into `src/core`
- PR 3: wrap existing local path behind `LocalSttProvider`
- PR 4: wrap existing worker path behind `LegacyCloudProvider`
- PR 5: refactor `useTranscription` to orchestrator usage

### Acceptance Criteria

- `useTranscription` no longer owns provider branching logic
- session flow can switch providers through contracts
- existing local/cloud behavior still works in development

---

## Phase 2: Productize the Local MLX Runtime

### Goal

Turn the current dev-only MLX path into a clean, installable feature.

### Tasks

- Introduce a `LocalModelManager`.
- Move runtime assets to app-owned locations under `app.getPath("userData")`.
- Define a model manifest format:
  - model id
  - version
  - tokenizer checksum
  - weights checksum
  - download URLs
  - expected size
- Add model installation states:
  - `not_installed`
  - `downloading`
  - `installing`
  - `ready`
  - `broken`
  - `updating`
- Add sidecar lifecycle management:
  - boot
  - warm-up
  - health check
  - shutdown
  - restart on failure
- Add progress events from main to renderer.
- Add settings UI for:
  - install model
  - remove model
  - show size/path/version
  - show health/errors
- Stop depending on `local-stt/.venv/bin/python`.
- Ensure packaged builds can install and run local STT on a clean machine.

### Recommended Implementation Order

1. runtime paths and install manifest
2. sidecar packaging/bootstrap strategy
3. sidecar health checks
4. renderer install UX
5. smoke tests on a clean machine

### Acceptance Criteria

- local STT works in a packaged build with no repo checkout
- no runtime dependency on ignored repo files
- enabling local STT from settings succeeds on a clean machine

---

## Phase 3: Add Optional Cloud Providers

### Goal

Make cloud usage optional and independent of any Spoke-managed auth system.

### Tasks

- Introduce a cloud provider registry.
- Support BYO provider credentials stored locally.
- Prefer Keychain-backed secret storage.
- Port cloud STT/LLM logic into direct provider adapters.
- Preserve reusable prompt/routing logic from the worker.
- Add settings UI for:
  - provider selection
  - API key entry
  - connectivity test
  - preferred STT provider
  - preferred LLM provider
- Replace worker-specific transport assumptions with direct provider calls or a thin optional proxy adapter.

### Acceptance Criteria

- user can dictate without signing in
- user can choose `Local`, `Cloud`, or `Auto`
- cloud usage requires only provider config, not app auth

---

## Phase 4: Remove Auth/Billing from Core UX

### Goal

Make startup, onboarding, and settings local-first instead of account-first.

### Tasks

- Rewrite onboarding around:
  - permissions
  - microphone selection
  - provider selection
  - model install
  - first dictation test
- Remove auth-first onboarding steps.
- Remove quota and upgrade flows from settings.
- Replace account state with a lightweight local profile/preferences model.
- Remove session sync from startup.
- Remove auth polling, JWT refresh, and sign-in toasts from the main app path.

### Acceptance Criteria

- app launches into a usable local-first setup flow
- dictation is available with no account
- account state no longer controls core availability

---

## Phase 5: Delete Legacy Hosted Architecture

### Goal

Remove systems that no longer belong in the product.

### Tasks

- Remove worker-backed production dependency from the desktop app.
- Delete or archive:
  - `worker/`
  - Supabase auth/session integration
  - Dodo billing integration
  - quota and entitlement logic
- Rewrite documentation to match the new architecture.
- Remove dead dependencies from `package.json`.
- Remove environment variables that only exist for the hosted flow.

### Acceptance Criteria

- desktop app has no required dependency on worker, Supabase, or Dodo
- docs no longer describe hosted auth/billing as core architecture
- build/test scripts no longer assume the worker is required

---

## Phase 6: Re-Evaluate the Shell

### Goal

Only after the core logic is modular, decide whether Electron remains the right shell.

### Decision Inputs

Compare Electron and Tauri on:

- click-through floating overlay support
- tray/menu behavior
- global shortcut reliability
- native helper integration
- screenshot capture
- updater maturity
- packaging/notarization complexity
- overall bundle size after local model install is externalized

### Exit Rule

Do not begin a shell migration unless:

- the provider/orchestrator contracts are stable
- the renderer is mostly shell-agnostic
- the main-process logic is already modular

---

## Bite-Sized Backlog

These are the recommended first implementation tickets.

1. Add `src/core/transcription/providerContracts.ts`.
2. Add `src/core/transcription/sessionErrors.ts`.
3. Move routing logic out of worker-shaped code into `src/core/prompts/`.
4. Wrap the current local STT path behind `LocalSttProvider`.
5. Wrap the current worker path behind `LegacyCloudProvider`.
6. Refactor `useTranscription` to use an orchestrator.
7. Split local sidecar lifecycle out of `src/main.ts`.
8. Add `runtimePaths.ts` for installable local model assets.
9. Add a model manifest and checksum validation.
10. Add model install status IPC.
11. Add settings UI for install/remove/health.
12. Add Keychain-backed secret storage for cloud provider keys.
13. Add a cloud provider config screen.
14. Rewrite onboarding around permissions + provider selection.
15. Remove quota and account UI from settings.
16. Remove auth/bootstrap logic from `App.tsx`.
17. Delete or archive legacy hosted docs and code.

---

## Migrate/Delete Matrix

| Current Area | Action | Target | Phase |
|---|---|---|---|
| `src/hooks/useTranscription.ts` | Split orchestration from provider logic | `src/core/transcription/` + `src/providers/` | 1 |
| `src/main.ts` | Split by responsibility, keep shell | `src/main/*` modules | 1-2 |
| `src/preload.ts` | Split bridges by feature | `src/preload/bridges/*` | 1-2 |
| `src/components/App.tsx` | Remove auth/bootstrap coupling | `src/renderer/app/` + feature modules | 4 |
| `src/components/Onboarding.tsx` | Rewrite around setup/provider flow | `src/renderer/features/onboarding/` | 4 |
| `src/components/SettingsPanel.tsx` | Replace account/quota UI with provider/model UI | `src/renderer/features/settings/` | 2-4 |
| `src/lib/supabaseClient.ts` | Delete or archive after removal of auth | local profile/preferences + secret storage | 4-5 |
| `src/lib/sessionSync.ts` | Delete | no replacement needed | 4 |
| `src/state/userIdentity.ts` | Replace | local profile/preferences state | 4 |
| `src/state/quotaCache.ts` | Delete | no replacement needed | 4 |
| `worker/src/pipeline/router.ts` | Migrate reusable routing logic | `src/core/prompts/routeTranscript.ts` | 1 |
| `worker/src/pipeline/enhance.ts` | Migrate provider-agnostic orchestration ideas | `src/providers/cloud/` + `src/core/prompts/` | 1-3 |
| `worker/src/pipeline/transcribe.ts` | Rebuild as provider adapter logic | `src/providers/cloud/stt/` | 3 |
| `worker/src/handlers/http.ts` | Delete after cloud adapters exist | none | 5 |
| `worker/` | Archive or remove | optional separate self-hosted package if needed | 5 |
| `local-stt/sidecar.py` | Keep, but package/runtime-manage properly | `src/providers/local/` + packaged/runtime assets | 2 |
| `local-stt/moonshine_mlx.py` | Keep, validate, benchmark | local provider runtime | 2 |
| `local-stt/weights/` | Keep out of git, move to runtime install assets | app data install path | 2 |
| `docs/LOCAL_STT.md` | Rewrite for packaged local runtime reality | updated local runtime doc | 2 |
| `docs/TRANSCRIPTION.md` | Rewrite around local-first + optional cloud providers | updated transcription doc | 5 |
| `docs/AUTH.md` | Archive/remove | none | 5 |
| `docs/PAYMENTS.md` | Archive/remove | none | 5 |
| `docs/DATABASE.md` | Archive/remove | none | 5 |

---

## Risks and Constraints

### 1. Local Model Distribution

Current local weights are large, and the current runtime bootstrap is not shippable. This is the most important operational gap.

### 2. Python Runtime Packaging

Using Python MLX for v1 is acceptable only if installation and update behavior are explicit and reliable. A compiled wrapper may still be needed later.

### 3. Native Edit/Selection UX

Edit mode depends on the helper, selection inspection, and macOS permissions. That path should be preserved carefully while auth code is being removed.

### 4. Oversized Files

The main risk in this refactor is accidental breakage caused by editing giant files in place. Modular extraction must happen early.

### 5. OCR Scope

OCR currently rides on the hosted path. Reintroducing it should be treated as a separate capability, not bundled into the first local-first milestone.

---

## Success Criteria

The refactor is successful when:

- a new user can install the app and dictate without creating an account
- local MLX transcription works in a packaged build on a clean machine
- cloud providers are optional and configured locally
- auth, quota, and billing no longer control core usability
- the codebase is organized around providers and platform services instead of one-off product-era flows
- Electron can be kept or replaced without rewriting the transcription core

---

## Recommended Immediate Next Step

Start with **Phase 1** and do not touch the shell runtime choice yet.

The first concrete coding move should be:

1. add provider/session contracts
2. extract session orchestration out of `useTranscription`
3. wrap the current local and current hosted flows behind adapters

That creates the seam the rest of the migration depends on.
