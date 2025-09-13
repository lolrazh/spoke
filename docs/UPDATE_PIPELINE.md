# Sonic Flow macOS Auto‑Update Pipeline

This guide documents the complete macOS auto‑update pipeline for Sonic Flow using Electron Forge, update‑electron‑app, and Cloudflare R2 (S3‑compatible) behind the custom domain `https://releases.sonicflow.app`.

It covers architecture, file layout, configuration, environment, build/publish steps, verification, troubleshooting, and advanced topics like multi‑arch and channels.

## TL;DR
- App checks `https://releases.sonicflow.app/darwin/<arch>/RELEASES.json`.
- Forge ZIP maker creates `.zip` + `RELEASES.json` for macOS.
- Publish both to R2 at `darwin/<arch>/`.
- App downloads the ZIP, swaps the `.app`, and relaunches.

## Prerequisites
- Cloudflare R2 bucket mapped to `https://releases.sonicflow.app` and publicly readable (via R2 settings/route).
- AWS‑style credentials for R2 (access key + secret).
- Apple certificates:
  - Local/self testing: Apple Development is sufficient (no notarization required for your own machine once installed).
  - Distribution to others: Developer ID Application + notarization recommended to avoid Gatekeeper prompts on first install.
- Node 18+, npm.

## Roles and Responsibilities
- Forge ZIP maker: builds `Sonic Flow-<version>-mac.zip` and generates `RELEASES.json`.
- Forge S3 publisher: uploads artifacts to R2 at `darwin/<arch>/...`.
- update‑electron‑app: reads `RELEASES.json`, downloads ZIP, applies update, restarts app.

## Required File Layout (Static Storage)
```
https://releases.sonicflow.app/
  darwin/
    arm64/
      RELEASES.json
      Sonic Flow-0.0.1-mac.zip
      Sonic Flow-0.0.2-mac.zip
    x64/
      RELEASES.json
      Sonic Flow-0.0.1-mac.zip
```

The updater fetches `RELEASES.json` from `darwin/<arch>/` and follows absolute URLs in the manifest to download the ZIP.

## Repository Wiring (already configured)
- `forge.config.ts`
  - ZIP maker added for macOS with manifest URLs:
    - `macUpdateManifestBaseUrl: https://releases.sonicflow.app/darwin/${arch}`
  - S3 publisher configured for R2 with path‑style endpoint and `keyResolver` → `darwin/<arch>/<filename>`.
- `src/main.ts`
  - `updateElectronApp` initialized with StaticStorage:
    - `baseUrl: https://releases.sonicflow.app/darwin/${process.arch}`
    - Hourly checks (can temporarily use 1 minute for testing).
- `package.json`
  - Makers and publisher wired.
  - Scripts for `make`, `publish`.
- `.env.example`
  - R2 credentials and endpoint variables template.

## Environment Variables
Create `.env` (copy from `.env.example`) and fill:
- `AWS_ACCESS_KEY_ID`: R2 access key
- `AWS_SECRET_ACCESS_KEY`: R2 secret key
- `R2_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `R2_BUCKET`: `releases` (or your bucket name)
- `R2_REGION`: `auto`

Security: Do not commit `.env`. Use local shell exports or CI secrets.

## Build and Publish Flow
1) Set version
- Prefer npm to bump SemVer: `npm version patch` (or `npm version prerelease --preid beta`).
- Single source of truth is `package.json`; the app reads this via `app.getVersion()` at runtime.

2) Publish in one step (recommended)
- Ensure `.env` is present. Run: `npm run publish:env`.
- This runs packaging → make → uploads ZIP + `RELEASES.json` (and DMG). Avoid pre‑running `make` to prevent double notarization.

3) Optional two‑step flow
- Local build without notarization: `APPLE_NOTARIZE=0 npm run make:env`.
- When ready to ship, run: `npm run publish:env`.

4) Post‑make DMG stapling (if enabled)
- The config can notarize + staple the DMG in a `postMake` hook. You can validate with:
  - `xcrun stapler validate out/make/**/Sonic\ Flow-<version>.dmg`

5) Verify hosting
- `curl -I https://releases.sonicflow.app/darwin/arm64/RELEASES.json`
- `curl -I "https://releases.sonicflow.app/darwin/arm64/Sonic%20Flow-<version>-mac.zip"`
- Headers to check:
  - `Content-Type: application/json` for `RELEASES.json`
  - `Content-Type: application/zip` for `.zip`
  - `Cache-Control`: Prefer short TTL for `RELEASES.json` (e.g., `max-age=600`), longer for ZIPs.

5) Test update end‑to‑end
- Install `0.0.1` via DMG.
- Publish `0.0.2` ZIP + `RELEASES.json` to the same path (manifest overwrite is expected).
- Launch the app (packaged). It downloads the update and relaunches to `0.0.2`.

## How update‑electron‑app Works (macOS)
- When packaged, the main process initializes `updateElectronApp`.
- On startup and at `updateInterval`, it fetches `RELEASES.json` from `baseUrl`.
- If a newer version exists, it downloads the ZIP, atomically replaces the `.app` bundle, and restarts.
- Logging goes to your app logs (`console` bound). You can add more logging around update init if needed.

## RELEASES.json (Example)
```json
{
  "currentRelease": "0.0.2",
  "releases": [
    {
      "version": "0.0.2",
      "updateTo": {
        "version": "0.0.2",
        "pub_date": "2025-08-31T12:00:00.000Z",
        "name": "Sonic Flow v0.0.2",
        "url": "https://releases.sonicflow.app/darwin/arm64/Sonic Flow-0.0.2-mac.zip"
      }
    }
  ]
}
```

Notes
- Manifest is generated by Forge ZIP maker.
- URLs are absolute (we configured `macUpdateManifestBaseUrl`).

## Cloudflare R2 Specifics
- Endpoint: use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with path‑style S3 access.
- ACLs: R2 does not honor S3 ACLs; set public access via R2 bucket/route settings or policy.
- Domain: map your bucket/route to `https://releases.sonicflow.app`.
- CORS: if you want the renderer to read files directly (not required for updater), add permissive CORS for `GET` on R2/Cloudflare.
- Caching: set `Cache‑Control` headers—short for `RELEASES.json`, longer for ZIPs.

## Multi‑Architecture Support
- Build Intel (x64) locally on Intel or via cross build if supported:
  - `electron-forge make --arch=x64`
- Publisher uploads to `darwin/x64/` automatically (due to `keyResolver`).
- The app uses `process.arch` to choose `darwin/arm64` vs `darwin/x64` base.
- Ensure both folders exist and are public if you support both.

## Channels (Stable / Beta)
- Easiest approach: separate base URLs per channel, e.g.:
  - Stable: `https://releases.sonicflow.app`
  - Beta: `https://beta-releases.sonicflow.app` (or `.../beta` with a Worker/route)
- Configure at build time by swapping the updater base in `src/main.ts` via env/build flag (or maintain a small wrapper that reads an env var and sets `baseUrl`).
- Keep distinct `RELEASES.json` and ZIPs per channel.

## Versioning Guidelines
- Use SemVer (major.minor.patch).
- Never reuse a version; always bump for a new build.
- Don’t change `productName` or `appBundleId` between versions—this breaks update continuity.

## Troubleshooting
- 404 on `RELEASES.json` or ZIP
  - Check upload path: must be `darwin/<arch>/...`.
  - Verify bucket/domain mapping and object visibility.
- Wrong content type
  - Ensure `application/json` for manifest and `application/zip` for ZIP.
- Stale manifest (no update)
  - Lower `Cache‑Control` on `RELEASES.json` and purge CDN cache if needed.
  - Temporarily set `updateInterval` to `"1 minute"` in `src/main.ts` while testing.
- Code signature / “can’t be opened” on first install
  - For external testers, sign with Developer ID Application and notarize the app.
- “Updated but still old version”
  - Confirm `app.getVersion()` reflects the new version and that the bundle was replaced.
- Permission issues when publishing
  - Check `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.
  - Ensure `s3ForcePathStyle: true` is used (configured).

## Notarization (When You’re Ready)
- For internal/local tests: not required.
- For external users:
  - Sign with “Developer ID Application”.
  - Notarize the app (stapling optional but recommended for DMG).
  - Update `packagerConfig.osxSign.identity` to your Developer ID.

## CI Ideas (Optional)
- GitHub Actions job per tag:
  - `npm ci`
  - `npm run make`
  - `npm run publish`
- Store R2 credentials as encrypted secrets.
- Optionally create separate jobs for stable/beta.

## Quick Reference
- Build: `npm run make`
- Publish: `npm run publish`
- Verify manifest: `curl -I https://releases.sonicflow.app/darwin/arm64/RELEASES.json`
- Verify ZIP: `curl -I "https://releases.sonicflow.app/darwin/arm64/Sonic%20Flow-<version>-mac.zip"`
- Toggle interval (testing): set `updateInterval: "1 minute"` in `src/main.ts` (revert after).

## Appendix: Why ZIP, Not DMG?
- macOS in‑app updaters replace the `.app` bundle directly from a ZIP. DMGs are for first installs.
- You can publish both: DMG for first‑time installs, ZIP for updates.

## Appendix: Environment Variables
```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_BUCKET=releases
R2_REGION=auto
```

## Appendix: Paths
- ZIP + manifest (local): `out/make/zip/darwin/<arch>/`
- ZIP + manifest (R2): `https://releases.sonicflow.app/darwin/<arch>/`
