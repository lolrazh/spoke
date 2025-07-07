# Sonic Flow – Groq Transcription Latency Audit  

## 0. Executive Summary
We measured an end-to-end latency of **2 239 ms**.  
Four stages consume **> 100 ms** and account for **~90 %** of the time:

| Stage | Time (ms) | % of Total |
|-------|-----------|-----------|
| main-process-total | 1 389 | 62 % |
| edge-travel | 401 | 18 % |
| worker-total | 220 | 10 % |
| upstream-ttfb | 220 | 10 % |

Shaving these to < 100 ms each takes us under one second E2E.

---

## 1. Timing Heat-Map

name                ms
---

audio-concat        0.44
audio-trim          0.63
ipc-to-main         4.40
main-process-total  1 389.20   ◀︎ **HOT**
edge-travel         401        ◀︎ **HOT**
worker-total        220        ◀︎ **HOT**
upstream-ttfb       220        ◀︎ **HOT**
download            3
ipc-to-render       0.47
total               2 239.14

---

## 2. Stage: `main-process-total` (1 389 ms)

### 2.1 Observation  
Node converts raw PCM → WAV, builds a **FormData** payload, and opens a fresh HTTP/2 + TLS connection on every request.

### 2.2 Root Causes  
* Redundant **WAV re-encode** in the main process.  
* **FormData** buffers the entire file – an extra copy and GC cost. :contentReference[oaicite:0]{index=0}  
* `got` creates a new TLS session per POST; no socket reuse.  
  Undici’s `fetch`/Agent keeps connections open and benchmarks faster. :contentReference[oaicite:1]{index=1}

### 2.3 Remediation Tasks  
| ID | Task | How-to / Acceptance Criteria |
|----|------|-----------------------------|
| M-1 | **Skip second encode** | Capture 16-bit PCM (or FLAC) in the renderer; pass the ready buffer via IPC. Encoder must run off-UI-thread. |
| M-2 | **Stream, don’t buffer** | Replace `FormData` with a `ReadableStream` piped directly to `fetch`. Memory stays < 5 MB while uploading a 1 MB clip. |
| M-3 | **Switch to Undici + keep-alive** | Use Node ≥ 18 builtin `fetch` or `undici`. Configure `{ keepAlive: true, keepAliveTimeout: 30 000 }`. Subsequent calls reuse the TLS session; connection setup time < 20 ms. :contentReference[oaicite:2]{index=2} |
| M-4 | **Down-sample to 16 kHz mono** | Whisper/Groq accept 16 kHz PCM; file size drops ~3–4×. :contentReference[oaicite:3]{index=3} |

---

## 3. Stage: `edge-travel` (401 ms)

### 3.1 Observation  
Round-trip from macOS → nearest Cloudflare PoP + full WAV upload.

### 3.2 Root Causes  
* Large payload (48 kHz WAV ≈ 6 × bigger than 16 kHz FLAC).  
* Extra RTTs from TCP+TLS+HTTP/2 handshakes.

### 3.3 Remediation Tasks  
| ID | Task | How-to / Acceptance Criteria |
|----|------|-----------------------------|
| E-1 | **Shrink payload** | After M-4 the request body ≤ 200 kB; edge-travel < 150 ms on a 10 Mbps link. |
| E-2 | **Enable HTTP/3 / QUIC** | macOS 14+ Electron auto-negotiates. Verify `cf-ray` reports `http/3`. Latency savings 1 RTT (~80 ms in US-East). :contentReference[oaicite:4]{index=4} |
| E-3 | **Argo Smart Routing** | Turn on Argo; Cloudflare promises average 30 % faster TTFB. :contentReference[oaicite:5]{index=5} |

---

## 4. Stage: `worker-total` (220 ms)

### 4.1 Observation  
Worker reads entire body into an `ArrayBuffer`, **copies it**, then streams to Groq.

### 4.2 Root Causes  
* Double I/O & memory copy.  
* No socket reuse on sub-request.

### 4.3 Remediation Tasks  
| ID | Task | How-to / Acceptance Criteria |
|----|------|-----------------------------|
| W-1 | **Pipe original stream** | In worker: `await fetch(upstream, { body: req.body, headers, method })`. No `await req.arrayBuffer()`. Streaming confirmed by seeing data arrive at Groq before worker finishes reading. :contentReference[oaicite:6]{index=6} |
| W-2 | **Keep sub-request pool warm** | Cloudflare automatically pools sockets if the hostname stays constant. Confirm `cf-cache-status: reused` in `Response`. |

---

## 5. Stage: `upstream-ttfb` (220 ms)

### 5.1 Observation  
Groq doesn’t send headers for ~200 ms after receiving request.

### 5.2 Root Causes  
* TLS handshake + queueing on the Groq side.

### 5.3 Remediation Tasks  
| ID | Task | How-to / Acceptance Criteria |
|----|------|-----------------------------|
| U-1 | **Warm connection** | Worker makes a dummy `HEAD /v1/models` every 55 s. If the first transcription after 60 s idle still shows < 120 ms TTFB, success. |
| U-2 | **(Optional) Bypass worker** | Post directly from Electron using a Keychain-stored API key. Removes W-1 & W-2 entirely (≈ 440 ms). Security review required. |