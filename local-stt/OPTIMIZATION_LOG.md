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
