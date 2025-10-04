# Latest Download Worker Alias

## Background
- Sonic Flow's auto-update pipeline uploads two artifacts per release: a DMG geared for first installs and a ZIP + `RELEASES.json` manifest for in-app updates.
- Cloudflare R2 serves these files at `https://releases.sonicflow.app/darwin/<arch>/`, matching the expectations of `update-electron-app` as described in `docs/UPDATE_PIPELINE.md`.

## Purpose
- Provide a stable "latest" permalink (e.g., `https://releases.sonicflow.app/darwin/arm64/latest`) so external users do not need to know the current semantic version or filename convention.
- Keep download delivery close to R2 to avoid proxying through the marketing Next.js app and eliminate the need to share R2 credentials with that stack.

## Problem / Need
- Today, every DMG link includes the version (`Sonic Flow-0.1.11-arm64.dmg`), forcing manual updates to marketing content and support messages.
- The release pipeline already produces versioned DMG + ZIP artifacts, but there is no aliasing mechanism for "current" installers.
- Sharing R2 access beyond Cloudflare increases the surface area for leaked credentials and slows down future automation of releases.

## Proposed Worker Flow
1. Create a Cloudflare Worker on `releases.sonicflow.app` (route: `/darwin/:arch/latest`).
2. Bind the R2 bucket (`releases`) to the Worker.
3. On each request:
   - Fetch `darwin/<arch>/RELEASES.json` from R2 (cheap, small JSON cached for a short TTL).
   - Read `currentRelease` (or highest `releases[].version`) to determine the newest version.
   - Construct the DMG key (`darwin/<arch>/Sonic Flow-<version>-arm64.dmg` for arm64, similar naming for x64) and issue a 302 redirect to its public URL.
4. Cache the resolved redirect for a short window (e.g., 5–10 minutes) via `Cache-Control`/`cf.cacheTtlByStatus` to avoid hammering R2 on repeated hits.

## Notes & Follow-Ups
- Publishing already overwrites `RELEASES.json`, so the Worker inherits the newest version automatically without object listing.
- If ZIP installers ever become the public "latest" artifact, the Worker can return that extension instead while keeping the same entrypoint.
- After implementing, update `docs/UPDATE_PIPELINE.md` (Verification section) and any release runbook to include testing the `/latest` redirect.
- Future nicety: add `/darwin/<arch>/latest.json` containing richer metadata (size, pub_date) for the marketing site.
