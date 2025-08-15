# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/`
  - Main process: `src/main.ts`, preload: `src/preload.ts`
  - Renderer entry: `src/renderer.tsx`, styles: `src/index.css`
  - UI and logic: `src/components/`, `src/hooks/`, `src/utils/`, `src/constants/`, `src/config/`, `src/types/`
- Assets: `public/` (e.g., `public/assets/`, fonts, worklets)
- Native helper: `native/` (e.g., `native/sonic-helper.c`, `native/build-helper.sh`)
- Build output: `.vite/` (dev) and `out/` (packaged app)
- Config: `forge.config.ts`, `vite.*.config.ts`

## Build, Test, and Development Commands
- `npm start`: Run the Electron app in development (Forge + Vite).
- `npm run make`: Create a distributable build (arm64 macOS) in `out/`.
- `npm run package`: Package without an installer for local inspection.
- `npm run lint`: Lint TypeScript/TSX with ESLint.
- `npm run clean`: Remove `out/` artifacts.

Example: `npm ci && npm start`

## Coding Style & Naming Conventions
- Language: TypeScript (TS/TSX), React in renderer.
- Formatting: Prettier defaults; run your editor’s Prettier on save.
- Linting: ESLint with `@typescript-eslint` and `import` rules.
- Naming: PascalCase for React components (`AudioPanel.tsx`), camelCase for functions/variables, UPPER_SNAKE_CASE for constants.
- File organization: Co-locate UI in `src/components/` (subfolders like `ui/`, `icons/`), shared logic in `src/lib/` or `src/utils/`.

## Testing Guidelines
- No formal automated test suite yet. Provide manual test steps in PRs.
- If adding tests, prefer co-located `*.test.ts(x)` or `__tests__/` near code. Keep tests deterministic and runnable headlessly where possible.
- Include screenshots or short screen recordings for UI changes.

## Commit & Pull Request Guidelines
- Commits: Clear, imperative subject (max ~72 chars). Group related changes.
  - Example: `fix(auth): validate deep-link scheme on login`
- PRs: Include summary, rationale, testing steps, and any screenshots. Link related issues. Note any native (`native/`) or build config changes.
- Keep diffs focused; avoid unrelated formatting noise.

## Security & Configuration Tips
- Secrets: Never commit secrets. Use `.env` (see `forge.env.d.ts`) and document required vars in the PR.
- macOS packaging/signing is project-specific; coordinate before changing `forge.config.ts` or entitlements.
