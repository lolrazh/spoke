# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Electron app source — `main.ts` (Main), `preload.ts` (preload), `renderer.tsx` (React UI). Subfolders: `components/`, `hooks/`, `config/`, `utils/`, `types/`.
- `public/`: Static assets (icons, DMG background).
- `worker/`: Cloudflare Worker (Hono) for the transcription WebSocket. Independent package with its own scripts.
- `native/`: macOS helper built on postinstall into `native/bin/Sonic Flow Helper.app`.
- `build/`: Entitlements and packaging artifacts; `out/` is build output; `scripts/` contains helpers (e.g., `kill-port.js`).

## Build, Test, and Development Commands
- Install: `npm ci` (prefer npm; lockfile present).
- App dev: `npm run dev` (Electron + Vite). Local worker: `npm run dev:ws`. App against local WS: `npm run dev:local` (sets `VITE_TRANSCRIBE_WS_URL=ws://127.0.0.1:8787/ws`).
- Package/DMG: `npm run package` (app), `npm run make` (DMG, arm64). Publish: `npm run publish`.
- Lint/clean: `npm run lint` (ESLint), `npm run clean` (clears `out/`). Free port: `npm run kill:port:8787`.
- Worker only: `npm run dev --prefix worker`, deploy with `npm run deploy --prefix worker`.

## Coding Style & Naming Conventions
- Language: TypeScript (`noImplicitAny` enabled). 2‑space indent.
- Linting: ESLint with TypeScript + import rules (`.eslintrc.json`). Formatting: Prettier defaults.
- Naming: React components `PascalCase` (e.g., `SettingsPanel.tsx`); functions/vars `camelCase`; file names `kebab-case` or `camelCase` to match neighbors. Use `@/*` path alias for imports.
- UI: Tailwind utility classes in components; design tokens in `src/config/`.

## Testing & QA
- No formal test runner configured. Provide clear manual QA steps.
- Verify: run `npm run dev`; if touching worker, also run `npm run dev:ws` and use `npm run dev:local`.
- Include repro cases, screenshots for UI changes, and expected/actual behavior.

## Commit & Pull Request Guidelines
- Commits: concise, present tense (e.g., "fix dev server cleanup"). Group related changes; avoid drive‑by formatting.
- PRs: include a summary, linked issues, screenshots of UI changes, env vars used, and QA steps. Keep PRs focused and small.

## Security & Configuration Tips
- Secrets/config via `.env` (git‑ignored). Common vars: `VITE_TRANSCRIBE_WS_URL`, `SF_DEVTOOLS`, `VITE_SENTRY_ENVIRONMENT`.
- macOS helper requires Xcode tools and an Apple Development identity; see `native/build-helper.sh`.
