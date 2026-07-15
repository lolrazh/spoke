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

## Experiment 10: bounded Whisper encoder graph lifetime

Status: adopted

Change tested:

- Replaced stock `mlx-whisper`'s single 32-block lazy audio-encoder graph with
  the same encoder computation plus an `mx.eval()` boundary after every block.
- Added `SPOKE_STT_ENCODER_EVAL_INTERVAL` for regression testing. `1` is the
  production default; `0` restores the stock graph.
- Tested intervals 1, 2, 4, 8, and 16. Only short intervals materially reduced
  peak memory; interval 1 established the best memory frontier.
- Tested `mx.async_eval()` as a non-blocking alternative. It did not cut the
  dependency graph and therefore did not reduce peak memory.

Representative result (one case, capped decode for fast interval sweep):

| Evaluation interval | Inference | MLX peak |
|---:|---:|---:|
| Stock (`0`) | 1016 ms | 1081.8 MB |
| Every 1 block | 1021 ms | 654.8 MB |
| Every 2 blocks | 1067 ms | 776.5 MB |
| Every 4 blocks | 1091 ms | 992.6 MB |
| Every 8 blocks | 982 ms | 1081.8 MB |

Full-corpus validation:

| Mode | Mean inference | Mean WER | Mean strict WER | Mean MLX peak |
|---|---:|---:|---:|---:|
| Stock graph | 1003.45 ms | 10.2% | 16.2% | 1081.93 MB |
| Per-block evaluation | 1085.05 ms | 10.2% | 16.2% | 654.93 MB |

The sequential full runs experienced increasing system load. An alternating
three-case A/B measured only about a 1.2% inference penalty for the boundaries,
while the 427 MB memory reduction was invariant across every request.

Reports:

- `local-stt/benchmarks/runs/20260715T025118Z-eval-boundary-0-full/report.md`
- `local-stt/benchmarks/runs/20260715T025142Z-eval-boundary-1-full/report.md`

Conclusion:

- MLX lazy evaluation was retaining a much larger encoder working set than one
  block required. Explicit lifetime boundaries cut the peak by 39.5% with exact
  transcript parity.
- Keep the boundary configurable because larger or differently quantized
  checkpoints may have a different ideal interval.

## Experiment 11: fused attention with bounded encoder layers

Status: adopted

Change tested:

- Re-tested `mx.fast.scaled_dot_product_attention` after bounding the encoder
  graph. The earlier fast-attention experiment used the full lazy encoder graph
  and increased peak memory; the interaction between the two optimizations is
  the important difference.
- Marked encoder, decoder self-attention, and decoder cross-attention modules
  explicitly instead of inferring their kind from the presence of a mask.
- Applied fused attention to the encoder and decoder cross-attention. Decoder
  self-attention stays on the stock path because full `all` mode was slower in
  the full run without reducing memory further.
- Kept the existing `SPOKE_STT_FAST_ATTENTION` switch. `encoder-cross` is now
  the production default; `0` restores manual attention.

Full-corpus comparison:

| Mode | Mean wall | Mean inference | Mean WER | Mean strict WER | Mean MLX peak | Mean MLX cache |
|---|---:|---:|---:|---:|---:|---:|
| Stock graph + manual attention | 1020.55 ms | 1003.45 ms | 10.2% | 16.2% | 1081.93 MB | 675.52 MB |
| Per-block + fused encoder/cross | 988.45 ms | 973.05 ms | 10.2% | 16.2% | 535.64 MB | 120.36 MB |

Report:

- `local-stt/benchmarks/runs/20260715T025542Z-i1-fast-cross-full/report.md`

Production-default smoke after making both defaults:

- 3/3 transcript results matched the control.
- Mean inference: 953.0 ms.
- Mean MLX peak: 535.1 MB.
- Report: `local-stt/benchmarks/runs/20260715T025757Z-production-default-smoke/report.md`.

Conclusion:

- The combined path cuts peak MLX memory by about 546 MB (50.5%) and improves
  mean inference by about 3% on the full corpus.
- The final peak is only about 84 MB above the 451.6 MB resident model, leaving
  substantially more unified-memory headroom for larger or mixed-quant models.

## Experiment 12: attention tiling and Python-sidecar overhead

Status: measured; attention tiling not adopted as the default

- Added an exact query-tiling experiment behind
  `SPOKE_STT_ENCODER_ATTENTION_CHUNK_SIZE` inspired by flash-attention-style
  bounded score tiles. A 750-token tile reduced the stock graph peak from
  1081.8 MB to 916.4 MB without changing the smoke transcript, but fused
  attention plus per-block evaluation was both smaller and faster.
- The tiling knob remains available for future MLX/model regressions and for
  hardware where fused attention is unavailable.
- Measured import-only process RSS: bare Python 8.8 MB, MLX + NumPy 38.8 MB,
  sidecar module 41.3 MB, and lazy Whisper imports 71.6 MB. The production
  process was about 570-583 MB RSS with 451.6 MB of active MLX model memory.

Conclusion:

- Python/PyInstaller is not the source of the former 1.08 GB inference peak.
  A native sidecar could recover some tens of megabytes, but model execution
  lifetimes and attention kernels were the dominant levers.
- Keep a native Swift/MLX or Core ML encoder as a later architecture project,
  not as the first memory optimization.

## Benchmark harness protocol repair

- Updated `benchmark.py` to send the JSON metadata frame before the PCM frame,
  matching the current two-frame sidecar protocol. The stale one-frame harness
  previously left both processes waiting for the other frame and could not
  measure current builds.

## Experiment 13: encoder latency profile and MLX 0.32

Status: MLX upgrade adopted

- Whisper profiling attributed about 876 ms of a 938 ms request to the audio
  encoder. Mel generation was about 2 ms and decoding about 60 ms, so Python,
  the protocol, and decoder tuning cannot produce a 2x end-to-end win.
- Upgraded MLX from 0.31.2 to 0.32.0. On the same three-case smoke corpus,
  mean inference fell from roughly 938 ms to 881 ms while the 535.1 MB MLX
  peak and transcripts stayed unchanged.
- Independently compiling each encoder transformer block reduced the smoke
  mean by only another ~1%. Fusing the three quantized Q/K/V projections into
  one projection was also essentially latency-neutral. Neither experimental
  patch was retained because each added model-internal coupling for a marginal
  result.

Conclusion:

- The full-length encoder's repeated quantized matrix multiplies are the hard
  latency floor. Fused SDPA is already active; `MLX_SDPA_BLOCKS` only tunes the
  short-query two-pass kernel and therefore does not affect the full-sequence
  encoder path.

## Experiment 14: duration-aware Whisper encoder context

Status: retained as an experiment; not enabled by default

Change tested:

- Stock Whisper pads every utterance to 30 seconds before running all 32
  encoder blocks. A three-second command therefore paid almost the same encoder
  cost as a 30-second recording.
- The encoder can process the real mel frames plus a configurable trailing
  silence/context tail. `SPOKE_STT_DYNAMIC_PADDING_FRAMES=700` retains seven
  seconds beyond the actual utterance; `0` uses the stock 30-second context and
  remains the production default. At Whisper's 10 ms mel hop, the experimental
  tail caps at the original 30-second limit.
- The positional embedding is sliced to the resulting encoder length. No model
  weights, decoder limits, or audio content are removed.

Safety-tail sweep (MLX 0.32, ten cases, one measured pass):

| Extra mel frames | Mean inference | Max MLX peak | WER | Strict WER |
|---:|---:|---:|---:|---:|
| 100 | 260.0 ms | 520.0 MB | 25.8% | 29.7% |
| 300 | 313.2 ms | 523.7 MB | 11.4% | 15.2% |
| 500 | 371.0 ms | 527.5 MB | 11.4% | 15.2% |
| 700 | 425.8 ms | 531.4 MB | 11.4% | 15.2% |
| 900 | 484.9 ms | 535.1 MB | 11.4% | 15.2% |

Final experimental repeat (ten cases x two):

| Mode | Mean wall | Mean inference | Median inference | P95 inference | WER | Strict WER | Max MLX peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Previous memory-optimized default | 988.45 ms | 973.05 ms | 969.0 ms | 1093 ms | 10.2% | 16.2% | 535.64 MB |
| Experimental dynamic 700 + MLX 0.32 | 429.8 ms | 414.6 ms | 368.5 ms | 804 ms | 11.4% | 15.2% | 531.4 MB |

Report:

- `local-stt/benchmarks/runs/20260715T051040Z-latency-final-default-full/report.md`
- Rebuilt the 252 MB PyInstaller onedir bundle with MLX 0.32 and verified the
  packaged executable. A repeat launch was ready in 680 ms and transcribed the
  short command in 280 ms at 491.7 MB peak:
  `local-stt/benchmarks/runs/20260715T051404Z-packaged-mlx032-second-launch/report.md`.

Quality notes:

- Mean inference improved by 57.4% and the maximum MLX peak decreased by about
  4 MB, proving the 2x mean-latency target is computationally available, but
  the changed outputs prevent enabling this mode by default.
- The 18.6-second dictation remained word-for-word identical and completed in
  804-814 ms. The normal 3-9 second cases completed in 283-461 ms.
- Normalized WER regressed 1.2 percentage points, while punctuation/case-aware
  strict WER improved 1.0 point. Differences were concentrated in synthetic
  proper-noun/numeric formatting (`Maya`/`myya`, `megabytes`/`MB`) rather than
  omissions in the long dictation. A 300-900 frame tail produced the same
  corpus outputs, so 700 was selected as a more conservative real-audio safety
  margin instead of taking the fastest point on the synthetic sweep.

## Engine comparison: active Parakeet model

- Generalized `benchmark.py` with `--family` so Whisper, Parakeet, and Cohere
  use the same protocol, corpus, WER, and memory accounting.
- The installed 6-bit Parakeet model averaged 156.25 ms inference, but reached
  1001.7 MB peak MLX memory and 17.1% WER. It is the speed ceiling, not a valid
  replacement for this optimization because it nearly doubles peak memory and
  scored worse on this corpus.
- Report: `local-stt/benchmarks/runs/20260715T050813Z-parakeet-active-full/report.md`.

Research conclusion:

- `whisper.cpp` and Apple's Core ML/ANE encoder path remain the credible route
  to a lossless further step-change. `whisper.cpp` supports flash attention,
  quantization, and a Core ML encoder, but combining its Core ML encoder weights
  with a separate decoder can increase the resident footprint. That path needs
  an actual end-to-end memory benchmark before replacing this MLX default.

## Experiment 15: Parakeet encoder lifetime planning

Status: adopted

Change:

- Parakeet MLX previously constructed all 24 FastConformer blocks as one lazy
  graph and materialized only the final encoder output.
- The sidecar now materializes the encoder output after every Conformer block.
  `SPOKE_STT_PARAKEET_ENCODER_EVAL_INTERVAL=0` restores the upstream graph for
  controlled comparisons.
- A deeper experiment also materialized after the feed-forward, attention, and
  convolution sublayers. It saved only another 25-27 MB at the worst case and
  increased mean inference by about 14%, so that code was not retained.

Paired validation:

- Used one immutable PCM corpus for every configuration. Earlier isolated
  reports generated fresh macOS TTS audio and therefore remain useful for
  timing/memory, but not for cross-report WER comparisons.
- An A-B-B-A sequence ran each configuration for 30 measured requests. All 120
  transcripts were identical between the upstream and staged graphs.

| Graph | Mean inference | Mean MLX peak | Max MLX peak |
|---|---:|---:|---:|
| Upstream lazy encoder (average of A runs) | 171.07 ms | 828.37 MB | 1001.7 MB |
| One evaluation per block (average of B runs) | 174.57 ms | 698.15 MB | 792.3 MB |

Reports:

- `local-stt/benchmarks/runs/20260715T054521Z-parakeet-abba-a1/report.md`
- `local-stt/benchmarks/runs/20260715T054528Z-parakeet-abba-b1/report.md`
- `local-stt/benchmarks/runs/20260715T054535Z-parakeet-abba-b2/report.md`
- `local-stt/benchmarks/runs/20260715T054542Z-parakeet-abba-a2/report.md`

Conclusion:

- Explicit lifetime boundaries reduce mean peak by 15.7% and the long-case
  peak by 20.9%, at a roughly 2.0% mean latency cost in the interleaved run.
- An interval of two blocks was slower in a second A-B-B-A run and retained
  more memory. One block is the measured Pareto point for this model/runtime.
- This is the practical level of memory planning exposed by MLX's lazy Python
  graph. Exact buffer placement/reuse across the full DAG would require MLX
  scheduler/allocator work or a custom C++/Metal execution path.

## Flash attention and Metal trace findings

- Both active engines already use MLX's fused
  `mx.fast.scaled_dot_product_attention`. Whisper uses it in encoder and
  decoder cross-attention; Parakeet MLX uses it in its attention modules.
- Parakeet's relative-position attention still creates `matrix_bd` with a
  separate Q/position matmul and relative shift, then supplies that full
  additive bias to fused SDPA. A custom bias-aware attention kernel is a
  credible experiment, although the model's 8x subsampling keeps short
  dictation sequences small enough that quantized projections and Conformer
  feed-forward layers are likely larger targets.
- A Metal System Trace of the staged long-dictation path contained 563 compute
  intervals over 558 command buffers across load and inference. The observed
  span was 658.8 ms with 336.7 ms of GPU-busy union. The largest 130.9 ms gap
  was between model load and request processing, not an encoder bubble.
- After excluding that load/request gap, the trace showed many sub-millisecond
  boundaries and only 12 other gaps above 1 ms. The trace itself slowed the
  request, so its absolute timing is not a benchmark; it rules out one large
  idle cavern and points toward kernel/dispatch aggregation.
- MLX 0.32's `MLX_METAL_FAST_SYNCH=1` was also tested because Parakeet mixes
  CPU-driven transducer decoding with GPU work. It did not improve this
  workload and was not enabled.

## Research-guided next targets

Runtime-level, preserving the current weights:

1. Profile labeled kernels with an MLX build using `MLX_METAL_DEBUG=ON`, then
   rank quantized GEMM, relative-bias, feed-forward, convolution, and dispatch
   time before writing a custom kernel.
2. Prototype a Parakeet bias-aware fused attention kernel. FlashBias is the
   closest research analogue, but exactness and Apple-GPU performance must be
   demonstrated on this relative-shift formulation.
3. Prototype fused norm + quantized projection + residual kernels for the
   repeated Conformer/Whisper block patterns. The trace suggests eliminating
   many small dispatches is more plausible than filling a large bubble.
4. A true static arena planner could use tensor liveness to reuse offsets, in
   the style of OLLA. MLX currently manages this below the Python graph, so this
   belongs in an MLX fork/upstream contribution rather than sidecar code.

Architecture-level, requiring compatible weights or training:

- Parakeet already uses the main FastConformer idea: depthwise 8x input
  subsampling. Efficient Conformer adds progressive downsampling/grouped
  attention, while Zipformer moves middle stacks to lower frame rates and
  reuses attention weights. These are promising next-model architectures, not
  safe transformations of the installed checkpoint.
- Moonshine is trained on variable-length, unpadded audio. That directly
  addresses Whisper's fixed 30-second encoder cost without relying on the
  output-changing positional-embedding/padding hack tested in Experiment 14.

Primary references:

- [MLX fast SDPA](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.fast.scaled_dot_product_attention.html)
  and [Metal debugger workflow](https://ml-explore.github.io/mlx/build/html/dev/metal_debugger.html)
- [FlashAttention](https://arxiv.org/abs/2205.14135)
- [FlashBias](https://arxiv.org/abs/2505.12044)
- [OLLA](https://arxiv.org/abs/2210.12924)
- [Efficient Conformer](https://arxiv.org/abs/2109.01163)
- [Zipformer](https://arxiv.org/abs/2310.11230)
- [Moonshine](https://arxiv.org/abs/2410.15608)
