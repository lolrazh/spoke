# Agent Operating Guide (Read First)

## Scope & Precedence
- This AGENTS.md applies to the entire repository. If a more deeply nested AGENTS.md exists, it overrides these rules for files under its directory.
- Follow direct system/developer/user instructions first. Then follow AGENTS.md rules. When in doubt, ask briefly and proceed.

## Workflow Standards
- Always send a brief 1–2 sentence preamble before grouped tool calls.
- Use the plan tool for multi‑step tasks; exactly one step in_progress.
- Keep changes minimal and scoped; do not fix unrelated issues.
- Follow the Coding Style & Naming Conventions section for language, formatting, and linting rules.
- Search with `rg`; read files in <=250 line chunks; prefer surgical edits via `apply_patch`.
- Add small targeted tests when you change logic (do not introduce new frameworks).

## Updates & Releases
- Read `docs/UPDATE_PIPELINE.md` before making release changes.
- Prefer `npm run make:env` for building and `npm run publish:env` for publishing (loads `.env` via dotenv). Use plain `make`/`publish` only if env is already exported.
- When asked to push an update, ensure `package.json` `version` is bumped (SemVer). If unclear, ask whether to bump minor or patch.
- Never reuse a version; confirm artifacts target `darwin/<arch>/` and update manifest is correct.

## Transcription & Worker (Overview)
- End-to-end: mic capture → 16kHz PCM worklet → binary WS frames → Cloudflare Worker (PCM concat + WAV wrap) → Groq STT → optional LLM → final text → native insertion.
- Dev endpoints: `VITE_TRANSCRIBE_WS_URL=ws://127.0.0.1:8787/ws` (local), prod `wss://api.sonicflow.app/ws`.
- Commands: run worker locally with `npm run dev:ws` (from `worker/`); start app pointing to local WS via `npm run dev:local`.
- Key files (client): `src/hooks/useTranscription.ts` (pipeline + WS), `public/worklets/pcm16-downsampler.worklet.js` (resample), `src/utils/pcm.ts` (frame header), `src/config/audio.ts` (CHUNK_MS, POST_ROLL_MS, WS buffers), `src/config/vad.ts` + `src/utils/vad*` (gate-only VAD, optional).
- Key files (worker): `worker/src/handlers/ws.ts` (WS), `worker/src/ws/session.ts` (state), `worker/src/audio/codec.ts` (concat/wav), `worker/src/services/stt/groq.ts` (STT), `worker/src/services/llm/{openai,groq,baseten}.ts` (optional LLM), `worker/src/config/runtime.ts` (env-driven provider/model/stream settings).
- Environment: client `VITE_TRANSCRIBE_WS_URL`; worker STT `GROQ_API_KEY`; LLM supports `LLM_PROVIDER` (openai|groq|baseten), `LLM_MODEL`, `LLM_STREAM`, and keys `OPENAI_API_KEY` / `GROQ_API_KEY` / `BASETEN_API_KEY`. See `docs/TRANSCRIPTION.md` for the full matrix.

## Session Continuity
- Be aware `agent-logs/` exists; do not skim logs by default.
- Only consult a specific log when the user references it or when the task clearly continues prior work. Prefer scanning filenames over opening full files.
- If continuing prior tasks, reference the relevant log(s) by filename and include only essential details.

## Custom: Logging Protocol
When the user asks you to “log” or “write a log” for this session:
- Create a log file in `agent-logs/` named `YYYY-MM-DD_HHMM_descriptive-task.md` (24‑hour time; kebab‑case description).
- Follow the template and rules in `agent-logs/README.md` exactly.
- Focus on user intention (underlying goal), document what we accomplished with checkboxes, include bugs/fixes, key learnings, architecture decisions, files modified, and context for future sessions.
- Never overwrite an existing log; create a new file, and reference prior logs if continuing work.

---

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
- `npm run make` / `npm run package`: Build distributables via Electron Forge (arm64). For release builds, prefer `make:env`.
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

## Quick Run & Validate
- Dev app: `npm run dev` (or `npm run dev:local` to target local WS).
- Local worker: from `worker/`, `npm run dev:ws`.
- Lint/tests: `npm run lint` and `npm test`; coverage: `npm run coverage`.
- Build for release: `npm run make:env` (arm64 by default). Publish: `npm run publish:env`.
