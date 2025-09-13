# Version Sync, NPM Versioning, Make vs Publish, and DMG Stapling

**Date:** 2025-09-13  
**Agent:** Codex CLI Agent  
**Status:** ✅ Implemented + Documented

## User Goals
- Understand and reliably test the auto‑update pipeline (ZIP + RELEASES.json on R2).
- Keep version numbers in sync across UI and runtime.
- Clarify when to use prerelease versions vs. normal versions.
- Understand Electron Forge `make` vs `publish` (and why notarization ran twice).
- Start stapling the DMG automatically as part of the publish pipeline.

## What We Investigated & Clarified
- Auto‑update wiring:
  - `update-electron-app` configured in `src/main.ts` with StaticStorage `baseUrl: https://releases.sonicflow.app/darwin/${process.arch}`.
  - Forge ZIP maker produces `.zip` + `RELEASES.json`; S3 publisher uploads to R2 (`darwin/<arch>/...`).
  - Updates use ZIP + manifest; DMG is for first install only.
- Version sync best practice:
  - Single source of truth is `package.json` version.
  - Runtime uses `app.getVersion()` (Electron maps to package.json at build time).
  - Renderer should consume version via a secure preload bridge, not hardcoded strings.
- NPM versioning (“preid”, prerelease vs stable):
  - Prerelease (e.g., `0.0.2-beta.0`) is useful when you ship multiple interim builds or distinct channels.
  - For a single internal/private audience, prefer normal bumps (e.g., `0.0.2`) while staying on `0.x.y` to indicate beta status overall.
- Forge `make` vs `publish`:
  - `make` → builds, signs, notarizes the app, and produces artifacts.
  - `publish` → runs package → make again → then uploads. That’s why notarization ran twice when you did `make` and then `publish`.
  - If you want one step, use only `publish` (don’t pre‑run `make`).
- DMG stapling:
  - Your app bundle is already notarized/stapled via `packagerConfig.osxNotarize`.
  - DMG creation occurs after app notarization; DMG wasn’t stapled by default.
  - Stapling the DMG is recommended for external users to avoid online checks when opening the DMG; not required for updates.

## Changes Implemented
1) Dynamic version in UI (no hardcodes)
- Added preload bridge and UI wiring so Settings shows the real version from `app.getVersion()`.
  - `src/preload.ts`: expose `window.app.getVersion()` via IPC `app:get-version`.
  - `src/main.ts`: added `ipcMain.handle("app:get-version", () => app.getVersion())`.
  - `src/types/electron.d.ts`: declared `window.app.getVersion()` for TS.
  - `src/components/SettingsPanel.tsx`: replaced hardcoded `v0.0.1` with dynamic value from `window.app.getVersion()`.

2) DMG notarization + stapling in postMake (before publish upload)
- Extended `forge.config.ts` `postMake` to:
  - Locate `.dmg` artifacts after `make`.
  - If notarization is enabled (same gating as the app bundle via env or auto‑detect), run:
    - `xcrun notarytool submit <dmg> --wait` (using `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_PASSWORD`, `APPLE_TEAM_ID`).
    - `xcrun stapler staple <dmg>`.
    - `xcrun stapler validate <dmg>` (best‑effort; non‑fatal).
  - Uses `execa` and inherits stdio for clear logs.
  - Non‑fatal on failure so ZIP updates are unaffected.

## Files Touched
- `src/preload.ts`: added `window.app.getVersion()` bridge.
- `src/main.ts`: added `ipcMain.handle("app:get-version", ...)`.
- `src/types/electron.d.ts`: added typing for `window.app.getVersion()`.
- `src/components/SettingsPanel.tsx`: switched UI to dynamic version.
- `forge.config.ts`: postMake DMG notarize + staple workflow (macOS only), using existing Apple env creds.

## How To Ship Now (Recommended)
- Bump version: `npm version patch` (e.g., 0.0.2). No prerelease tag needed for single internal channel.
- Publish in one step: `npm run publish:env`
  - This runs: package → notarize app → make → notarize+staple DMG (postMake) → publish ZIP + RELEASES.json + stapled DMG to R2.

Optional two‑step with local inspection
- Build locally without notarization: `APPLE_NOTARIZE=0 npm run make:env`
- When ready to ship notarized/stapled DMG: `npm run publish:env`

## Verification Checklist
- Version shown in Settings reflects `package.json` at build time (no hardcoded values).
- DMG stapling:
  - `xcrun stapler validate out/make/**/Sonic Flow-<version>.dmg`
  - `spctl -a -vvv --type open out/make/**/Sonic Flow-<version>.dmg` (optional)
- Update artifacts on R2:
  - `curl -I https://releases.sonicflow.app/darwin/arm64/RELEASES.json`
  - `curl -I "https://releases.sonicflow.app/darwin/arm64/Sonic%20Flow-<version>-mac.zip"`

## Key Learnings Captured
- Package.json is the single source of truth; use `app.getVersion()` everywhere (UI bridged via preload).
- With a single audience, normal semantic bumps (0.0.2) are simpler than prereleases.
- Forge `publish` runs build steps again; prefer running only `publish` if you want a single notarization cycle.
- DMG stapling is best handled in `postMake`, ensuring the publisher uploads a stapled disk image.

## Next Ideas (Optional)
- Add a tiny “build info” API (version, arch, optional channel/commit) for richer Settings footer.
- If you later split stable/beta channels, expose a channel flag and pick updater base URL per channel at build time.
