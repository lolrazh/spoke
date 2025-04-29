Below is a **battle-plan** that starts from first principles (so you know *why* each piece exists) and then breaks the migration into self-contained phases you can ship one by one. I tried to keep the jargon light and the mental model clear—you can hand this to an engineer tomorrow, or keep it as your own PM checklist.

---

### 0.  First-principles refresher – why AudioWorklet + SharedArrayBuffer?

| Stage | MediaRecorder path (today) | AudioWorklet path (target) |
|-------|---------------------------|----------------------------|
| 🎙 Capture | Browser/OS pulls 128-frame blocks at **48 kHz** into an `AudioContext`. | Same, but the blocks are delivered to **your own JS class** (`AudioWorkletProcessor`) in the real-time audio thread. |
| 📦 Packaging | Browser encodes the stream (Opus) & stores it in Blobs → you later decode & copy. | You **never encode**. You write raw `Float32` frames straight into a **ring buffer** that both threads can see. |
| 🚚 Thread hop | `postMessage` (structured-clone) copies ~80 KB per 5 s. | Zero copy: both renderer and worker read the same `SharedArrayBuffer`. |
| 🎚 Resample | `decodeAudioData` gives you 48 kHz PCM → you downsample in JS. | You downsample **on the fly**, sample-perfect, as frames enter the ring buffer. |
| 🗣 ASR | Worker waits for the whole clip, then runs the model. | Worker can pull **rolling windows** (e.g. every 0.5 s) and feed them to Whisper/Moonshine for near-live results. |

Net win for a 5-second utterance on mid-tier hardware: **~300 ms shaved before inference even starts** and memory churn ~⁠0.

---

## Phase 1 – Lay the groundwork (half-day)

1. **Cross-origin isolation (needed for `SharedArrayBuffer`).**  
   In Electron it’s easy:  
   ```ts
   mainWindow = new BrowserWindow({
     /* …other opts… */
     webPreferences: {
       contextIsolation: true,
       sandbox: false,
       // 🔑 Enable SAB
       enableWebSQL: false,
       nodeIntegration: false,
       additionalArguments: ['--enable-features=SharedArrayBuffer'],
     },
   });
   mainWindow.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(true));
   // And in your CSP (index.html) add:
   // Cross-Origin-Opener-Policy: same-origin
   // Cross-Origin-Embedder-Policy: require-corp
   ```
   That pair activates SAB without any flags on Chrome ≥ 115.

2. **Create the files & wiring:**
   ```
   src/audio/
     audioworklet-processor.ts   // runs on real-time audio thread
     ring-buffer.ts              // tiny lock-less SAB helper
     resampler.ts                // 48 kHz → 16 kHz
   ```
   In `vite.renderer.config.ts` make sure the worklet file is built as a plain ES module (no React).

---

## Phase 2 – Ring buffer & resampler (1 day)

> *Goal: a test page that prints incoming sample-counts at 16 kHz.*

1. **Ring buffer API (renderer & worker share the same code):**
   ```ts
   class RingBuffer {
     private readonly buffer: Float32Array;      // Shared
     private readonly head = new Int32Array(sab, 0, 1); // atomic write index
     /* … */
     write(frames: Float32Array) { /* … */ }
     read(n: number): Float32Array { /* … */ }
   }
   // Allocate SAB = 4 bytes × (maxSamples + 1 head index)
   const sab = new SharedArrayBuffer((MAX_SAMPLES + 1) * 4);
   ```
   Use `Atomics.add` / `Atomics.load` so writes from the audio thread never block.

2. **AudioWorkletProcessor**  
   ```ts
   class CaptureProcessor extends AudioWorkletProcessor {
     process(inputs) {
       const input = inputs[0][0];               // Float32[128]
       ring.write(input);                        // Write to SAB @48 kHz
       return true;                              // keep alive
     }
   }
   registerProcessor('capture', CaptureProcessor);
   ```

3. **Downsampler in the worker** (cheapest start: decimate with 3-tap FIR)  
   ```ts
   function downsample48kTo16k(block48: Float32Array) {
     const out = new Float32Array(block48.length / 3);
     for (let i = 0, j = 0; i < out.length; i++, j += 3) {
       // very mild low-pass
       out[i] = 0.25*block48[j] + 0.5*block48[j+1] + 0.25*block48[j+2];
     }
     return out;
   }
   ```
   If you want textbook quality later, swap in `speex-resampler-wasm`, but this gets you stunningly far.

4. **Smoke test** – in the renderer, attach the worklet and log every 1 s:
   ```ts
   await audioCtx.audioWorklet.addModule('audioworklet-processor.js');
   const node = new AudioWorkletNode(audioCtx, 'capture', {
     processorOptions: { sab }                   // hand SAB to processor
   });
   // Connect mic -> worklet (no output)
   navigator.mediaDevices.getUserMedia({ audio: true })
     .then(str => {
       audioCtx.createMediaStreamSource(str).connect(node);
     });
   setInterval(() => {
     const frames = rb.read(16000);              // 1 s @16 kHz
     console.log('frames @16k', frames.length);
   }, 1000);
   ```

---

## Phase 3 – Stream to the ASR worker (1 day)

1. **Worker bootstrap now receives the *same* SAB** (no cloning):
   ```ts
   // renderer
   asrWorker.postMessage({ type: 'init', sab }, [sab]);
   ```
   > The second arg transfers ownership of the SAB pointer, but **both** threads still see it – zero copy.

2. **Worker pull-loop:**
   ```ts
   // pull every 250 ms
   setInterval(() => {
     const block48 = rb.read(12000);          // 250 ms @48 k
     if (block48.length === 0) return;
     const block16 = downsample48kTo16k(block48);
     // append into a second ring or array until user stops talking
   }, 250);
   ```

3. **Stop logic:**  
   When the user hits the hotkey again, you freeze the read index, slice whatever is left, `postMessage` **by reference** (`block16.buffer`) to a second *inference* worker (your existing Whisper / Moonshine worker). If you later want true streaming transcripts, you can send rolling windows instead.

---

## Phase 4 – Replace `MediaRecorder` in `useTranscription` (½–1 day)

*What changes in the React hook:*

| Today | New |
|-------|-----|
| `MediaRecorder` handles start/stop, chunks in `ondataavailable`. | You hold a `started` flag and manually connect / disconnect the `AudioWorkletNode`. |
| You wait for `onstop` to process a Blob. | You already *have* the PCM in the worker; when you call `stop()` you just post a *“flush”* command so the worker assembles the final clip and runs the model. |

Minimal diff inside `useTranscription.ts`:

```diff
- const recorderRef = useRef<MediaRecorder | null>(null);
+ const workletNodeRef = useRef<AudioWorkletNode | null>(null);
+ const sabRef = useRef<SharedArrayBuffer | null>(null);
```

`start()`:

```ts
if (!audioCtxRef.current) {
  audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
  sabRef.current = new SharedArrayBuffer(/* … */);
  /* load worklet, build RingBuffer, etc. */
}
workletNodeRef.current?.connect(audioCtxRef.current.destination); // or a dummy GainNode
setRecording(true);
asrWorker.postMessage({ type: 'startStream' });  // optional
```

`stop()`:

```ts
workletNodeRef.current?.disconnect();
setRecording(false);
asrWorker.postMessage({ type: 'flush' });       // worker now finalises + runs ASR
```

No Blobs, no decode, no `postMessage` copies.

---

## Phase 5 – Polish & measure (1 day)

1. **Logging hooks:** track `capture→flush` time in the worker, compare with the old 300 ms overhead.  
2. **Memory:** watch Chrome’s *Audio* and *ArrayBuffer* tracks—should be flat.  
3. **Fallback path:** if SAB isn’t available (exotic hardened environments), auto-degrade to the old MediaRecorder code-path; wrap both behind a feature-flag in the hook.

---

## (Optional) Phase 6 – Near-live partials (2–3 days)

*Not in scope right now, but this becomes trivial once the stream is in the worker: every 1 s you can run Moonshine with `chunk_start = previous_offset` and get incremental captions.*

---

### Cheat-sheet of deliverables

| Phase | PR contents | Should compile? |
|-------|-------------|-----------------|
| 1 | `ring-buffer.ts`, skeleton `audioworklet-processor.ts`, CSP headers | ✅ |
| 2 | Working downsampling demo page under `/dev/audio-test.html` | ✅ |
| 3 | Worker reads SAB, unit tests for RingBuffer wrap/unwrap | ✅ |
| 4 | Replace `MediaRecorder` path, keep old code behind `if (legacyCapture)` | ✅ |
| 5 | Profiling markdown update (`profiling-results.md`) with new “AudioWorklet Baseline” row | ✅ |

---

## Quick FAQ

**Why 48 kHz in the Worklet first?**  
Browser hardware clocks run at 44.1/48 kHz. Forcing a 16 kHz `AudioContext` often incurs an *extra* resample inside the browser, so we take the native rate and downsample ourselves once—cheaper overall.

**Will SharedArrayBuffer break on macOS + Intel?**  
No. Chrome 115+ and Electron ≥ 25 ship site-isolation; the COOP/COEP headers you added unlock SAB everywhere unless the user has “Block third-party cookies” *and* you load a remote iframe. Sonic Flow is all local.

**Can I stick the downsampler inside the AudioWorklet instead?**  
You can, but the real-time thread must finish in < 2 ms; FIR on 128 frames is negligible, yet keeping it in the worker avoids surprising xruns if you later add VAD or multiple inputs.

---

### Final thought

> **“Text at the speed of thought only works when audio reaches the GPU before you finish your sentence.”**  

This migration erases the copy-fest, keeps memory flat, and opens the door to live captions. When you ship Phase 4, your *slowest* clip (45 s) will show a timestamp that starts ~300 ms earlier—users feel that as magic. ✨