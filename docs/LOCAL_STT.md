# Local STT: Moonshine v2 on Apple Silicon

## Overview

Spoke currently uses Groq's cloud Whisper API for speech-to-text. This document covers our journey to a fully local replacement using **Moonshine v2 Streaming Medium** (245M params, 6.65% WER).

**Current state**: Phase 2 complete — HF Transformers sidecar integrated into the Electron app, working end-to-end.

**Next step**: Phase 3 — Port inference to MLX for native Apple Silicon performance and a much smaller distribution footprint.

---

## Phase 1: Model Evaluation (Complete)

### Attempt 1: moonshine-voice SDK (Quantized ONNX) — REJECTED

**Package**: `pip install moonshine-voice` (v0.0.48)

**What it is**: Official Moonshine SDK with native ONNX Runtime inference. Downloads models automatically. Ships only **quantized** (int8) ONNX models.

**Results on clean WAV**: Excellent. 153ms TTFT, 1700ms total for 10s audio on CPU.

**Results on live mic**: Terrible. Garbled, wrong words, poor accuracy. The quantization degrades quality significantly on real-world mic audio.

**Why rejected**: No non-quantized models available via SDK CDN (all paths hardcode `/quantized`).

### Attempt 2: HuggingFace Transformers (FP16, MPS) — ACCEPTED

**Model**: `UsefulSensors/moonshine-streaming-medium` (1.06 GB safetensors, full precision)

Loaded at FP16 on MPS (Apple Silicon GPU). Quality was good on live mic audio.

**Performance**:
| Metric | Value |
|---|---|
| Model load (cold) | ~6.8s |
| TTFT | ~250ms |
| Inference (10s audio) | ~430ms |
| Real-time factor | ~23x faster than real-time |

---

## Phase 2: Electron Integration (Complete)

Sidecar daemon integrated into Spoke. Users toggle "Local Transcription" in Settings.

```
Cloud:  Renderer → fetch(/transcribe) → Cloudflare Worker → Groq API → text
Local:  Renderer → IPC (PCM buffer) → Main → Python daemon (stdin/stdout) → text
```

### Architecture

The Python daemon stays alive between requests (model loaded once, then ~430ms per transcription). The cloud path is completely untouched.

### Sidecar Protocol

Daemon mode (default): Model loads once, emits `{"type":"ready"}`, then reads length-prefixed PCM16 requests in a loop. Each request: 4 bytes LE uint32 length + that many bytes of raw PCM16 audio.

```
→ stdin:  [4-byte LE length][PCM16 bytes][4-byte LE length][PCM16 bytes]...
← stdout: {"type":"ready"}\n
           {"type":"partial","text":"Ever "}\n
           {"type":"done","transcript":"...","metrics":{...}}\n
```

### Files Changed

| File | What |
|---|---|
| `src/types/shared.ts` | STT event types (`SttPartialEvent`, `SttDoneEvent`, `LocalTranscribeResult`) |
| `src/utils/audioDecoder.ts` | **New** — WebM/Opus Blob → PCM16 Int16Array via OfflineAudioContext |
| `local-stt/sidecar.py` | Upgraded to daemon mode (was one-shot) |
| `src/main.ts` | Sidecar spawn/kill, IPC handlers, preference persistence |
| `src/preload.ts` | `window.stt` context bridge (transcribeLocal, get/setLocalEnabled) |
| `src/types/electron.d.ts` | `stt` interface on Window |
| `src/hooks/useTranscription.ts` | Local branch in start()/stop() — skips auth, prepare, cloud fetch |
| `src/components/SettingsPanel.tsx` | "Local Transcription" toggle in Defaults section |

### What Gets Skipped in Local Mode

- `/prepare` endpoint (OCR context)
- `/transcribe` endpoint
- LLM enhancement (router + enhance)
- Quota tracking
- Auth token (no cloud call = no auth needed)

---

## Phase 3: MLX Port (Next)

### Why move off HuggingFace Transformers?

HF Transformers works, but it's a general-purpose framework — not optimized for Apple Silicon.

| | HF Transformers (current) | MLX (target) |
|---|---|---|
| Runtime dep | ~400MB (torch) | ~50MB (mlx) |
| Memory model | PyTorch → MPS bridge | Native unified memory, zero-copy |
| Cold start | ~6.8s | Faster (mmap weights) |
| Inference | ~430ms | Should be faster (no bridge overhead) |
| Distribution bundle | Huge | Much smaller |

MLX is Apple's native ML framework, designed for the unified memory architecture on M chips. Zero-copy GPU access, no memory transfer overhead.

### Why this is feasible

Moonshine's architecture is a standard encoder-decoder transformer:
- **Encoder**: Conv1d audio frontend → transformer layers with RoPE, GELU activation
- **Decoder**: transformer layers with RoPE, SiLU activation, cross-attention to encoder
- **Vocab**: 32k BPE tokenizer
- **Position encoding**: RoPE (not absolute — simpler)

MLX has all these primitives. And we don't need streaming anymore (confirmed during Phase 1 that batch inference with full audio is better), so the generation loop is dead simple: encode → decode greedily → done.

### Porting plan

**Step 1: Model architecture in MLX** (~200-300 lines)

Rewrite the encoder, decoder, and generation logic using `mlx.nn`. Reference implementations:
- [mlx-whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) — similar encoder-decoder ASR in MLX
- [HF Transformers source for Moonshine](https://github.com/huggingface/transformers/blob/main/src/transformers/models/moonshine/modeling_moonshine.py) — the exact architecture to replicate

Key components:
- `MoonshineEncoder`: Conv1d → transformer blocks (self-attention + FFN with GELU)
- `MoonshineDecoder`: transformer blocks (self-attention + cross-attention + FFN with SiLU)
- `MoonshineForConditionalGeneration`: ties encoder + decoder + LM head + greedy decode loop

**Step 2: Weight conversion script**

Convert the HuggingFace safetensors (PyTorch) → MLX npz format:
- Load safetensors with `safetensors.torch`
- Rename keys to match MLX model structure
- Convert tensors to numpy → save as MLX-compatible npz
- Keep FP16 precision (the quality we want)

**Step 3: Update sidecar.py**

Replace the HF Transformers inference with MLX:
```python
# Before (HF Transformers)
from transformers import MoonshineStreamingForConditionalGeneration, AutoProcessor
model = MoonshineStreamingForConditionalGeneration.from_pretrained(MODEL_ID)
model = model.to("mps").to(torch.float16)

# After (MLX)
import mlx.core as mx
from moonshine_mlx import MoonshineModel
model = MoonshineModel.from_pretrained("weights/")
```

The sidecar protocol (stdin/stdout JSON lines) stays exactly the same. The Electron integration doesn't change at all.

**Step 4: Benchmark and validate**

- Compare inference speed: MLX vs HF Transformers (target: faster)
- Compare transcription quality: should be identical (same weights, same precision)
- Verify cold start improvement
- Test edge cases: short audio, long audio, silence

### Distribution plan (post-MLX port)

With MLX, the total footprint drops dramatically:

| Component | Size (compressed) |
|---|---|
| MLX runtime | ~50MB |
| Moonshine MLX weights (FP16) | ~500MB |
| Sidecar script + tokenizer | ~2MB |
| **Total optional download** | **~550MB** |

Ship as an optional download — app stays lean, model downloads when user first enables local transcription.

### Dependencies after MLX port

```
mlx>=0.22.0
numpy>=2.4.0
```

That's it. No torch, no transformers, no torchaudio.

---

## Benchmarks Summary

| Config | Inference (10s) | TTFT | Quality (mic) | Runtime Size |
|---|---|---|---|---|
| moonshine-voice SDK (int8 ONNX, CPU) | 1,738ms | 151ms | Bad | 289 MB |
| HF Transformers (FP16, MPS) | 427ms | 260ms | Good | ~500 MB |
| Groq Whisper Cloud (current) | ~800-1500ms | N/A | Good | N/A |
| MLX (FP16, Apple Silicon) | TBD | TBD | Expected: Good | ~50 MB |

---

## File Inventory (`local-stt/`)

| File | Purpose | Status |
|---|---|---|
| `sidecar.py` | Daemon sidecar for Spoke (stdin PCM → stdout JSON) | Working — Phase 2 production |
| `requirements.txt` | Minimal deps (torch, transformers, numpy) | Will shrink after MLX port |
| `.gitignore` | Excludes .venv, test scripts, caches | Active |
| `.venv/` | Python 3.11 venv (not tracked) | Dev-only |
| `test_*.py` | Phase 1 test scripts (not tracked) | Reference only |
| `diagnose_mic.py` | Mic diagnostics (not tracked) | Reference only |
