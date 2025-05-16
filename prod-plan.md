Below is a *battle-tested* roadmap that folds every item you mentioned into a coherent release programme.  I’ve split it into **(A) architecture & feature work**, **(B) distribution & DevOps**, and **(C) security / privacy hardening**.  Each subsection contains actionable tasks, ownership hints, and “foot-guns to avoid.”  Follow it top-to-bottom and you’ll be in the Microsoft Store with a production-grade app and a clean security posture.

---

## A. Architecture & Feature Work

### 1  Cloud transcription via Groq → Cloudflare Worker

| task                                                 | detail                                                                                                                                                                                                                                                                                                                   | key files to touch                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **A-1.1  Build the Worker**                          | • Use `workers.ai` or a plain C3 Worker with fetch to `https://api.groq.com/openai/v1/audio/transcriptions`.<br>• Add `GROQ_API_KEY` and *rate-limit/Billing tier* env vars via **Wrangler secrets**.<br>• Accept `POST /v1/transcribe` with raw 16 kHz PCM, JSON-stream, or multipart-form.                             | *(new)* `cloudflare/worker.ts`                                                                     |
| **A-1.2  Auth from client**                          | • On launch, obtain a short-lived Supabase JWT (see §B-3) and pass it as `Authorization: Bearer …` to the Worker.  Worker verifies via Supabase Admin API before calling Groq.                                                                                                                                           | `src/hooks/useTranscription.ts`                                                                    |
| **A-1.3  Client fallback logic**                     | • Add a small “capability probe” — ping Worker, if 200 OK use **cloud mode**, else fall back to local Moonshine.<br>• Pipe large audio the same way you already stream to the WASM ASR: `ReadableStream` → `fetch` with `duplex:"half"` so you can send chunks while reading partial JSON responses (Groq supports SSE). | `src/moonshine-worker.ts` (split into `cloud-worker.ts` & `local-worker.ts`, then pick at runtime) |
| **A-1.4  Remove chunking complexity for local mode** | • Moonshine Tiny on WASM already runs in ≤700 ms for short dictations; re-enable *single-pass* inference to simplify maintenance.  Keep your RingBuffer & 16 kHz capture, but delete the KV-cache logic.                                                                                                                 | same                                                                                               |

### 2  Model caching on first install

1. Package **Moonshine-tiny-q8.onnx** in the app’s `resources/models/`; size ≈ 48 MB.
2. In `src/main.ts` first-run hook, copy it into `%LOCALAPPDATA%/sonic‐flow/models` so future auto-updates don’t redownload.
3. For Store submission, put the model in a **Resource Pack** so it’s delta-compressed by MSIX.

### 3  Hotkey change to “Ctrl + Win”

* Electron accelerator string is **`CommandOrControl+Super`**.
* Update `loadSettings()` default, migrate existing settings, and change tooltip text.
* **Windows quirk:** the Win key is swallowed by the shell if no non-modifier key is pressed.  Your combo is fine, but document that on Win 11 it won’t work if the user has a system overlay using the same chord.

### 4  Multi-monitor pill

1. In `src/main.ts` on every (a) hotkey press, (b) `mousemove` throttle, call `screen.getCursorScreenPoint()` and `screen.getDisplayNearestPoint()`.
2. If the display id differs from the pill’s current display, `setPosition()` so the pill hugs the bottom centre of that monitor.
3. Disable on macOS ≤ 10.13 where Electron’s co-ordinate space is off by 2× under retina.

### 5  Home window → Control Centre

* Add React hooks that read **enumerated media devices** (`navigator.mediaDevices.enumerateDevices()`) and populate the “Input device” dropdown live.
* Add toggles for “Use Groq cloud mode”, “Auto-switch screen”, “Enable local fallback”, “Diagnostics”.
* Persist in `settings.json` (already abstracted in `src/lib/settings.ts`).

### 6  Instrumentation with Sentry

* `npm i @sentry/electron`
* In `src/main.ts` initialise with `autoSessionTracking: true, integrations:[new SentryProfilingIntegration()]`.
* In renderer preload expose `window.logError()` that forwards to Sentry so workers/UI can capture exceptions without full Node context.
* Strip stack-trace PII before upload (`beforeSend`).

---

## B. Distribution & DevOps

### 1  MSIX packaging & Microsoft Store

| step      | detail                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **B-1.1** | Switch Forge maker from Squirrel to `@electron/forge-maker-msix` (built-in since Forge 7.4).                                         |
| **B-1.2** | Create a *Partner Center* app submission, reserve “Sonic Flow”, generate Store certificate, add to `packagerConfig.certificateFile`. |
| **B-1.3** | Add `AppxManifest` capabilities: `internetClient`, `microphone`, `userAccountInformation`, `runFullTrust` (for global hotkeys).      |
| **B-1.4** | Store auto-updates come from MSIX flighting; disable your internal auto-update channel on Windows to avoid conflict.                 |

### 2  GitHub Actions CI/CD

1. **Matrix** build (win-x64, mac-universal, linux) with `actions/setup-node`, `actions/setup-java` (MSIX signing).
2. Cache `~/.cache/electron`, `~/.cache/onnx` to keep pipeline < 6 min.
3. On tagged commit `v*`, run Forge make → upload MSIX/MSI/ZIP to *GitHub Release*.
4. On `main` push, push Worker code with `wrangler deploy --env production`.

### 3  Supabase Auth & DB

| table           | columns                                                                         | purpose             |
| --------------- | ------------------------------------------------------------------------------- | ------------------- |
| `users`         | id (uuid, pk), email, created\_at                                               | canonical user info |
| `subscriptions` | id, user\_id ➜ users.id fk, paddle\_subscription\_id, status, tier, expires\_at | payment gating      |

* Use Supabase **Row Level Security**: only allow `auth.uid()` to select its row.
* Generate JWT for Worker verification: `supabase.auth.getSession()` → `access_token`.

### 4  Paddle billing & gating

* Create Paddle “Sonic Flow Pro” plan, web-hook to Supabase Edge Function sets `status='active'`.
* In app: poll `/rest/v1/subscriptions` at launch; cache in IndexedDB; re-validate every 15 min.
* In `useTranscription`, before sending audio, ensure `context.subscriptionActive` – else show “upgrade” notification and block recording.

---

## C. Security & Privacy Audit (current code)

| finding                                                                                                                                                                                          | severity                              | fix                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Context-isolation disabled** in `captureWindow` (`contextIsolation:false`).                                                                                                                    | **High** – allows DOM + Node overlap. | Set `contextIsolation:true`, move DOM→main messaging through a small preload with `contextBridge`.                        |
| **`nodeIntegration` true** in `captureWindow` *and* it loads inline HTML.                                                                                                                        | High                                  | Same as above; never allow Node in a window that consumes untrusted data (the user could paste JS into the hotkey field). |
| **Un-scoped IPC Channels** (`toggle-dictation`, `insert-text-at-cursor`) are fine, but `ipcRenderer.on('reset-ui')` in hotkey HTML uses an un-sanitised `hotkey` string.                         | Medium                                | Escape HTML entities (you already do this in notifications – copy that helper).                                           |
| **`execSync('powershell …')` paste helper** runs user-controlled text? No – text goes to clipboard.  Still, PowerShell invocation can be abused if an attacker can inject environment variables. | Medium                                | Pass `-NoLogo -NoProfile -NonInteractive -Command`, and wrap in try/catch.                                                |
| **COOP/COEP set via `onHeadersReceived`** – good.  But WebGPU flags commented out; make them conditional on platform to avoid exposing experimental features on macOS/Intel GPUs that crash.     | Info                                  | `if (process.platform==='win32') app.commandLine.appendSwitch('enable-unsafe-webgpu')`.                                   |
| **Secrets in renderer** – none found. Keep it that way by proxying Groq through Worker.                                                                                                          |                                       |                                                                                                                           |
| **Supabase anon public key** will live in renderer (needed).  Restrict policies so anon can *only* call auth endpoints.                                                                          |                                       |                                                                                                                           |
| **GlobalShortcut collisions** – registering `Ctrl+Win` may fail if user has PowerToys or Windows-Native overlay.  You already show a dialog – extend wording.                                    |                                       |                                                                                                                           |
| **Auto-update** – Store handles Windows; for mac/Linux keep Forge auto updater **signing** key in GitHub Secrets, not repo.                                                                      |                                       |                                                                                                                           |

---

## Suggested Timeline (realistic pace, one dev)

| week | deliverable                                                      |
| ---- | ---------------------------------------------------------------- |
| 1    | Cloudflare Worker + client fallback, refactor workers.           |
| 2    | Sentry instrumentation, hotkey migration, pill multi-monitor.    |
| 3    | Control Centre UX + microphone selector.                         |
| 4    | Supabase auth, Paddle web-hooks, gating middleware.              |
| 5    | MSIX build, Store submission, model caching.                     |
| 6    | CI/CD pipeline, security hardening fixes, final pen-test & docs. |

---

### Final notes

*Keep the scope tight:* Cloud transcription = better accuracy, local Moonshine = offline resilience – that dual-path is plenty for v1.  Defer fancy diarisation or speaker ID until you have paying users.

Once you’ve ticked the week-6 boxes, you’ll have:

* **Accurate, low-latency dictation** (Groq) with **offline fallback** (Moonshine)
* **Payments & entitlement** enforced in both Cloudflare Worker and client
* **Crash/error telemetry** and **signed MSIX** ready for Microsoft Store
* A clean security posture validated against Electron’s 2025 checklist.

Good luck shipping — and remember: “Ship, then iterate.”