# Spoke Ship TODO

Goal: ship a dogfoodable open-source macOS dictation app with reliable local Whisper transcription first. Everything else is optional until the packaged app can install, update, and dictate consistently.

## Current Product Truth

- Local dictation works with `mlx-community/whisper-large-v3-turbo-4bit`.
- Local model install works in development.
- Cloud transcription can be optional via user-provided API keys.
- LLM cleanup, edit mode, meta-directives, and screen/OCR context are not core shipping promises yet.
- Auth is removed and should not come back for the open-source app.
- Model weights are downloaded after install; they should not be bundled in the app.

## P0: Dogfoodable Packaged App

- [x] Package a signed macOS arm64 app.
- [x] Verify packaged app launches without repo files or local Python.
- [x] Verify bundled `spoke-stt` sidecar starts from packaged resources.
- [ ] Verify first-run local model install from Settings/onboarding.
- [x] Verify model status persists across app restart.
- [ ] Verify local dictation works after model install.
- [ ] Verify local dictation fails cleanly before model install.
- [ ] Verify model removal stops the sidecar and prevents local dictation.
- [ ] Verify permissions flow on a clean macOS account.
- [ ] Verify onboarding can complete on a clean macOS account.
- [ ] Verify crash-free app quit/relaunch after onboarding.
- [ ] Verify notarization and stapling.

Packaged smoke result, 2026-05-20:

- `npm run package` produced `out/Spoke-darwin-arm64/Spoke.app`.
- `codesign --verify --deep --strict --verbose=2 out/Spoke-darwin-arm64/Spoke.app` passed.
- Main app and bundled `Contents/Resources/spoke-stt` are signed with Developer ID Application `Sandheep Rajkumar (LSDG748BBP)`.
- `spctl --assess --type execute --verbose=4 out/Spoke-darwin-arm64/Spoke.app` failed with `source=Unnotarized Developer ID`; notarization is still required.
- Copied app to `/tmp/spoke-p0-app/Spoke.app` and launched with `--user-data-dir=/tmp/spoke-p0-user-data`; app loaded resources from `/private/tmp/spoke-p0-app`, not the repo.
- Clean temp user data started with `ModelManager` state `not_installed`; copied installed model state restarted with `ModelManager` state `ready`.
- Direct packaged sidecar smoke loaded `/tmp/spoke-p0-user-data/local-stt/weights` and emitted `{"type":"ready"}` without user Python.
- Idle packaged app did not leave `spoke-stt` running; quit cleanup left no packaged Spoke, hotkey helper, or sidecar processes.

Dogfood gate:

- [ ] Fresh install can reach working dictation in one session.
- [ ] No auth/login/cloud account required.
- [ ] No broken promise in onboarding.
- [ ] No known local STT crash path.
- [ ] Worktree has no tracked legacy local model/runtime implementation.

## P0: Local Inference Ship Gates

Current local inference truth:

- [x] Production local model is `mlx-community/whisper-large-v3-turbo-4bit`.
- [x] Model files install into app-managed `userData/local-stt/weights`.
- [x] Model install verifies required files and SHA256 checksums before marking ready.
- [x] Sidecar protocol is length-prefixed PCM16 input and structured JSON events output.
- [x] Sidecar emits load/inference/memory metrics.
- [x] Silence does not paste hallucinated text.
- [x] Switching away from local stops the sidecar.
- [x] Removing the model removes files and prevents local transcription.
- [x] Dev and packaged mode use the same installed model layout.
- [x] No fallback local models.
- [x] No renderer-side inference.

Remaining local inference tasks:

- [ ] Fresh checkout can run dev local transcription after installing the Whisper model.
- [ ] Packaged app can install the model and transcribe without user Python.
- [ ] Test packaged app on a clean Mac account without repo files or local Python.
- [ ] Confirm notarization/stapling still works with the sidecar binary.

## P0: First-Run UX

- [x] Gate onboarding on transcription setup before dictation tests.
- [x] Redesign onboarding around local-first product truth.
- [x] Move model install before hotkey tests.
- [x] Keep one simple dictation test.
- [x] Remove or hide edit-mode test until enhancement/edit pipeline is production-ready.
- [x] Remove or hide meta-directives/tricks from onboarding until post-processing is production-ready.
- [x] Make screen recording/OCR context optional, not required.
- [x] Add clear copy: local Whisper is private/offline; cloud is optional with user API keys.
- [ ] Add recovery copy for model install failure and broken model state.
- [ ] Test onboarding with local model already installed.
- [ ] Test onboarding with no model installed.

## P0: Architecture And Cleanup Audit

- [x] Audit remaining auth/login/account code and remove dead paths.
- [x] Audit old cloud-owned endpoints, Cloudflare/R2 assumptions, and private service assumptions.
- [x] Audit prompt/enhancement code and mark it behind explicit provider/config gates.
- [x] Audit OCR/screen-context code and mark it behind explicit context feature gates.
- [x] Audit renderer/main IPC surface for unused local-migration APIs.
- [x] Audit Electron main process file size and extract cohesive modules where it reduces risk.
- [x] Audit sidecar lifecycle boundaries: spawn, queueing, kill, provider switch, app quit.
- [x] Audit provider catalog/selectability behavior when API keys are missing.
- [x] Audit settings/onboarding shared state so provider/model status does not drift.
- [x] Run focused tests for model manager, sidecar engine, provider store, onboarding flow, and transcription providers.

Consolidated audit status:

- [x] Sentry removed from main, renderer, and Vite build configuration for the open-source app.
- [x] Cloud enhancement and OCR are gated off by default.
- [x] Edit mode and meta-directives are hidden from onboarding until the pipeline is real.
- [x] Screen recording is no longer a required first-run permission.
- [ ] Remove Cloudflare-only dependencies after release/update migration is complete.
- [ ] Make sidecar build/signing a documented release prerequisite or package preflight.

Architecture gate:

- [ ] Optional features are off by default and do not affect local dictation.
- [ ] No fallback local models.
- [ ] No renderer-side inference.
- [x] No user-installed Python dependency in packaged builds.
- [ ] No dead feature is advertised in onboarding.

## P0: Startup Bloat Cleanup

Done:

- [x] Remove onboarding music and its bundled audio assets.
- [x] Remove Sentry runtime initialization and Vite build plugins.
- [x] Remove no-op renderer microphone bridge startup listeners.
- [x] Remove dead onboarding resize/vibrancy startup effect.

Deferred cleanup candidates:

- [ ] Split renderer routes so onboarding does not statically import the main app bundle.
- [ ] Split pill panels so collapsed pill does not statically import Settings, Permissions, Models, and History UI.
- [ ] Consider hover/intention preloading for deferred pill panels after measuring the UX tradeoff.
- [ ] Defer model/provider settings calls in onboarding until the model setup step.
- [ ] Defer transcription history loading until the history tab opens or a transcript is saved.
- [ ] Investigate replacing cursor-display polling with display-change/reveal-time synchronization after manual testing.
- [ ] Evaluate whether VAD assets are still needed; remove bundled ONNX/ORT files if the current local pipeline does not use them.

## P1: Local Inference Performance Backlog

- [ ] Re-run a clean pinned-English control after machine cooldown and low background load.
- [ ] Evaluate upstream MLX batched decoding work for long-file throughput only; do not mix it into short dictation unless it improves latency.
- [ ] Evaluate WhisperKit/Core ML as a separate native engine spike if MLX encoder latency remains the wall.
- [ ] Keep production default on pinned `en` unless multilingual UX becomes a hard requirement.
- [ ] Define pass/fail gates for any speed change: no WER regression on benchmark corpus, no hallucination regression on silence/noise, lower mean and P95 wall time, and no meaningful memory increase.

## P1: GitHub Releases Updates And Downloads

Current state:

- `forge.config.ts` publishes update artifacts through Cloudflare R2 using the S3 publisher.
- Immediate `update-electron-app` startup checks were removed to avoid broken launch-time network work.
- `src/main/updateController.ts` fallback checks `https://download.spoke.so/darwin/${process.arch}/RELEASES.json`.
- `src/main.ts` still schedules delayed/manual update checks through `updateController`.
- There is no `.github/workflows` release pipeline yet.

Tasks:

- [ ] Decide update mechanism: `update.electronjs.org` for public GitHub Releases or keep static `RELEASES.json` artifacts attached to releases.
- [ ] Remove Cloudflare R2 publisher config.
- [ ] Add GitHub Actions workflow for signed/notarized macOS arm64 builds.
- [ ] Attach DMG, ZIP, and update metadata to GitHub Releases.
- [ ] Update app updater URLs away from `download.spoke.so`.
- [ ] Verify update from version N to version N+1 using GitHub-hosted artifacts.
- [ ] Verify tray/manual update check behavior.
- [ ] Verify background update checks and error backoff behavior.
- [ ] Update release docs with version bump, signing, notarization, and publish steps.
- [ ] Update website download link to GitHub Releases latest asset.

Update gate:

- [ ] A packaged production build can update from GitHub-hosted release artifacts.
- [ ] A failed update check does not break dictation.
- [ ] Manual reinstall remains acceptable for the initial small user base if migration from old Cloudflare builds is messy.

## P1: Open Source Readiness

- [ ] Pick and add license.
- [ ] Add top-level README with product status, local model install, dev setup, packaging, and release process.
- [ ] Add privacy note explaining local transcription, optional cloud keys, optional analytics if added.
- [ ] Remove or document private assets/services.
- [ ] Scrub `.env` assumptions and document required environment variables.
- [ ] Confirm no secrets or private keys are tracked.
- [ ] Add issue templates for bugs and feature requests.
- [ ] Add contribution notes if accepting external PRs.
- [ ] Add security policy/contact.

## P1: Website

- [ ] Rewrite website positioning for local-first open-source Spoke.
- [ ] Replace Cloudflare R2 download link with GitHub Releases latest download.
- [ ] Add install instructions and macOS permissions explanation.
- [ ] Add privacy/local model explanation.
- [ ] Add roadmap for optional cloud cleanup and context features.
- [ ] Add release notes / changelog link.
- [ ] Add basic website analytics if desired.

## P2: Usage Visibility Without Auth

Recommendation: defer app telemetry until dogfood build and updates are solid. If added, make it privacy-friendly and either opt-in or clearly disclosed.

Options:

- [ ] No app telemetry; use GitHub Release download counts plus website analytics.
- [ ] Add anonymous opt-in app telemetry for install/open/version/update checks only.
- [ ] Use privacy-focused app analytics such as Aptabase, or self-host a tiny endpoint.
- [ ] Never collect transcript text, audio, selected text, API keys, screen contents, or model paths.
- [ ] Add a Settings toggle and privacy copy before shipping telemetry.
- [ ] Document telemetry events in the open-source repo.

Minimum useful anonymous events if enabled:

- App launched with version/platform/arch.
- Model install started/succeeded/failed with model ID and error category only.
- Provider selected category: local/cloud, not API key value.
- Update check succeeded/failed.
- Crash/error category if already surfaced.

## P2: Enhancement And Context Roadmap

- [ ] Keep raw local Whisper dictation as the stable baseline.
- [ ] Add optional cloud LLM cleanup using user API keys.
- [ ] Gate enhancement behind explicit Settings toggle.
- [ ] Define enhancement modes: off, light cleanup, commands/editing.
- [ ] Build local OCR/context extraction spike.
- [ ] Decide if screen recording permission is worth requesting by default.
- [ ] Reintroduce edit mode only after enhancement path is reliable.
- [ ] Reintroduce meta-directives only after they are backed by enabled enhancement.
- [ ] Add tests for prompt safety: never answer user questions, only clean/edit transcript.

## P3: Design Polish

- [ ] Simplify onboarding visual story after flow changes.
- [ ] Keep settings design system consistent across Defaults, Models, History.
- [ ] Improve model install progress and failure states.
- [ ] Review tray/update notifications copy.
- [ ] Review empty states for history and settings.

## Research Notes

- Electron supports serverless/static update metadata for `autoUpdater`, and Forge can publish macOS ZIP update metadata via `macUpdateManifestBaseUrl`.
- Electron documents `update.electronjs.org` as a free service for public GitHub repositories with builds published to GitHub Releases and signed macOS builds.
- Aptabase is a plausible privacy-focused app analytics option if we decide anonymous telemetry is worth it; website/download analytics may be enough for now.
