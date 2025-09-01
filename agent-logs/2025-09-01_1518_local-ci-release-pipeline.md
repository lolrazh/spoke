# Local CI-Style Release Pipeline + Update Publishing Fix

**Date:** 2025-09-01  
**Agent:** Codex CLI Agent  
**Status:** ✅ Completed  

## User Intention
The user wanted a reliable, production-aligned release workflow they can run locally: use their Apple Developer ID for signing now (without notarization yet), fix the failing publish to Cloudflare R2, and keep the auto-update pipeline ready to flip on notarization later with minimal changes. They also wanted clarity on industry practices (CI/CD secrets vs. local .env) and a smooth path to full CI/CD when they’re ready.

## What We Accomplished
- ✅ **Diagnosed publish failure** - Identified AWS SDK `CredentialsProviderError` due to `.env` not being loaded by Forge/Node at publish time
- ✅ **Local CI-style scripts** - Added `make:env` and `publish:env` using `dotenv-cli` to load `.env` automatically
- ✅ **Env-driven signing** - `forge.config.ts` now reads `APPLE_IDENTITY` (Developer ID) for signing; falls back to Apple Development when not set
- ✅ **Notarization toggle** - Added `APPLE_NOTARIZE` flag; notarization only occurs when explicitly enabled (and creds provided)
- ✅ **R2 credentials in env** - S3 publisher reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, endpoint, region, and bucket from env
- ✅ **.env template** - Expanded `.env.example` for Apple + R2 variables with guidance
- ⚠️ **CI workflow** - Intentionally not added; kept everything local per user request (easy to add later)

## Technical Implementation
We mirrored how real CI/CD pipelines pass configuration: everything comes from environment variables. Locally, `dotenv-cli` exports `.env` just for the command, so the AWS SDK and Electron Forge see credentials and Apple config like CI would.

**Files Modified:**
- `forge.config.ts` - Switched to env-driven signing; added conditional notarization via `APPLE_NOTARIZE`; publisher reads AWS/R2 envs
- `package.json` - Added scripts `make:env`, `publish:env` and devDep `dotenv-cli`
- `.env.example` - Added Apple signing/notarization variables and `APPLE_NOTARIZE`; included `AWS_SESSION_TOKEN`

## Bugs & Issues Encountered
1. **CredentialsProviderError (AWS SDK)** - Forge publish failed: "Could not load credentials from any providers"
   - **Fix:** Use `dotenv-cli` to export `.env` for the publish process (`npm run publish:env`), ensuring the AWS SDK default provider chain sees the credentials
2. **Notarization complexity before shipping** - Developer ID is desired now, but notarization adds friction
   - **Resolution:** Added `APPLE_NOTARIZE` env flag; use Developer ID without notarization today, then enable notarization later by flipping the flag and providing Apple creds

## Key Learnings
- **Forge vs Vite envs:** Forge/Node doesn’t auto-load `.env`; only values exported in the process env are visible. Vite only auto-loads `VITE_*` during its own build.
- **Industry practice:** Open-source/prod apps use CI secrets for signing and publishing; local runs typically use `dotenv-cli` or `direnv` rather than custom code in config files.
- **Developer ID without notarization:** You can sign with Developer ID for consistent bundle identity and enable notarization later with no code changes.
- **R2 via S3 SDK:** Cloudflare R2 requires a custom endpoint and path-style access; ACLs are ignored—public exposure is managed in R2/Cloudflare.

## Architecture Decisions
- **Env-driven configuration:** All sensitive config (Apple + R2) flows via environment variables to align with CI/CD and avoid hardcoding.
- **Explicit notarization toggle:** `APPLE_NOTARIZE` provides a clear switch to move from internal builds to shipping builds without refactoring.
- **Keep CI local for now:** No GitHub Actions workflow added; the same env-driven commands will translate directly to CI later.

## Ready for Next Session
- ✅ **Signed builds (no notarize):** `npm run make:env` using your Developer ID via `.env`
- ✅ **Publish to R2:** `npm run publish:env` with `.env` providing AWS/R2 vars
- 🔧 **Optional next:** Add GitHub Actions workflow mirroring these steps; enable notarization by setting `APPLE_NOTARIZE=1` and adding Apple creds to env

## Context for Future
Building on 2025-08-31_2200_auto-update-pipeline.md and 2025-09-01_1306_update-pipeline-implementation.md, this session completes a local, CI-style release flow. When ready to ship, you can enable notarization and (optionally) move to CI without changing the app’s architecture or update pipeline.

