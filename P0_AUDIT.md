# P0 Audit

Date: 2026-05-18

Scope: local-first dogfood readiness, onboarding truth, optional cloud boundaries, packaging/update risks, and obvious dead/redundant local-migration code.

## Verdict

The core local STT path is workable, but the app is not yet P0-clean for a packaged dogfood build. The main blockers are product truth and release plumbing, not the Whisper model itself:

- Onboarding still advertises and requires non-core features.
- Local dictation can still touch cloud enhancement/OCR paths if compatible API keys exist.
- The update pipeline still points at Cloudflare/R2.
- Packaged sidecar signing/build verification has not been completed.

## Findings

### P0: Onboarding Permission Contract Is Wrong

Evidence:

- `src/components/Onboarding.tsx:522` requires microphone, accessibility, and screen recording before continuing.
- `src/components/Onboarding.tsx:807` defines an Input Monitoring request handler, but the visible permissions UI does not expose it.
- `src/components/Onboarding.tsx:1300` presents Screen Recording as "Smart Context" and required setup.
- `src/components/onboardingFlow.ts:8` still includes `edit-test` and `meta-directives`.

Risk: a clean user may be blocked by a non-core permission while not being guided through the permission that matters for reliable global hotkeys. The flow also promises features that are not currently production-ready.

Fix:

- Required first-run permissions should be microphone, accessibility, and input monitoring.
- Screen recording should move behind an optional context feature gate.
- Onboarding should become: permissions, microphone check, model/provider setup, one hotkey/dictation test, complete.
- Remove `edit-test`, `meta-directives`, and smart-context promises until the underlying feature is explicitly enabled and production-ready.

### P0: Cloud Enhancement And OCR Are Implicit, Not Explicit

Evidence:

- `src/hooks/useTranscription.ts:167` starts OCR alongside every recording.
- `src/hooks/useTranscription.ts:181` captures a screenshot when the bridge exists.
- `src/hooks/useTranscription.ts:281` waits for OCR before local enhancement.
- `src/hooks/useTranscription.ts:288` calls `window.stt.enhance` in the local path.
- `src/hooks/useTranscription.ts:357` calls the same enhancement path after cloud STT.
- `src/main/llmService.ts:61` falls back to any configured Groq/OpenAI key even when local STT is selected.
- `src/main.ts:2221` exposes `stt:enhance`; `src/main.ts:2240` exposes `stt:extract-ocr`.

Risk: local dictation is not guaranteed to stay local once the user has a compatible API key configured. Screenshot-derived OCR words and transcripts can flow into cloud calls without a separate context/enhancement setting.

Fix:

- Add explicit settings for enhancement and screen context. Default both off.
- Never call OCR or enhancement from `useTranscription` unless the relevant feature flag/preference is enabled.
- Keep raw local Whisper as the stable baseline.
- If cloud cleanup is enabled, make the provider and privacy copy obvious in Settings.

### P0: Edit Mode Is Advertised But Not Actually Wired

Evidence:

- `src/hooks/useTranscription.ts:56` hardcodes `mode` to `"dictation"`.
- `src/hooks/useTranscription.ts:57` hardcodes `selection` to `null`.
- `src/components/onboardingFlow.ts:21` still includes `edit-test`.

Risk: onboarding can teach a feature that the current transcription hook cannot activate.

Fix:

- Remove edit mode from onboarding for P0.
- Reintroduce it only when mode switching, selection inspection, enhancement, and insertion behavior are wired end-to-end.

### P0: Updates Still Depend On Cloudflare/R2

Evidence:

- `forge.config.ts:7` imports `PublisherS3`.
- `forge.config.ts:153` sets update metadata URLs to `https://download.spoke.so/darwin/${arch}`.
- `forge.config.ts:158` configures Cloudflare R2/S3 publishing.
- `src/main.ts:226` initializes packaged updates from `https://download.spoke.so/darwin/${process.arch}`.
- `src/main/updateController.ts:86` uses the same Cloudflare URL for fallback checks.
- No `.github/workflows` directory exists.

Risk: dogfood builds cannot receive GitHub-hosted updates yet.

Fix:

- Remove R2 publisher wiring.
- Choose GitHub Releases update strategy.
- Add signed/notarized macOS arm64 release workflow.
- Point both automatic and manual update checks at GitHub-hosted artifacts.

### P0: Packaged Local STT Needs A Real Release Verification Pass

Evidence:

- `forge.config.ts:50` expects `./local-stt/dist/spoke-stt` as an extra resource.
- `local-stt/.gitignore` ignores `dist/`, so the sidecar binary is intentionally not tracked.
- `local-stt/build-sidecar.sh` builds the PyInstaller sidecar, but packaging does not currently build it automatically.
- `src/main/sidecarPaths.ts:17` expects packaged sidecar at `process.resourcesPath/spoke-stt`.

Risk: a release can fail or ship with a stale/missing sidecar unless the build step is explicit.

Fix:

- Make sidecar build a documented release prerequisite or a package preflight.
- Verify `spoke-stt` is signed with sidecar entitlements.
- Test packaged app without repo files or local Python.
- Test first-run model install, restart persistence, local dictation, model removal, and app quit/relaunch.

### P1: Open Source Readiness Is Not Done

Evidence:

- `package.json:32` still says `"license": "Proprietary"`.
- No root `README`, `LICENSE`, `CONTRIBUTING`, or `SECURITY` file exists.
- Sentry is present in main and renderer; if kept for open source, it needs privacy copy and public configuration expectations.
- `package.json:68` still has `wrangler`, likely left over from Cloudflare usage.

Risk: the repo is not yet ready to present as a clean open-source app.

Fix:

- Pick and add the license.
- Add README, privacy notes, development setup, model install notes, and release process.
- Remove Cloudflare-only dependencies once release migration is complete.
- Decide whether Sentry stays, becomes optional, or is removed for OSS dogfood builds.

## Confirmed Healthy

- No auth/login/account stack appears to remain in active app code.
- Local is the default transcription provider.
- Cloud providers are only selectable after an API key is configured.
- No fallback local models are present.
- Local model files are downloaded to `userData/local-stt/weights`, not bundled in the app.
- Model install verifies SHA256 checksums.
- Sidecar requests are serialized, which avoids stdout response races.
- `local-stt/.venv`, `local-stt/weights`, and `local-stt/dist` are ignored rather than tracked.

## Implementation Order

1. Fix onboarding and permissions: remove non-core promises, add Input Monitoring, make Screen Recording optional.
2. Gate enhancement/OCR behind explicit off-by-default settings.
3. Run focused tests for onboarding flow, provider settings, model manager, sidecar engine, and transcription hook.
4. Build the sidecar and package a signed/notarized macOS app.
5. Migrate updates/downloads from Cloudflare/R2 to GitHub Releases.
6. Do open-source cleanup: license, README, privacy notes, environment docs, and Cloudflare dependency removal.
