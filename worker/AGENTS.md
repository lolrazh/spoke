# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Electron app — `main.ts` (main process), `preload.ts` (secure bridges), `renderer.tsx`, plus `components/`, `hooks/`, `utils/`, `types/`.
- `worker/`: Cloudflare Worker for API/WebSocket transcription. See `worker/README.md`.
- `public/`: Static assets bundled by Vite. Styles in `src/index.css`.
- `native/`: Native build helpers invoked on `postinstall`.
- `scripts/`: Utility scripts (e.g., `scripts/kill-port.js`).
- Build config: `forge.config.ts`, `vite.*.config.ts`, `vitest.config.ts`.

## Build, Test, and Development Commands
- `npm run dev`: Start Electron + Vite with devtools.
- `npm run dev:local`: Start app pointing to local WS (`VITE_TRANSCRIBE_WS_URL=ws://127.0.0.1:8787/ws`).
- `npm run dev:ws`: Run the Worker locally (from `worker/`).
- `npm run make` | `npm run package`: Build distributables via Electron Forge (macOS arm64).
- `npm test` | `npm run test:watch`: Run Vitest once or in watch mode.
- `npm run coverage`: Generate coverage (text + lcov).
- `npm run lint`: ESLint TypeScript/React linting.

## Coding Style & Naming Conventions
- Language: TypeScript, React 18, Electron 35.
- Formatting: Prettier — 2‑space indent, double quotes, semicolons.
- Linting: ESLint with `@typescript-eslint` and `import` rules; keep zero warnings.
- Names: Components `PascalCase` (e.g., `SettingsPanel.tsx`); hooks `useX`; utilities `camelCase`.
- Imports: Prefer `@/` alias for `src/` (see `vitest.config.ts`).

## Testing Guidelines
- Runner: Vitest with `happy-dom` for renderer tests; global setup in `src/test/setup.ts`.
- Locations: `src/**/*.{test,spec}.{ts,tsx}` and `worker/**/*.{test,spec}.ts`.
- Aim for meaningful coverage; prioritize utils, hooks, and component behavior.
- Common mocks: `electron`, audio, and network calls.
- Examples: `npm test`, `npm run coverage`.

## Commit & Pull Request Guidelines
- Commits: Imperative mood; prefer Conventional Commits (`feat:`, `fix:`, `chore:`).
- Before pushing: `npm run lint && npm test` should pass locally.
- PRs: Include purpose, summary of changes, testing steps, and screenshots/GIFs for UI tweaks; link issues. Note relevant envs (e.g., `VITE_TRANSCRIBE_WS_URL`, `VITE_SENTRY_ENVIRONMENT`).

## Security & Configuration Tips
- Do not commit secrets or generated artifacts. Use `.env` (app) and `worker/.dev.vars` (worker) locally.
- Sentry: Configure `VITE_SENTRY_DSN` and `VITE_SENTRY_ENVIRONMENT`.
- Preload: Expose renderer bridges only via `preload.ts`; avoid direct Node APIs.
