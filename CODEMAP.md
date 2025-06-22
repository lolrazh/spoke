# Code Map for Sonic Flow

This document explains how the pieces of the project fit together. Each section lists important files and describes the processes they participate in so an LLM or developer can jump to the right part of the code base without spending context on unnecessary files.

## Root files

- `index.html` – Main HTML wrapper used by Electron. The renderer bundle is injected here when the app starts.
- `package.json` / `package-lock.json` – Define dependencies and npm scripts. Builds (`npm run build`), lint (`npm run lint`), packaging (`npm run make`) and other commands are declared here.
- `forge.config.ts` – Electron Forge configuration controlling how distributables are built.
- `vite.config.ts` – Base Vite configuration shared across processes.
- `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts` – Vite presets used to bundle the main process, preload scripts and renderer respectively.
- `tailwind.config.js` and `postcss.config.js` – Styling pipeline for Tailwind CSS.
- `.eslintrc.json` – ESLint rules for TypeScript/React code.
- `tsconfig.json` – Global TypeScript compiler options shared by the entire repo.

## `src/` directory overview

This folder contains all application source code. The logic is split across the Electron main process, preload scripts, the React renderer and several workers.

### Process entry points

- `main.ts` – Boots the Electron app. Creates windows (pill, home, notification), registers global shortcuts, and wires up IPC handlers for transcription and text insertion. It orchestrates the overall workflow.
- `preload.ts` – Runs in the renderer context and exposes a minimal `window.electron` API used by React components. This ensures the renderer cannot access Node APIs directly.
- `renderer.tsx` – Entrypoint for React. Renders `<App>` and `<HomePage>` via React Router.
- `index.css` – Global styles including Tailwind utilities.

### Components

These reside in `src/components/` and form the user interface.

- `App.tsx` – Main React component containing the floating "pill" that the user interacts with. It uses the `useTranscription` hook to start and stop recording.
- `HomePage.tsx` – Dashboard and settings window opened from the native macOS tray menu.
- `Pill.tsx` – Renders the pill UI. Hover, listening and processing states change the visualization. Clicking toggles transcription. This is the best place to modify pill colors or animations.

### Custom hook

- `useTranscription.ts` – Central hook implementing both local and cloud transcription modes. It manages microphone access, starts an `AudioWorklet` to write audio to a shared `RingBuffer`, then either sends data to a local worker or forwards it to the main process for Groq/Gemini transcription. When text is returned it uses the `window.electron` API to insert the transcript at the cursor.

### Workers and transcription engines

Workers isolate heavy tasks from the UI.

- `workers/local-worker.ts` – Loads an on‑device ASR model using `@huggingface/transformers`. Reads audio from the shared ring buffer, performs streaming inference and posts partial/final transcripts back to the hook.
- `workers/groq-transcriber.ts` – Runs in the main process. Accepts audio buffers and calls the Groq API.
- `workers/gemini-transcriber.ts` – Also in the main process, forwarding audio to the Sonic Flow backend which in turn talks to Google Gemini.

### Audio utilities

- `audio/ring-buffer.ts` – Implements a SharedArrayBuffer backed ring buffer used by the `AudioWorklet` and local worker. This allows audio to flow from the renderer to the worker without copying.

### Main process helpers

- `main/alt-listener.ts` – Listens for the right‑Alt key to provide push‑to‑talk functionality. Sends `ptt-down` / `ptt-up` events via IPC which `useTranscription` consumes.

### Supporting libraries and types

- `types/*.d.ts` – TypeScript definitions for Electron/worker globals.

### Public assets

- `public/assets/` – App icons and images bundled with the app.
- `public/audioworklet-processor.js` – AudioWorklet processor responsible for resampling and writing microphone data into the shared ring buffer.

---

## How the pieces connect

1. `App.tsx` calls functions from `useTranscription.ts` when the pill is pressed or when the right‑Alt key state changes (via `alt-listener.ts`).
2. `useTranscription.ts` starts an `AudioWorklet` and writes samples into a `RingBuffer`. In local mode, `local-worker.ts` reads from this buffer and produces transcripts. In cloud mode the hook stops the worklet, drains the buffer and asks the main process to send the audio to `groq-transcriber.ts` or `gemini-transcriber.ts`.
3. The main process receives transcripts and uses `insert-text-at-cursor` to paste them into the focused application. Notifications are displayed via the notification window when operations succeed or fail.
4. The main process handles all transcription routing and text insertion, with user preferences managed directly in the interface components.

With this map an agent can immediately identify where specific behaviour lives—for example, to adjust the pill UI open `src/components/Pill.tsx`, while changes to transcription backends happen in `src/workers/`. For a broader project introduction see `README.md`.
