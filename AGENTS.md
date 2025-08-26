# Repository Guidelines

## Project Structure & Module Organization
- App code: `src/` — Electron `main.ts`, `preload.ts`, React entry `renderer.tsx`, plus `components/`, `hooks/`, `utils/`, `types/`.
- Worker: `worker/` — Cloudflare Worker (API + WebSocket); run independently in dev.
- Assets: `public/` (static files), styles in `src/index.css` (Tailwind).
- Native: `native/` (C helper, build scripts). Build artifacts: `.vite/`, `out/`, `build/`.
- Tests: colocated as `*.{test,spec}.ts(x)` under `src/` and `worker/`.

## Build, Test, and Development Commands
- `npm run dev`: Start Electron + Vite with devtools enabled.
- `npm run dev:local`: Electron pointing to local WS (`ws://127.0.0.1:8787/ws`).
- `npm run dev:prod`: Electron pointing to production WS.
- `npm run dev:ws`: Run the Worker locally (`npm run dev --prefix worker`).
- `npm run test` | `test:watch` | `coverage`: Run Vitest once, watch mode, or with coverage.
- `npm run lint`: ESLint on `.ts/.tsx`.
- `npm run make` | `package`: Electron Forge build for macOS (arm64).

## Coding Style & Naming Conventions
- Language: TypeScript (ES2020). Formatting via Prettier; linting via ESLint + `@typescript-eslint` + `import` rules.
- Indent 2 spaces, semicolons default, single quotes per Prettier defaults.
- Components: `PascalCase` in `src/components/`. Hooks: `useX` in `src/hooks/`. Utilities: `camelCase` in `src/utils/`.
- Imports: prefer alias `@/` for `src/` (see `vitest.config.ts`).

## Testing Guidelines
- Runner: Vitest with `happy-dom` for renderer. Include patterns: `src/**/*.{test,spec}.{ts,tsx}`, `worker/**/*.{test,spec}.ts`.
- Setup: `src/test/setup.ts` (DOM matchers, shims). Aim for text + lcov coverage output.
- Write unit tests for utils/hooks/components; mock `electron`, audio, and network. Name tests after the module (`pcm.test.ts`).

## Commit & Pull Request Guidelines
- Commits: imperative, concise, scoped when helpful (e.g., "fix: trim startup flicker"). Group related changes; run `lint` and `test` before pushing.
- PRs: include purpose, summary of changes, testing instructions, and screenshots for UI tweaks. Link issues. Ensure CI passes (lint + tests + coverage).

## Security & Configuration Tips
- Env: `.env` for local secrets; runtime vars via `VITE_*` and `SF_DEVTOOLS`. Examples: `VITE_TRANSCRIBE_WS_URL`, `VITE_SENTRY_ENVIRONMENT`.
- Do not commit secrets or generated artifacts. For native changes, update `native/build-helper.sh` as needed.
