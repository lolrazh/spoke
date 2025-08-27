# Repository Guidelines

## Project Structure & Module Organization
- App code: `src/` — Electron `main.ts`, `preload.ts`, React entry `renderer.tsx`, plus `components/`, `hooks/`, `utils/`, `types/`.
- Worker: `worker/` — Cloudflare Worker (API + WebSocket); run independently in dev.
- Assets: `public/` (static files); styles in `src/index.css` (Tailwind).
- Native: `native/` (C helper, build scripts). Build artifacts: `.vite/`, `out/`, `build/`.
- Tests: colocated `*.{test,spec}.ts(x)` under `src/` and `worker/`.

## Build, Test, and Development Commands
- `npm run dev`: Start Electron + Vite with devtools.
- `npm run dev:local` | `dev:prod`: Electron pointing to local or production WS.
- `npm run dev:ws`: Run the Worker locally (same as `npm run dev --prefix worker`).
- `npm run test` | `test:watch` | `coverage`: Run Vitest once, in watch mode, or with coverage.
- `npm run lint`: ESLint over `.ts/.tsx` sources.
- `npm run make` | `package`: Electron Forge build/package for macOS (arm64).

## Coding Style & Naming Conventions
- Language: TypeScript (ES2020). Format with Prettier; lint with ESLint + `@typescript-eslint` + `import` rules.
- Indentation: 2 spaces; semicolons on; single quotes (Prettier defaults).
- Naming: Components `PascalCase` (`src/components/`), hooks `useX` (`src/hooks/`), utilities `camelCase` (`src/utils/`).
- Imports: prefer `@/` alias for `src/` (see `vitest.config.ts`).

## Testing Guidelines
- Runner: Vitest with `happy-dom` for renderer tests.
- Include: `src/**/*.{test,spec}.{ts,tsx}`, `worker/**/*.{test,spec}.ts`.
- Setup: `src/test/setup.ts` (DOM matchers, shims). Output text + lcov.
- Write unit tests for utils/hooks/components; mock `electron`, audio, and network. Name tests after the module (e.g., `pcm.test.ts`).

## Commit & Pull Request Guidelines
- Commits: imperative and concise; scope when helpful (e.g., `fix: trim startup flicker`). Run `npm run lint` and `npm run test` before pushing.
- PRs: include purpose, summary of changes, testing instructions, and screenshots for UI tweaks. Link issues and ensure CI passes (lint + tests + coverage).

## Security & Configuration Tips
- Env: use `.env` for local secrets; runtime via `VITE_*` and `SF_DEVTOOLS` (e.g., `VITE_TRANSCRIBE_WS_URL`, `VITE_SENTRY_ENVIRONMENT`).
- Do not commit secrets or generated artifacts. For native changes, update `native/build-helper.sh` as needed.

