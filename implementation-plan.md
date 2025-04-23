Below is a **single, end-to-end implementation plan** for replacing Sonic Flow’s Groq-API pipeline with an **on-device Whisper (WebGPU / WASM-SIMD) pipeline**.  
It is split into two views:

* **A. Product-level narrative** – language you can present to the CEO & GTM folks.  
* **B. Engineering playbook** – drop-in steps, code snippets, timelines, and risk notes.

Feel free to forward the whole thing to the team; nothing here depends on proprietary IP.

---

## A • Why this pivot matters (exec summary)

| Dimension | Groq (today) | Local Whisper (pivot) |
|-----------|--------------|-----------------------|
| **Latency** | 300-900 ms (network-bound) | 60-250 ms (GPU) or 400-500 ms (CPU) |
| **Privacy / compliance** | Audio leaves device → SOC 2 scope, DPA, etc. | Audio never leaves device → ✅ privacy, ✅ air-gapped orgs |
| **Unit cost** | $0.02–$0.06 / min (Groq large) | $0 (fixed download) |
| **Pricing story** | Subscription only | *One-time license* for local model |
| **Resilience** | Internet, Groq uptime | Works on airplanes, in basements, after we pivot again |
| **Strategic moat** | We rent a model | We **own** the offline UX that no web tool can match |

**Positioning headline**  
> *“Sonic Flow – the only dictation pill that works offline, online, everywhere.”*

---

## B • Engineering playbook

> Target release: **3 sprints / 6 weeks** (1 sprint spike → 2 sprints feature → hardening).

### 0. Prep: pick the model & format

| Model | Size | VRAM @ fp32/q4 | Word error rate | Ship? |
|-------|------|---------------|-----------------|-------|
| `onnx-community/whisper-tiny-en-q4` | 29 MB | 45 MB | 12-14 % | **Bundled** (default) |
| `onnx-community/whisper-base-en-fp32` | 147 MB | 210 MB | 9-10 % | Optional download |
| Future: `distil-whisper-medium-q4` | 270 MB | 370 MB | 7-8 % | “Pro Accuracy” add-on |

All are ONNX; no license blockers.

---

### 1. Folder structure delta

```
/models/                      ◂— new (extraResources)
/renderer/stt/
/renderer/stt/useDictation.ts
/renderer/stt/useWhisperWorker.ts
/renderer/stt/whisper-worker.js
/preload/dictationBridge.ts
```

---

### 2. Renderer → new React hook

```tsx
// renderer/stt/useDictation.ts
import { useWhisperRecorder }  from './useWhisperRecorder'   // 95 % identical to OS1
import { useEffect, useState } from 'react'

export function useDictation(opts: {
  onPartial(text: string): void
  onFinal(text: string, audio: Float32Array): void
  onError(err: string): void
}) {
  const { startRecording, stopRecording,
          isRecording, transcriptionReady, error } =
        useWhisperRecorder({
          onTranscriptionUpdate: opts.onPartial,
          onSilenceDetected:  opts.onFinal,
          onTranscriptionComplete: opts.onFinal
        });

  useEffect(() => { if (error) opts.onError(error) }, [error])

  return { start: startRecording, stop: stopRecording, isRecording, ready: transcriptionReady }
}
```

*Hook lives entirely in the renderer – **no Node APIs** used.*

---

### 3. Web-worker (unchanged from OS 1)

* `whisper-worker.js` loads the ONNX model with **@huggingface/transformers.js**.  
* It auto-selects **WebGPU** (fast) or **WASM-SIMD** (CPU fallback).  
* The worker returns `{status:'complete', output:[text]}` exactly like Groq IPC did.

---

### 4. Preload bridge

```ts
// preload/dictationBridge.ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('dictation', {
  supportsLocal: !!navigator.gpu,
  start: () => window.dispatchEvent(new Event('__dictation_start')),
  stop : () => window.dispatchEvent(new Event('__dictation_stop'))
})
```

In the renderer:

```ts
window.addEventListener('__dictation_start', () => dictation.start())
window.addEventListener('__dictation_stop',  () => dictation.stop())
```

*The React pill UI toggles recording exactly the same way as before (hotkey → preload → renderer).*

---

### 5. Main-process changes

* **Remove** `ipcMain.handle('transcribe-audio', …)` path from `main.ts`.  
* **Keep** the function around but wrap it:

```ts
if (!navigator.gpu) {
  // fallback to Groq
}
```

*No audio temp-file write needed for local path.*

---

### 6. Electron flags

```ts
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('disable-webgpu-sandbox');  // Electron 35 quirk
if (process.platform === 'darwin')
  app.commandLine.appendSwitch('enable-features', 'MetalApi,WebGPUDeveloperFeatures');
```

---

### 7. Packaging tweaks (forge.config.ts)

```ts
makers: [ /* existing */ ],
plugins: [ /* existing */ ],
extraResources: [
  { from: 'models/whisper-tiny-en-q4', to: 'models', filter: ['**/*.onnx'] }
]
```

In the worker load with:

```js
const modelPath = path.join(process.resourcesPath, 'models', 'whisper-tiny-en-q4');
UltravoxModel.from_pretrained(modelPath, …)
```

---

### 8. UX adjustments

* **Settings → “Speech engine”**  
  * Local (tiny – default)  
  * Local (download base – button)  
* **Banner** if WebGPU unavailable:  
  “We’re running the slower CPU engine; accuracy unchanged, dictation may lag.”  
* **First-launch download** progress bar when upgrading to base model (reuse your existing update bar).

---

### 9. QA / regression matrix

| Scenario | Expectation |
|----------|-------------|
| Win 11 + RTX | ≤ 100 ms lag, GPU in task manager spikes |
| Win 10 + Intel UHD 620 | ≤ 300 ms lag, CPU 50 % |
| WebGPU blacklisted | Fallback to CPU, banner shown |
| Airplane mode | Dictation works, Cloud mode disabled |
| Old Sandy-Bridge | `navigator.gpu` false → UI forces Cloud |

Automated tests can simulate `navigator.gpu = undefined`.

---

### 10. Timeline

| Week | Deliverable |
|------|-------------|
| 1 | Spike: clone OS 1 STT, demo worker compiling on WebGPU & CPU on dev machine. |
| 2 | Preload bridge, React hook, pill UI integrated; silent fallback to Cloud. |
| 3 | Settings panel, progress bar for model download, feature flags. |
| 4 | Windows installer incl. ONNX; latency bench on 4 HW profiles; fix crashes. |
| 5 | macOS & Linux builds, docs, enterprise privacy one-pager. |
| 6 | Hardening: fuses, memory leak audit, telemetry counters, marketing site update. |

---

### 11. Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPU blacklist / drivers | Users think app is frozen | CPU fallback + toast |
| Bundle bloat (30 MB) | Download friction | Keep installer < 60 MB; allow “download later” |
| WASM path too slow on very old CPUs | Bad UX | Block install < 2015 CPUs or force Cloud |
| Transformer.js version drift | Build fails | Lock to `^3.5.0`, add e2e smoke test in CI |

---

## One-pager pitch (steal this slide)

> **Sonic Flow 2.0 – Offline Dictation**
>
> * Runs on the user’s GPU or CPU – zero audio leaves the machine.  
> * 3× faster average latency, 0¢ unit cost.  
> * New price plan: **$39 one-time “Local”**
> * Ships in six weeks with no server rewrite, re-using 80 % of current code.  
> * Gives us a differentiated privacy story no browser extension can match.