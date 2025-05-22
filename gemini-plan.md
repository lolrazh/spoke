Below is a pragmatic, file-by-file integration plan that plugs **Gemini 2.0 Flash** into Sonic Flow alongside your existing Groq path.  Nothing here overwrites the Groq flow—you’ll be able to flip between providers at runtime (or even A/B-test).

---

### 0  Prerequisites

| What                                                 | Why / Notes                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@google/genai >= 1.0.1` (already in `package.json`) | Ships the Files API helper and inlineData helpers needed for audio.                                                                                               |
| `GEMINI_API_KEY` in `.env`                           | Same pattern as `GROQ_API_KEY`.                                                                                                                                   |
| Audio ≤ 20 MB per request                            | Inline base-64 payloads are capped at 20 MB total request size, otherwise you must upload first and pass the returned `file_uri`. ([Google AI for Developers][1]) |

---

### 1  `/src/workers/gemini-transcriber.ts`

You already stubbed the file; the logic you wrote (inline ➜ Files API fallback) exactly mirrors Google’s example, so only two tidy-ups are left:

1. **Strict MIME detection** – derive it from the recorder’s blob (`audioBlob.type`) instead of defaulting to `audio/wav`.
2. **Return shape** – have the exported helper resolve to `{ text: string }` so it’s symmetrical with Groq (which returns just `string`).

*(No code paste here; your stub already follows the sample in the docs, see JS example lines 29-31.)* ([Google AI for Developers][1])

---

### 2  Main-process glue (`src/main.ts`)

```ts
// top
import { transcribeAudioWithGemini } from './workers/gemini-transcriber';

// inside ipcMain handlers block
ipcMain.handle('transcribe-gemini', async (_e, arrayBuffer: ArrayBuffer) => {
  if (!arrayBuffer || !arrayBuffer.byteLength) throw new Error('Empty audio buffer');
  return await transcribeAudioWithGemini(arrayBuffer);
});
```

*(Mirrors the existing `transcribe-groq` handler.)*

---

### 3  Preload (`src/preload.ts`)

Add a typed bridge:

```ts
contextBridge.exposeInMainWorld('electron', {
  // …
  transcribeGemini: (buf: ArrayBuffer, transfer?: Transferable[]) =>
    ipcRenderer.invoke('transcribe-gemini', buf, transfer),
});
```

…and extend `src/types/electron.d.ts` accordingly.

---

### 4  Renderer hook (`src/hooks/useTranscription.ts`)

1. **Add provider selector**

```ts
type CloudEngine = 'groq' | 'gemini';
const [cloudEngine, setCloudEngine] = useState<CloudEngine>('groq');
```

2. **Dispatch to the right IPC** inside the `MediaRecorder.onstop` Promise chain:

```ts
const transcriptPromise =
  cloudEngine === 'groq'
    ? window.electron.transcribeGroq(arrayBuffer, [arrayBuffer])
    : window.electron.transcribeGemini(arrayBuffer, [arrayBuffer]);
```

3. **Expose setter**:

```ts
return { /* existing */, cloudEngine, setCloudEngine };
```

Everything else (start/stop logic, ArrayBuffer transfer, clipboard insertion) stays identical.

---

### 5  UI & settings

| *File(s)*                                    | *Change*                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/components/HomePage.tsx` (Settings tab) | Add a `<select>` for “Cloud engine – Groq / Gemini”. On `onChange`, call `setCloudEngine`.      |
| `src/components/App.tsx` *(optional)*        | Show a subtle provider badge on the Pill while processing so users know which backend answered. |

---

### 6  Environment & build

1. Add `GEMINI_API_KEY=` to your sample `.env.example`.
2. No extra bundler config—Vite already tree-shakes.

---

### 7  Test matrix

| Scenario             | Expected                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Short clip (< 20 MB) | `inlineData` path; latency ≈1–1.3 s (Flash).                                                     |
| Long clip (> 20 MB)  | Worker uploads via Files API then calls `generateContent`; latency depends on file size.         |
| Missing key          | Renderer receives IPC error → hook sets `error`, notification shows.                             |
| Provider swap        | Starting a new recording after toggling the drop-down routes to the new provider without reload. |

---

### 8  Performance & cost notes

* Gemini Flash pricing (as of May 2025) is slightly higher than Groq’s Whisper-large—keep an eye on quota.
* The 20 MB inline limit is strict; your fallback logic already handles it. ([Google AI for Developers][1])
* Latency is dominated by upload + model generation; on a 15 KB/s uplink, 10 MB ≈ 7 s just to push bytes—run local WASM as a fallback for bad networks.

---

### 9  Optional niceties

* **Formatter prompts** – prepend user-selected instructions (“remove filler words”, “Markdown headings”, etc.) before the audio part.
* **Hybrid cascade** – send first to Gemini; if it returns an error >3 s, fallback to Groq automatically.
* **Caching** – hash ArrayBuffer and store transcripts in IndexedDB to avoid re-billing on repeats.

Implement the bullet points above and Sonic Flow will support multimodal Gemini transcription with zero regression to your existing Groq flow. Happy hacking!

[1]: https://ai.google.dev/gemini-api/docs/audio "Audio understanding  |  Gemini API  |  Google AI for Developers"
