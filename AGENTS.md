# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Electron app code.
  - `main.ts` (main process), `preload.ts` (secure bridges), `renderer.tsx` + `components/`, `utils/`, `hooks/`, `types/`.
- `public/`: Static assets bundled by Vite.
- `worker/`: Cloudflare Worker (WS transcription/API). See `worker/README.md`.
- `native/`: Native build helpers; invoked on `postinstall`.
- `scripts/`: Utility scripts (e.g., `scripts/kill-port.js`).
- Build config: `forge.config.ts`, `vite.*.config.ts`, `vitest.config.ts`.

## Build, Test, and Development Commands
- `npm run dev`: Start the Electron app with dev tools.
- `npm run dev:local`: Start with local WS (`VITE_TRANSCRIBE_WS_URL=ws://127.0.0.1:8787/ws`).
- `npm run dev:ws`: Run the worker locally (from `worker/`).
- `npm run make` / `npm run package`: Build distributables via Electron Forge (arm64).
- `npm test` / `npm run test:watch`: Run Vitest (CI or watch).
- `npm run coverage`: Generate coverage (text + lcov).
- `npm run lint`: ESLint TypeScript/React linting.

## Coding Style & Naming Conventions
- Language: TypeScript, React 18, Electron 35.
- Formatting: Prettier — 2‑space indent, double quotes, semicolons.
- Linting: ESLint with import plugin and TS rules; keep zero warnings.
- Names: Components `PascalCase` (e.g., `SettingsPanel.tsx`); utilities `camelCase`; tests mirror source names.
- Imports: Use `@` alias for `src` (see `vitest.config.ts`).

## Testing Guidelines
- Framework: Vitest + `happy-dom`; global setup in `src/test/setup.ts`.
- Locations: `src/**/*.{test,spec}.{ts,tsx}`, `worker/**/*.{test,spec}.ts`.
- Coverage: Keep meaningful coverage; add unit tests for utilities, hooks, and component behavior. Use `npm run coverage` locally.

## Commit & Pull Request Guidelines
- Commits: Imperative mood; prefer Conventional Commits (`feat:`, `fix:`, `chore:`).
- PRs: Provide clear description and scope, linked issues, and screenshots/GIFs for UI changes. Note env vars when relevant (e.g., `VITE_TRANSCRIBE_WS_URL`, `VITE_SENTRY_ENVIRONMENT`). Ensure `npm run lint && npm test` pass.

## Security & Configuration Tips
- Secrets: Do not commit. Use `.env` (app) and `worker/.dev.vars` (worker) locally.
- Sentry: Configure `VITE_SENTRY_DSN` and `VITE_SENTRY_ENVIRONMENT`.
- Preload: Add renderer bridges only via `preload.ts`; avoid exposing Node APIs directly.

