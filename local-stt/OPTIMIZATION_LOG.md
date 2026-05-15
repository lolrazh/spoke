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
