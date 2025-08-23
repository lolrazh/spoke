# Vitest & CI Proposal

This proposal adds fast, reliable tests for Sonic Flow (Electron + Vite + React + Cloudflare Worker) while avoiding OS/hardware flakiness common in dictation apps.

## Why Test a Dictation App
- Validate audio device logic, PCM transforms, buffering, and reconnect paths.
- Keep UI recording state and feedback consistent across refactors.
- Catch regressions in worker/WebSocket flows without depending on real devices or entitlements.

## How Production Electron Apps Do It
- Unit tests for pure logic and React views with a lightweight DOM env (Vitest + Testing Library + happy-dom).
- Integration tests that mock `electron` to assert main/preload behavior (window options, protocols, IPC guards).
- Optional E2E smoke on macOS using Playwright’s Electron runner for “app boots, tray/menu exists, record toggle flips state”.

## Proposed Layers
- Unit (Vitest): `src/utils/*`, `src/hooks/*`, React components in `src/components/*`.
- Integration (Vitest, node env): `src/main.ts`, `src/preload.ts` with `vi.mock('electron', …)`.
- Worker (Vitest + Miniflare or CF vitest pool): HTTP routes + WS upgrade handlers in `worker/`.
- E2E (optional): Playwright Electron smoke tests on `macos-latest` as non-blocking initially.

## Tooling & Config
- Dependencies: `vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom happy-dom @vitejs/plugin-react`.
- Optional worker: `miniflare` or `@cloudflare/vitest-pool-workers` (choose one).
- Scripts (root `package.json`):
  - `test`: `vitest run`
  - `test:watch`: `vitest`
  - `coverage`: `vitest run --coverage`
- `vitest.config.ts` (root):
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'worker/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8', reports: ['text', 'lcov'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
```
- `src/test/setup.ts`: import `@testing-library/jest-dom`; shim `navigator.mediaDevices`, `AudioContext`, and a minimal `window.electron` IPC shape when needed.
- Test naming: co-locate as `*.test.ts(x)` next to source.

## CI Pipelines (GitHub Actions)
- `.github/workflows/test.yml`:
```yaml
name: Tests
on: [push, pull_request]

jobs:
  lint-and-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run test -- --reporter=dot
      - run: npm run coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-lcov
          path: coverage/lcov.info

  worker-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run test -- --dir worker

  e2e-macos:
    runs-on: macos-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run e2e # optional, add when ready
```

## Targeted Test Ideas
- `src/utils/pcm.ts`: float32 → 16-bit PCM, clamping, empty chunks.
- `src/utils/micDevices.ts`: device enumeration, default selection, permission errors.
- `src/hooks/useTranscription.ts`: reconnect backoff, partial/final ordering, heartbeat timeouts (fake timers + mocked WS).
- `src/components/SettingsPanel.tsx`: toggles, persistence, devtools flag.
- `src/main.ts`: BrowserWindow options, `sonicflow://` protocol registration (mock `protocol`), single-instance guard.
- Worker: `/health` route, WS upgrade, auth header presence, error mapping.

---

## TODO Roadmap

### Core Setup
- [X] Add devDeps: vitest, Testing Library, happy-dom, @vitejs/plugin-react.
- [x] Add `vitest.config.ts` with alias `@` and happy-dom.
- [x] Create `src/test/setup.ts` with DOM matchers and audio/Electron shims.
- [x] Add npm scripts: `test`, `test:watch`, `coverage`.

### Unit Tests (Utils & Hooks)
- [x] Seed tests for `pcm.ts` edge cases.
- [x] Seed tests for `micDevices.ts` (permissions, no devices).
- [x] Seed tests for `useTranscription` with mocked `WebSocket` and fake timers.
- [x] Seed tests for `audioFeedback.ts` lifecycle behavior.

### Renderer Components
- [ ] Install `@testing-library/react` + `user-event`.
- [ ] Add tests for `SettingsPanel` (toggle, persist, UI states).
- [ ] Add tests for `Onboarding` flow (if applicable).

### Main/Preload Integration
- [ ] Add tests for `main.ts` using `vi.mock('electron')` (window opts, protocol).
- [ ] Add tests for `preload.ts` IPC exposure and guard rails.

### Worker Tests
- [ ] Choose runner: Miniflare or `@cloudflare/vitest-pool-workers`.
- [ ] Add route tests (`/health`, WS handshake, error paths).

### E2E (Optional, Non-blocking)
- [ ] Add Playwright with Electron runner and a smoke test.
- [ ] Gate on macOS, `continue-on-error: true` initially.

### CI & Reporting
- [ ] Add `.github/workflows/test.yml` with lint, unit, worker, and optional macOS E2E.
- [ ] Upload `coverage/lcov.info` as artifact; wire to codecov/coveralls if desired.

### DX & Maintenance
- [x] Document test conventions in `AGENTS.md`/this file.
- [ ] Add fast path in pre-commit (optional): `lint-staged` to run vitest on changed files.

---

Notes
- Keep tests deterministic by mocking audio, WebSocket, and Electron. Avoid real device/mic access.
- Start with unit coverage; add E2E only for smoke once unit coverage is stable.
