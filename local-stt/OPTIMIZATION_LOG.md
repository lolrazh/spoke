# Local STT Optimization Log

Goal: reduce local Whisper inference latency and memory without losing transcription quality.

Benchmark command:

```bash
npm run benchmark:stt -- --label <label> --repeat 3 --warmup 1
```

Benchmark corpus:

- Source: `local-stt/benchmark_corpus.json`
- Audio: generated locally with macOS `say` unless a case defines `audio_path`
- Metrics: wall time, sidecar inference time, normalized WER, strict WER, RSS, MLX peak/active/cache memory

## Baseline: checked-in MLX Whisper attention

Commit: `1443ee0`

Command:

```bash
npm run benchmark:stt -- --label baseline --repeat 3 --warmup 1
```

Summary:

| Metric | Result |
|---|---:|
| Runs | 30 |
| Mean wall time | 1229.9 ms |
| P95 wall time | 1374 ms |
| Mean inference time | 1210.4 ms |
| P95 inference time | 1335 ms |
| Mean normalized WER | 9.6% |
| Mean strict WER | 15.5% |
| Mean RSS after request | 583.4 MB |
| Mean MLX peak | 1081.9 MB |
| Mean MLX active | 451.6 MB |
| Mean MLX cache | 675.6 MB |

Notes:

- Baseline uses `mlx-whisper` manual attention: `q @ k`, `softmax`, `w @ v`.
- MLX active model memory is stable around 452 MB.
- Peak memory is dominated by transient attention/decode allocations.

## Experiment 1: MLX fast scaled-dot-product attention

Status: not adopted

Change:

- Patch `mlx_whisper.whisper.MultiHeadAttention.qkv_attention` at sidecar startup.
- Use `mx.fast.scaled_dot_product_attention` instead of materializing attention scores manually.
- Keep it disabled by default.
- Use `SPOKE_STT_FAST_ATTENTION=all`, `self`, or `cross` for A/B testing.

Results:

| Mode | Mean wall | P95 wall | Mean inference | Mean WER | Mean strict WER | Mean RSS | Mean MLX peak | Mean MLX cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Control: manual attention | 1318.0 ms | 1475 ms | 1298.4 ms | 9.6% | 15.5% | 580.7 MB | 1081.9 MB | 675.8 MB |
| `SPOKE_STT_FAST_ATTENTION=self` | 1535.9 ms | 1857 ms | 1504.5 ms | 9.6% | 15.5% | 583.8 MB | 1081.9 MB | 673.8 MB |
| `SPOKE_STT_FAST_ATTENTION=cross` | 1733.7 ms | 2107 ms | 1706.2 ms | 9.6% | 15.5% | 580.1 MB | 1203.1 MB | 792.2 MB |
| `SPOKE_STT_FAST_ATTENTION=all` | 1840.3 ms | 2151 ms | 1816.4 ms | 9.6% | 15.5% | 576.8 MB | 1203.1 MB | 790.4 MB |

Conclusion:

- WER stayed unchanged, which is good.
- Self-attention fast path kept peak memory flat but was slower.
- Cross/all fast attention increased MLX peak by about 121 MB and cache by about 115 MB.
- The full fast attention path was not reliably faster across full benchmark runs, so it is not a production win.
- Keep the switch for reproducible future testing, but leave manual attention as the default.

Next:

- Test decode `sample_len` caps. This targets worst-case token-loop latency without changing attention kernels.

## Experiment 2: decode sample length cap

Status: not adopted

Change:

- Add a hidden benchmark/runtime knob: `SPOKE_STT_SAMPLE_LEN=<positive integer>`.
- Pass the value through to MLX Whisper `DecodingOptions.sample_len`.
- Record the active decode cap in benchmark reports and sidecar metrics.
- Keep the production default unchanged: no explicit cap.

Results:

| Mode | Mean wall | P95 wall | Mean inference | Mean WER | Mean strict WER | Mean RSS | Mean MLX peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Control: default sample length | 1150.4 ms | 1387 ms | 1130.8 ms | 9.6% | 15.5% | 580.0 MB | 1081.9 MB |
| `SPOKE_STT_SAMPLE_LEN=64` | 1904.0 ms | 3592 ms | 1872.7 ms | 9.6% | 15.5% | 583.6 MB | 1081.9 MB |
| `SPOKE_STT_SAMPLE_LEN=96` | 3332.7 ms | 4758 ms | 3308.1 ms | 9.6% | 15.5% | 580.2 MB | 1081.9 MB |

Validation/caveat:

- A post-experiment default smoke run also slowed to 2876.0 ms mean inference, so the later capped runs were likely polluted by system load or thermal state.
- Even with that caveat, the cap did not show any memory reduction and did not produce a clean latency win.
- WER stayed unchanged on this corpus, but the current corpus is not enough to prove that aggressive caps are safe for real long-form dictation.

Conclusion:

- Do not adopt a production sample length cap from these results.
- The knob is useful for controlled future tests, but the default should stay as MLX Whisper's native decode behavior.

Next:

- Profile where the default ~1.1 second warm inference is spent: audio preprocessing, encoder, language detection, decoder loop, or IPC.
- Test language pinning (`en`) versus auto-detect, because language detection is a plausible fixed cost on every request.

## Experiment 3: profiled inference breakdown

Status: instrumentation adopted

Change:

- Add `SPOKE_STT_PROFILE=1` to enable detailed timing inside the sidecar.
- Keep production behavior unchanged when profiling is disabled.
- In profiling mode, force MLX evaluation around stable phase boundaries so the timings are useful.
- Add benchmark summaries for audio analysis, mel generation, language detection, encoder, decoder, and postprocess timings.

Results:

| Mode | Mean wall | Mean inference | Mean WER | Audio analysis | Mel | Language detect | Encoder | Decoder | Mean MLX peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Profile: pinned `en` | 1102.3 ms | 1084.7 ms | 9.6% | 15.7 ms | 3.2 ms | 0.0 ms | 1007.4 ms | 74.0 ms | 1081.5 MB |
| Profile: `auto` language | 3157.6 ms | 3139.1 ms | 9.6% | 16.0 ms | 3.8 ms | 1524.8 ms | 1509.0 ms | 101.4 ms | 1081.5 MB |

Validation/caveat:

- The app already launches the sidecar with pinned English by default, so production avoids the auto-detect penalty.
- Profiling mode adds explicit evaluation boundaries and should be used to understand phase costs, not as a production latency benchmark.
- A later non-profile smoke run was much slower because the machine was under load; it verified correctness, but is not used as a performance conclusion.

Conclusion:

- The warm dictation path is encoder-bound, not decoder-bound.
- Decoder-side optimizations can only move a small part of current latency unless they also change encoder execution.
- Auto language detection is very expensive because it performs an additional encoder-sized pass before transcription.

Next:

- Investigate encoder-focused options: shorter effective audio windows, reusing encoded features in auto mode, Core ML/WhisperKit as a separate native engine, or model/runtime changes that avoid full 30-second encoder work for short dictation.
- Keep pinned `en` as the default for now.

## Experiment 4: shorter encoder audio context

Status: not adopted

Change tested:

- Temporarily patched MLX Whisper's `AudioEncoder` to allow shorter mel frame counts by slicing the positional embedding instead of asserting the fixed `(1500, 1280)` post-conv shape.
- Temporarily replaced the full `3000` mel-frame decode window with shorter padded windows.
- Removed the patch after testing; no production knob was kept.

Results:

| Mode | Mean wall | Mean inference | Mean WER | Mean strict WER | Mean MLX peak | Notes |
|---|---:|---:|---:|---:|---:|---|
| Control: default `3000` mel frames | 1190.7 ms | 1168.4 ms | 9.6% | 15.5% | 1081.9 MB | Background CPU contention caveat |
| Smoke: `500` mel frames | 189.7 ms | 179.7 ms | 16.5% | 20.6% | 675.3 MB | Fast, but punctuation quality regressed |
| Smoke: `750` mel frames | 252.7 ms | 242.0 ms | 8.1% | 10.2% | 817.2 MB | Fast, but changed “Maya” to “myya” |
| Smoke: `1000` mel frames | 331.0 ms | 319.3 ms | 8.1% | 10.2% | 989.2 MB | Same “Maya” regression |
| Smoke: `1500` mel frames | 515.0 ms | 502.7 ms | 10.2% | 12.3% | 1223.9 MB | Quality and memory both worse |
| Full: `1750` mel frames | 749.6 ms | 724.4 ms | 43.5% | 48.0% | 1119.0 MB | Long dictation hallucinated/repeated |
| Full: `2000` mel frames | 1378.5 ms | 1352.6 ms | 10.8% | 15.2% | 1267.5 MB | Slower than control, higher memory, numbers regressed |

Conclusion:

- Stock Whisper quality depends on more trailing silence/context than a simple shortened encoder window provides.
- Very short windows produce impressive latency/memory numbers but fail proper-noun and long-dictation quality.
- Conservative windows remove the speed win and can increase peak MLX memory.
- Do not keep a hidden mel-frame/window knob; it is too easy to ship a fragile path.

Next:

- Treat encoder latency as a model/runtime problem, not a simple padding knob problem.
- If we need a real encoder speedup, evaluate a separate native WhisperKit/Core ML engine or a properly distilled/masked encoder rather than patching stock MLX Whisper shape assumptions.

## Experiment 5: reuse language-detection encoder features

Status: adopted for `auto` language mode

Change:

- In `--language auto`, encode the first padded mel segment once.
- Run language detection against those encoded audio features.
- Reuse the same encoded features for the first transcription decode instead of running the encoder again.
- Leave pinned-language mode unchanged.

Results:

| Mode | Mean wall | Mean inference | Mean WER | Language detect | Encoder | Decoder | Mean MLX peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before: profiled `auto` language | 3157.6 ms | 3139.1 ms | 9.6% | 1524.8 ms | 1509.0 ms | 101.4 ms | 1081.5 MB |
| After: profiled `auto` feature reuse | 1092.4 ms | 1074.4 ms | 9.6% | 998.5 ms | 0.0 ms | 72.8 ms | 1081.5 MB |

Validation/caveat:

- The post-change run had background CPU contention, so the absolute latency can still move around.
- The structural win is clear: auto mode no longer runs a second encoder pass for the first segment.
- Pinned `en` smoke stayed in the same latency/quality band as before.

Conclusion:

- This is a clean optimization for multilingual/auto mode with no new model, no fallback path, and no production change for pinned English.
- Keep pinned `en` as the default because it is still the simplest and fastest default for the current product.

## Experiment 6: MLX cache clearing

Status: keep current behavior

Change tested:

- Added a hidden benchmark/runtime knob: `SPOKE_STT_CLEAR_CACHE=0`.
- Compared current behavior, which calls `mx.clear_cache()` after warmup and after each request, against leaving the MLX cache alone.
- The knob is kept only because it is useful for repeatable benchmarking; production default remains cache clearing enabled.

Command:

```bash
npm run benchmark:stt:suite -- --label triage-compile-dev --repeat 2 --warmup 1 --max-cases 3
```

Results:

| Mode | Ready | Mean wall | P95 wall | Mean inference | Mean WER | Mean strict WER | Mean RSS | Mean MLX peak | Mean MLX cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Default clear cache | 5219 ms | 4292.8 ms | 4672 ms | 4282.3 ms | 6.1% | 10.2% | 570.2 MB | 1081.8 MB | 670.9 MB |
| `SPOKE_STT_CLEAR_CACHE=0` | 5468 ms | 4803.3 ms | 6751 ms | 4763.0 ms | 6.1% | 10.2% | 573.2 MB | 1081.8 MB | 714.5 MB |

Validation/caveat:

- This was a triage run over 3 cases, 2 repeats, not a full corpus run.
- The machine was not perfectly quiet, but the direction was consistent enough: disabling cache clearing did not produce a reliable latency win and increased MLX cache memory.

Conclusion:

- Do not disable `mx.clear_cache()` for production right now.
- Cache clearing keeps memory more predictable and did not cost measurable speed in this run.

## Experiment 7: PyInstaller onefile versus onedir

Status: adopted for packaged builds

Change tested:

- Added `build-sidecar-onedir.sh` to build a PyInstaller onedir bundle at `local-stt/dist-ondir/spoke-stt/spoke-stt`.
- Compared the current onefile sidecar against the onedir sidecar using the same cached audio.

Commands:

```bash
local-stt/build-sidecar.sh
local-stt/build-sidecar-onedir.sh
npm run benchmark:stt -- --binary local-stt/dist/spoke-stt --label triage-onefile-default --repeat 1 --warmup 0 --max-cases 1 --audio-cache-dir local-stt/benchmarks/audio-cache
npm run benchmark:stt -- --binary local-stt/dist-ondir/spoke-stt/spoke-stt --label triage-onedir-default --repeat 1 --warmup 0 --max-cases 1 --audio-cache-dir local-stt/benchmarks/audio-cache
```

Results:

| Mode | Artifact size | Ready | Wall | Inference | WER | RSS | MLX peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| PyInstaller onefile | 80 MB | 35766 ms | 5163 ms | 4686 ms | 0.0% | 583.1 MB | 1081.8 MB |
| PyInstaller onedir | 229 MB | 18364 ms | 4013 ms | 3815 ms | 0.0% | 578.7 MB | 1081.8 MB |
| Packaged app onedir | 240 MB resource | 13998 ms | 4002 ms | 3944 ms | 0.0% | 577.8 MB | 1081.8 MB |

Validation/caveat:

- This was a single-case smoke focused on startup/packaging shape, not a full-quality run.
- Onedir is larger on disk, but appears to avoid some onefile extraction/import cost.

Conclusion:

- Onedir is better than onefile for packaged sidecar startup in this smoke test.
- Electron Forge successfully packaged the onedir sidecar at `Contents/Resources/spoke-stt/spoke-stt`.
- Packaged app size increased to about 529 MB, with the sidecar resource directory around 240 MB.

Follow-up packaged baseline:

```bash
npm run benchmark:stt -- --binary out/Spoke-darwin-arm64/Spoke.app/Contents/Resources/spoke-stt/spoke-stt --label packaged-onedir-full --repeat 2 --warmup 1 --audio-cache-dir local-stt/benchmarks/audio-cache
```

| Metric | Result |
|---|---:|
| Ready | 9208 ms |
| Runs | 20 |
| Mean wall | 4651.6 ms |
| P95 wall | 5436 ms |
| Mean inference | 4627.4 ms |
| P95 inference | 5403 ms |
| Mean WER | 10.2% |
| Mean strict WER | 16.2% |
| Mean RSS | 591.2 MB |
| Mean MLX peak | 1081.9 MB |
| Mean MLX active | 451.6 MB |
| Mean MLX cache | 676.5 MB |

Notes:

- The synthetic TTS corpus has repeatable but imperfect cases for symbols, numbers, and mixed product terms.
- Use this as the packaged production baseline for future local STT runtime experiments.

## Experiment 8: MLX `mx.compile()` around the Whisper encoder

Status: not adopted

Change tested:

- Temporarily wrapped the Whisper encoder with `mx.compile()` behind `SPOKE_STT_COMPILE_ENCODER=1`.
- Warmup compiled the encoder path before measured requests.
- Removed the production knob after testing because it did not help.

Command:

```bash
npm run benchmark:stt:suite -- --label triage-compile-dev --repeat 2 --warmup 1 --max-cases 3 --include-compile-encoder
```

Results:

| Mode | Ready | Mean wall | P95 wall | Mean inference | Mean WER | Mean strict WER | Mean RSS | Mean MLX peak | Mean MLX active | Mean MLX cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Default encoder | 5219 ms | 4292.8 ms | 4672 ms | 4282.3 ms | 6.1% | 10.2% | 570.2 MB | 1081.8 MB | 451.6 MB | 670.9 MB |
| `mx.compile()` encoder | 6096 ms | 5150.8 ms | 6112 ms | 5139.5 ms | 6.1% | 10.2% | 572.7 MB | 1078.2 MB | 447.9 MB | 681.8 MB |

Validation/caveat:

- Compile reduced active/peak MLX memory slightly, but it made latency meaningfully worse.
- The app cares more about latency than a roughly 4 MB active-memory reduction here.

Conclusion:

- Do not compile the Whisper encoder with `mx.compile()` in this implementation.
- Treat encoder speed as a model/runtime architecture problem, not a simple compile wrapper fix.

## Experiment 9: P0 PCM/VAD sidecar baseline

Status: recorded as P0 smoke baseline

Change context:

- Renderer capture now records PCM16 directly and trims with Silero VAD before STT.
- This benchmark exercises the fixed local STT sidecar protocol and model with the cached corpus. It does not include renderer VAD time or app paste time; those are now visible in the app through `[Latency] Transcription` logs.

Command:

```bash
npm run benchmark:stt -- --label p0-pcm-vad-baseline --repeat 2 --warmup 1 --audio-cache-dir local-stt/benchmarks/audio-cache
```

Results:

| Metric | Result |
|---|---:|
| Ready | 9656 ms |
| Cases | 10 |
| Runs | 20 |
| Mean wall | 2714.45 ms |
| P95 wall | 3056 ms |
| Mean inference | 2698.1 ms |
| P95 inference | 3047 ms |
| Mean WER | 10.2% |
| Mean strict WER | 16.2% |
| Mean RSS | 580.44 MB |
| Mean MLX peak | 1081.93 MB |
| Mean MLX active | 451.6 MB |
| Mean MLX cache | 676.41 MB |

Report:

- `local-stt/benchmarks/runs/20260521T113046Z-p0-pcm-vad-baseline/report.md`

Validation/caveat:

- The harness first failed with `--no-tts` because the corpus entries do not declare explicit `audio_path` values; rerunning without that flag reused the existing cached PCM files.
- System load was high during the run, and the report flagged Codex renderer CPU contention. Treat these numbers as a smoke baseline until rerun on a quiet machine.
- Real app latency now needs one dogfood pass using the renderer logs so post-roll, PCM readiness, VAD trim, sidecar inference, paste, and total end-to-end latency can be read from the same dictation.

Conclusion:

- Sidecar quality stayed in the known synthetic-corpus range: failures are still concentrated around product names, symbols, and numeric phrasing.
- The remaining P0 validation is a real app dogfood pass, not more raw sidecar benchmarking.
