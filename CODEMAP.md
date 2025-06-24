# Code Map for Sonic Flow

This map provides a quick reference for where the main logic lives so you can navigate the codebase efficiently.

## Root files

- `index.html` – HTML entry loaded by Electron.
- `package.json` / `package-lock.json` – Dependencies and npm scripts (build, lint, package).
- `forge.config.ts` – Electron Forge build settings.
- `vite.config.ts` – Shared Vite configuration.
- `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts` – Vite presets for the main process, preload script and renderer.
- `tailwind.config.js` / `postcss.config.js` – Tailwind + PostCSS pipeline.
- `tsconfig.json` – TypeScript options.
- `native/` – Small C helper (`fn-tap.c`) compiled via `build-helper.sh` to `public/assets/fn-tap`. It detects the Fn key for push‑to‑talk.

## `src/` directory

All application logic lives here.

### Entry points

- `main.ts` – Starts the Electron app, creates windows, spawns the `fn-tap` helper, handles IPC and routes transcription requests.
- `preload.ts` – Exposes a safe `window.electron` API to the renderer.
- `renderer.tsx` – React bootstrap that renders `<App>` and `<HomePage>`.
- `index.css` – Global styles.

### Components

Located under `src/components/`.

- `App.tsx` – Floating pill UI that toggles recording using `useTranscription`.
- `HomePage.tsx` – Dashboard and settings window.
- `Pill.tsx` – Visual pill component responding to hover/listening/processing states.

### Hook

- `useTranscription.ts` – Central hook. Manages microphone access, spawns an `AudioWorklet` writing into a `RingBuffer`, then dispatches audio to either a local worker or main‑process transcriber. Inserts returned text at the cursor.

### Workers

- `workers/local-worker.ts` – Runs in a worker thread. Loads an on‑device ASR model from HuggingFace and streams partial transcripts back.
- `workers/groq-transcriber.ts` – Main-process helper that forwards audio to a Cloudflare worker which calls the Groq API.
- `workers/gemini-transcriber.ts` – Similar helper forwarding audio to the Sonic Flow backend to use Gemini.

### Audio utilities

- `audio/ring-buffer.ts` – SharedArrayBuffer backed ring buffer used by the worklet and local worker.

### Types

- `types/*.d.ts` – Global type declarations for Electron and workers.

### Public assets

- `public/assets/` – Icons and the `fn-tap` binary.
- `public/audioworklet-processor.js` – Worklet that captures audio and writes it to the ring buffer.

---

## How it fits together

1. `App.tsx` and the Fn helper send toggle/ptt events which `useTranscription.ts` reacts to.
2. The hook records audio via an `AudioWorklet` into a `RingBuffer`.
   - In local mode `local-worker.ts` processes the buffer directly.
   - In cloud mode the main process drains the buffer and forwards it to `groq-transcriber.ts` or `gemini-transcriber.ts`.
3. Transcripts are inserted into the active application by the main process using `insert-text-at-cursor`.
4. Windows (pill, home, notifications) and tray/menu are all controlled from `main.ts`.

With this overview you can quickly find UI components, transcription engines or main‑process logic without reading every file.
