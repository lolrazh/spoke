# macOS Auto‑Update Pipeline (Forge + R2)

**Date:** 2025-08-31  
**Agent:** Codex CLI Agent  
**Status:** ⚠️ Partial  

## User Intention
User wanted a simple, Forge‑native macOS auto‑update pipeline that they can host on Cloudflare R2 behind `releases.sonicflow.app`, without switching to electron‑builder or adding complexity. They asked to avoid notarization for now, keep DMG for first installs, automate uploads when possible, and document everything clearly for repeatable releases.

## What We Accomplished
- ✅ **ZIP maker for macOS updates** — Enabled `@electron-forge/maker-zip` alongside DMG; configured manifest base URL so `RELEASES.json` contains absolute URLs
- ✅ **Updater wiring in main process** — Integrated `update-electron-app` using StaticStorage to pull `RELEASES.json` from `darwin/<arch>/` and check hourly (packaged builds only)
- ✅ **R2 publishing automation** — Added Forge S3 publisher configured for Cloudflare R2 (endpoint, path‑style, `keyResolver` to `darwin/<arch>/...`)
- ✅ **Environment template** — Added `.env.example` with R2 variables (endpoint/bucket/region and AWS‑style keys for the publish step only)
- ✅ **Docs** — Added a comprehensive `docs/UPDATE_PIPELINE.md` and expanded README section linking to it
- ✅ **Signing guidance** — Added commented template in `forge.config.ts` for switching to “Developer ID Application” + notarization later
- ⚠️ **End‑to‑end test** — Not executed by design (user will run `make/publish` and upload to bucket)

## Technical Implementation
- Forge ZIP maker emits `.zip` and `RELEASES.json`; set `macUpdateManifestBaseUrl` to `https://releases.sonicflow.app/darwin/${arch}` so the manifest contains absolute URLs that remain valid behind CDN.
- Updater uses `updateElectronApp` with `UpdateSourceType.StaticStorage` and `baseUrl = https://releases.sonicflow.app/darwin/${process.arch}`; checks on startup + hourly. Wrapped in `if (app.isPackaged)` and try/catch.
- R2 publishing via `@electron-forge/publisher-s3` with:
  - `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
  - `region: auto`, `s3ForcePathStyle: true`
  - `keyResolver(filename, platform, arch) => `${platform}/${arch}/${filename}``
  - Note: R2 ignores S3 ACLs; bucket/route itself must be public.
- Documentation: end‑to‑end flow, env setup, verification curl commands, caching guidance, troubleshooting, multi‑arch/channel notes.

**Files Modified:**
- `forge.config.ts` — Added `MakerZIP` with `macUpdateManifestBaseUrl`; added `PublisherS3` for R2; added commented Developer ID + notarization template
- `src/main.ts` — Imported `update-electron-app` and initialized StaticStorage update source for packaged builds
- `package.json` — Added `update-electron-app` and `@electron-forge/publisher-s3`
- `.env.example` — Added R2 env variables (for publishing)
- `README.md` — Added “Publishing (Cloudflare R2)” section and link to detailed guide
- `docs/UPDATE_PIPELINE.md` — New detailed guide for the full pipeline

## Bugs & Issues Encountered
1. **R2 ACL behavior** — R2 does not honor S3 ACLs, so `public: true` is insufficient
   - **Fix:** Removed reliance on ACL; require bucket/route to be public in R2; kept docs explicit
2. **Updater base URL ambiguity** — Two valid patterns (root + auto `darwin/<arch>`, or explicit arch in base URL)
   - **Fix:** Chose explicit `baseUrl` including `darwin/${process.arch}` for clarity; also set maker `macUpdateManifestBaseUrl` to absolute CDN path
3. **README patch anchors** — Some headings didn’t match initially
   - **Workaround:** Searched and patched against concrete lines/blocks; validated content exists

## Key Learnings
- **Absolute URLs in manifest** prevent CDN/path issues and simplify hosting behind a custom domain.
- **R2 publishing** needs path‑style and a custom endpoint; do not rely on S3 ACLs—make the route public.
- **Notarization not required** for self‑tests on your machine; crucial for external testers to avoid Gatekeeper prompts.

## Architecture Decisions
- **StaticStorage layout**: `darwin/<arch>/RELEASES.json` with ZIPs in the same folder; aligns with Forge docs and avoids custom logic.
- **Keep DMG + add ZIP**: DMG for first install; ZIP for updates, which is the supported path for macOS in‑app updates.
- **Automated publish**: Forge S3 publisher targeting R2 to reduce manual steps; still compatible with manual uploads when desired.

## Ready for Next Session
- ✅ **Ready:** `npm install` then `npm run make` produces ZIP + `RELEASES.json`
- ✅ **Ready:** Set `.env` (R2 creds + endpoint), run `npm run publish` to upload to `darwin/arm64/`
- 🔧 **Next:** Bump to `0.0.2`, rebuild, republish manifest, and verify in‑app update flow
- 🔧 **Later:** Add x64 builds, split stable/beta channels, enable Developer ID + notarization

## Context for Future
This wiring enables a low‑friction release loop: build ZIP + manifest, publish to R2, and get auto‑updates with minimal moving parts. It scales to multi‑arch and channels and can be promoted to signed/notarized distribution when you’re ready.
