Below is a **ground-up, cut-the-fat migration plan** that keeps the Electron/React UI you like, but **replaces every line of your speech-to-text “back-end” with the tidy two-file WebGPU Whisper demo** you pasted.  
Read it start-to-finish once, then work through the phases in order – don’t interleave steps.

---

## PHASE 0 – Mental model & goals (read, don’t code)

| What to keep | What to trash | What to add |
|--------------|--------------|-------------|
| • All UI/UX files (Pill, HomePage, router, Tailwind theme, Tray/context-menu logic, hot-key capture window, clipboard insertion routine).<br>• `main.ts` responsibilities that are **not** STT-related (global shortcut, tray menu, window management, log file, insert-at-cursor). | • Every file in **`src/stt`**.<br>• All code in `main.ts` and `preload.ts` that tries to talk to those `src/stt` hooks or log model-loading progress.<br>• `public/models` and packager rules that copy it – we’ll download models on first run just like the demo.<br>• All Groq remnants already commented out. | • A single **worker** (`src/whisper-worker.ts`) – TS port of the demo’s `worker.js`.<br>• A single **recorder/worker orchestration hook** (`useTranscription.ts`) distilled from the demo’s `App.jsx`.<br>• A leaner `App.tsx` that wires Pill ↔ hook ↔ clipboard.<br>• CSP & Vite tweaks so the worker bundles and HF downloads are allowed. |

---

## PHASE 1 – Delete with prejudice

1. **Nuke the old STT directory**  
   ```bash
   rm -rf src/stt
   ```
2. **Purge imports**  
   * Open every file that imported from `src/stt` (only `App.tsx`). Remove those imports and all state that referenced them. We’ll rebuild in Phase 4.
3. **Strip model-progress plumbing in `main.ts` & `preload.ts`**  
   * Delete the whole `ipcMain.on('log-progress' …)` handler in `main.ts`.  
   * Delete the `logProgress` API exposed in `preload.ts` and its typedef in `src/types/electron.d.ts`.
4. **Remove packager resources no longer needed**  
   * In `forge.config.ts` delete  
     ```ts
     asar: { unpackDir: 'public/models' },
     extraResource: ['public/models'],
     ```  
   * Also delete the `public/models` folder itself.

> **Checkpoint:** `npm run make` still packages and the app launches (it won’t dictate yet). If it fails you deleted too much – fix before continuing.

---

## PHASE 2 – Add the new worker

1. **Create `src/whisper-worker.ts`** (TypeScript twin of the demo’s `worker.js`).  
   * Change `import … from '@huggingface/transformers'` exactly as in the demo.  
   * Keep `onnx-community/whisper-base` and WebGPU device selection.  
   * Replace all `self.postMessage({ … })` status strings with the *same* values the demo uses (`loading`, `initiate`, `progress`, `done`, `ready`, `start`, `update`, `complete`). We’ll reuse them verbatim in the hook.
2. **Tell Vite to treat it as a dedicated worker**  
   * In **`vite.config.ts`** add  
     ```ts
     worker: { formats: ['es'] },
     ```
     so Rollup keeps it ES-module style (Electron 35 can load it).

---

## PHASE 3 – Make room for the new hook

1. **Add `src/hooks/useTranscription.ts`** (or keep it next to the worker – your call). Minimal shape:

   ```ts
   import { useRef, useState, useEffect, useCallback } from 'react';

   const WHISPER_SR = 16_000;
   const MAX_SAMPLES = WHISPER_SR * 30;

   export function useTranscription() {
     const workerRef = useRef<Worker>();
     const recorderRef = useRef<MediaRecorder>();
     const audioCtxRef = useRef<AudioContext>();
     const [stream, setStream] = useState<MediaStream>();
     const [recording, setRecording] = useState(false);
     const [processing, setProcessing] = useState(false);
     const [ready, setReady] = useState(false);
     const [text, setText] = useState('');
     const [error, setError] = useState<string | null>(null);

     /* 1️⃣ Boot worker once */
     useEffect(() => {
       if (workerRef.current) return;
       workerRef.current = new Worker(
         new URL('../whisper-worker.ts', import.meta.url),
         { type: 'module' }
       );

       workerRef.current.onmessage = (e) => { /* copy demo switch-case, set React state */ };
     }, []);

     /* 2️⃣ Ask for mic & build MediaRecorder once */
     useEffect(() => {
       (async () => {
         if (stream) return;
         try {
           const s = await navigator.mediaDevices.getUserMedia({ audio: true });
           setStream(s);
           recorderRef.current = new MediaRecorder(s);
           audioCtxRef.current = new AudioContext({ sampleRate: WHISPER_SR });
           // wire ondataavailable exactly like the demo
         } catch (err) {
           setError('mic permission denied');
         }
       })();
     }, [stream]);

     /* 3️⃣ Pump chunks to worker whenever we’re recording & not already processing */
     /* replicate the demo’s effect with chunks[] but hide chunks inside useRef to cut garbage */

     /* 4️⃣ public API */
     const start = useCallback(() => {
       if (!ready || recording) return;
       recorderRef.current?.start();
     }, [ready, recording]);

     const stop = useCallback(() => {
       recorderRef.current?.stop();
     }, []);

     return { recording, processing, ready, text, error, start, stop };
   }
   ```

   > No need for separate Recorder & Recognition hooks – the demo proves a single hook is simpler.

---

## PHASE 4 – Refactor `App.tsx`

1. **Replace all old hook imports** with:

   ```ts
   import { useTranscription } from '../hooks/useTranscription';
   ```
2. **State mapping**  

   | Old state | New |
   |-----------|-----|
   | `recorder.isRecording` | `trans.recording` |
   | `recognizer.isModelLoading` | `!trans.ready` *(invert)* |
   | `recognizer.isTranscribing` | `trans.processing` |
   | `recognizer.transcriptionText` | `trans.text` |
   | `recorder.error` / `recognizer.error` | `trans.error` |

3. **Hot-key callbacks** stay the same: if `trans.recording` → `trans.stop()`, else `trans.start()`.
4. **Clipboard insertion** – identical; keep `window.electron.insertTextAtCursor`.
5. **Kill all logic that forwarded progress to `ipcMain` – it no longer exists.**

---

## PHASE 5 – Dependencies & build tweaks

1. **Package.json**

   *Remove*
   ```json
   "@xenova/transformers": "...",
   ```
   *Add*
   ```json
   "@huggingface/transformers": "^3.5.0",
   "onnxruntime-web": "^1.19.0"
   ```
   (Transformers will pull the right ORT sub-dependency automatically but pinning is safer).

2. **TypeScript shims**

   Add to `src/types/worker.d.ts`:

   ```ts
   declare module '*?worker' {
     const mod: new () => Worker;
     export default mod;
   }
   ```

3. **Content-Security-Policy**

   In `index.html` extend `connect-src` to include the HF model repo:

   ```html
   connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net blob:;
   ```

   (Already present – good; just ensure no extra quotes).

---

## PHASE 6 – Clean `main.ts`

*Delete* everything marked below:

```ts
// ⛔ DELETE
ipcMain.on('log-progress', ...);

// also remove the import of execSync used only for log-progress
```

Nothing else in `main.ts` touches the STT pipeline now.

---

## PHASE 7 – Dev-build & test

1. `npm i`
2. `npm run start`  
   * Watch terminal: first load will download ~200 MB – allow time.  
   * Whisper model compiles, `ready` becomes true.
3. Press your global hot-key  
   * Pill shows recording animation → processing dots → output inserts at cursor / copies to clipboard.
4. Toggle dark/light theme, HomePage, tray menu – ensure nothing broke.

---

## PHASE 8 – Packaging sanity

1. `npm run make` → install the `.exe` / `.dmg`; check first-run downloads still succeed (no `public/models` packed).
2. Sign & notarise when you’re ready – nothing STT-specific affects codesign.

---

### What we **deleted** (summary checklist)

- `src/stt/**`
- `Implementation-plan.md` (superseded)
- STT IPC & progress logging in `main.ts`, `preload.ts`, typedefs.
- Packager ASAR `unpackDir` + `extraResource` entries.
- `public/models`

### What we **added**

```
src/whisper-worker.ts
src/hooks/useTranscription.ts
vite.config.ts  →  worker.formats = ['es']
index.html CSP tweak
package.json deps: @huggingface/transformers, onnxruntime-web
src/types/worker.d.ts
```

---

## Final advice

*   Don’t optimise prematurely – let the official JS cache store the model (~`AppData/…/Cache`) and focus on UX polish.
*   If you later need full offline installers, re-add `public/models` and set `env.localModelPath`, but that’s a one-liner when/if required.
*   Keep all STT logic on the renderer thread. The main process now has zero ML baggage, making future maintenance (auto-updates, code-signing, Apple notarisation) **much** easier.