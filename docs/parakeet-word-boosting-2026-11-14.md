# Parakeet decoder word boosting — 14 November 2026

## Decision

An upstream implementation now exists. `parakeet-mlx` 0.7.0 added phrase boosting on 4 November. It runs locally with our existing 6-bit weights. A benchmark using Spoke's actual model loader and encoder patches produced `DFlash2` and `NVFP4` before dictionary correction.

Do not enable it by default yet. A two-term list passed the small positive test, but a 24-term list damaged unrelated speech and the short-name test. The beam decoder also adds measurable latency. The initial research kept the app unchanged. The follow-up below adds an explicit development trial; UI controls remain a later task.

## Integration follow-up

The branch now pins `parakeet-mlx` 0.7.0 and supports `npm run dev:parakeet-boost`. This sets `SPOKE_PARAKEET_WORD_BOOST=1` for the app. The isolated checkout has a private Python environment; the original checkout's shared environment remains on 0.5.1. Dependency checks pass. This is not a packaged-release certification.

The trial sends structured `boost_terms` and `boost_strength` metadata through the existing framed PCM protocol. It freezes available context before decode without waiting for capture. It uses two beam candidates when terms exist and the fast greedy path when they do not. It disables downstream vocabulary replacement in both cases, so a failed boost cannot be hidden by a second replacement system. Normal non-dictionary formatting remains. With the trial off, Parakeet retains its current replacement path. Whisper previously had both prompt hints and dictionary replacement; it now uses prompt hints alone for vocabulary decisions.

Screen extraction is unchanged: Apple Natural Language `NLTagger` names plus identifier/acronym rules. The 24-term limit, validation and deduplication remain. Current-window terms take priority over a large saved dictionary, with saved spelling winning a duplicate. Debug model input records the exact terms and vocabulary mode. Output metrics acknowledge support, decoder mode, term count and scoring policy. Unsupported runtimes fail explicitly; they cannot silently ignore the new metadata and appear to pass.

### Actual screenshot and short-term scoring

The supplied screenshot was replayed through the native image probe at backing scale 2. Three OCR passes selected the same 14 terms. Uniform phrase weight 4 produced the correct full phrase but changed the short DFlash2 clip into repeated `M4` in all three decoder repeats. This was raw decoder output, with no downstream word replacement.

Upstream spreads each phrase's potential reward across its characters. An equal phrase weight gives a short term more reward per character. The trial now uses `weight = 4 * min(1, character_count / 7)`: DFlash2 gets 4, NVFP4 about 2.86, and M4 about 1.14. This is a scoring adjustment, not a new name detector or removal of short names. With the same 14 terms, both full and short clips passed two repeated raw-decoder runs. The seven-character reference is a fixture-calibrated trial setting, not a general accuracy guarantee. Canonical case is still not forced after decoding.

A fresh, disjoint 32-clip control set (seed 43 after excluding the first 32 clips) still failed with the 24-term stress list: unboosted beam WER 11.69%, length-scaled boosting 18.53%. This differs from the original control set and must not be presented as an improvement or regression against its percentages. Short-term scaling fixes the observed M4 case; it does not solve all false insertions or truncation. Large-list boosting remains unsuitable as a default.

### Verification and remaining work

- 684 application tests passed across 77 files; TypeScript and targeted ESLint checks passed.
- Real local model/protocol checks cover boosted output, a following unboosted request, rejection of oversized vocabulary without losing frame alignment, an empty vocabulary, silence, and a repeat boosted request. A separate short-clip check covers competition with M4.
- The new runtime passes `pip check`. Original checkout dependencies were not changed.
- The real-model tests use local synthetic audio and installed weights. They do not certify new live microphone/paste behavior. No audio/VAD or paste code changed.
- Decoder cost remains. A beam keeps competing candidates and performs more GPU-to-host synchronization than our custom greedy decoder. No new encoder or OCR wait was added. Performance work should profile those synchronizations and prepare reusable term tables before speech ends; neither optimization is claimed as completed here.

Run the real model checks with `SPOKE_PARAKEET_TEST_WAV` pointing to the full synthetic phrase and optional `SPOKE_PARAKEET_SHORT_TEST_WAV` pointing to the short DFlash2 clip:

```sh
local-stt/.venv/bin/python -m unittest discover -s local-stt -p 'parakeet_boost*test.py' -v
```

For matched benchmarks of the app's scoring policy, add `--boost-policy length-scaled` to the runner below. The default `uniform` policy preserves the original research comparison. New local evidence is retained in the ignored benchmark folder: `actual-image-ocr.json`, `actual-image-terms.json`, `actual-image-decode.json`, `scaled-image.json`, `control-2.json`, and `scaled-control-2.json`.

## Stack and available updates at the research baseline

Before the integration, verified both `local-stt/requirements.txt` and installed package metadata. The app calls a Python sidecar from Electron/TypeScript. Parakeet uses **senstella/parakeet-mlx on Apple MLX/Metal**, not mlx-audio's Parakeet implementation.

| Component | Spoke installed/pinned | Latest registry version checked | Role |
| --- | --- | --- | --- |
| parakeet-mlx | 0.5.1 | 0.7.0, 4 November | Current Parakeet adapter; new release has boosting |
| mlx / mlx-metal | 0.32.0 | mlx 0.32.4, 14 October | Apple GPU array runtime |
| mlx-audio | 0.5.0 | 0.6.5, 9 November | Other speech paths; not our Parakeet adapter |
| mlx-whisper | 0.4.3 | 0.4.3 | Separate Whisper adapter |

Registry sources: [parakeet-mlx](https://pypi.org/project/parakeet-mlx/0.7.0/), [MLX](https://pypi.org/project/mlx/0.32.4/), [mlx-audio](https://pypi.org/project/mlx-audio/0.6.5/), [mlx-whisper](https://pypi.org/project/mlx-whisper/0.4.3/). Dates are upload dates, not dates when Spoke adopted them. No blanket dependency update was made.

Weights: `spokedotso/parakeet-tdt-0.6b-v2-mlx-6bit`, English, 6-bit affine quantization, group size 64. They are already installed locally. Spoke applies encoder evaluation boundaries, fused QKV projections, and a custom greedy decoder that combines token/duration synchronization and omits unused confidence work.

The baseline Parakeet `transcribe` method discards `prompt`. Saved dictionary and screen terms affect local text correction after decoding. Only Whisper receives the prompt hint. Boosting is a score change inside speech decoding; it is not an LLM system prompt.

## Existing implementations

| Framework | Confirmed mechanism | Fit for Spoke |
| --- | --- | --- |
| **parakeet-mlx 0.7.0**, Python/MLX | Character-based phrase state machine, lifted into the model's token vocabulary; integrated into TDT/RNNT beam search | Best first path. Reuses our weights and encoder. `Greedy` has no booster. Boosted requests bypass our fast greedy override. |
| **sherpa-onnx**, C++/ONNX Runtime with Node and other bindings | Parakeet TDT v2 example uses per-stream hotwords and `modified_beam_search`, backed by a context graph | Real alternative, including a CPU example. Needs ONNX weights and another runtime; Mac latency has not been measured here. Latest PyPI version checked: 2.0.1. |
| **FluidAudio**, Swift/Core ML | Main project uses CTC word spotting and acoustic rescoring. Pure TDT 0.6B needs a separate CTC encoder; the hybrid 110M model can share its encoder | Fully local but adds model/inference work for our model class. It is not direct TDT decoder boosting. |
| **FluidAudio `boosting` fork**, Swift/Core ML | Token trie adds scores before token selection | An existing direct port worth studying. Requires a special full-logit Core ML joint model. This is fork code, not the main FluidAudio release. |
| **mlx-audio 0.6.5**, Python/MLX | Inspected released Parakeet source: greedy TDT path, no equivalent hotword/booster hook found | Updating mlx-audio alone does not supply this feature. |
| **NVIDIA NeMo**, Python/PyTorch | GPU phrase boosting supports TDT and other decoder types through NGPU-LM | Algorithm reference, but its CUDA path is not a direct Apple Metal integration. |

Primary evidence:

- [parakeet-mlx boost API commit](https://github.com/senstella/parakeet-mlx/commit/e4f40a4c2d1e686f5b52fcaaba801d1f4dacd3e7), [boost state machine](https://github.com/senstella/parakeet-mlx/blob/3a32c393cf164a6c6b1519196beb731ec8f62ed3/parakeet_mlx/boost.py), and [decoder](https://github.com/senstella/parakeet-mlx/blob/3a32c393cf164a6c6b1519196beb731ec8f62ed3/parakeet_mlx/parakeet.py). Earlier [beam-search PR #47](https://github.com/senstella/parakeet-mlx/pull/47) is distinct from the November boost API addition.
- [sherpa-onnx Parakeet TDT v2 hotword example](https://github.com/k2-fsa/sherpa-onnx/blob/78022953788ff05f62f4a733c6268a5689efeb86/nodejs-addon-examples/test_asr_non_streaming_nemo_parakeet_tdt_v2_hotwords.js) and [NeMo transducer implementation](https://github.com/k2-fsa/sherpa-onnx/blob/78022953788ff05f62f4a733c6268a5689efeb86/sherpa-onnx/csrc/offline-recognizer-transducer-nemo-impl.h).
- [FluidAudio CTC design](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/ASR/CustomVocabulary.md). Latest release checked was v0.18.3 on 7 November. [False-replacement fix #1152](https://github.com/FluidInference/FluidAudio/pull/1152) merged on 11 November, after that release. Its evidence shows why recall alone is insufficient; replacements at the wrong location must also be counted. Published FluidAudio timing/accuracy numbers are not a matched Spoke benchmark.
- [Swift token trie](https://github.com/vietanh125/FluidAudio/blob/3693a16bc08969148138f640da07ccc687b9e8e5/Sources/FluidAudio/ASR/Parakeet/SlidingWindow/CustomVocabulary/Boosting/TokenBoostTrie.swift), [booster wrapper](https://github.com/vietanh125/FluidAudio/blob/3693a16bc08969148138f640da07ccc687b9e8e5/Sources/FluidAudio/ASR/Parakeet/SlidingWindow/CustomVocabulary/Boosting/ParakeetBooster.swift), and [full-logit Core ML export](https://huggingface.co/Mediform/parakeet-full-logits-coreml). The ordinary decision-only Core ML export selects the token internally, so host-side bias cannot be added there.
- [mlx-audio source](https://github.com/Blaizzy/mlx-audio/tree/main/mlx_audio/stt/models/parakeet); inspected artifact was its 0.6.5 wheel, SHA-256 `e4ecd7ac96e501bf0b8e72a9fee7f8411b096ce3ff7ab4b0f48c9424c906f87f`.
- [NVIDIA word-boosting documentation](https://docs.nvidia.com/nemo/speech/nightly/asr/asr_customization/word_boosting.html).

## Local prototype and measurements

The 0.7.0 wheel was extracted into an isolated directory and selected with `PYTHONPATH`. The shared development environment still has 0.5.1. All runs used MLX 0.32.0 and the same local quantized weights on Apple M4. No new model download, network inference, second encoder, microphone playback, or paste automation was involved.

Wheel SHA-256: `768552ddc362af86e0a5911585f8e151cec48d40035193b077af91513b8e56e3`.

The checked-in runner, `local-stt/benchmark_parakeet_boost.py`, compares our fast greedy path, upstream beam without terms, and the same beam with terms. It randomizes mode order per repeat and creates a fresh booster for each request. Timing includes term configuration, mel processing, encoder, decoder and text assembly. It excludes model load/warmup, file I/O, screen capture, IPC, correction and paste. Model loading is recorded separately. The WER metric lowercases and removes punctuation; it does not normalize spoken numbers to digits.

### Selected configuration

`Beam(beam_size=2, duration_reward=0.7, booster=...)`, with phrase weight 4.0 and case-folded character matching. Initial exploration tried beam sizes 1/2/4, weights 0.5–12 and duration rewards 0/0.7. The two-name fixture selected the configuration; it is not an independent accuracy test. Setting duration reward to zero caused dropped text with wider beams on these fixtures. One-candidate boosting produced incomplete spellings such as `DFLAS2`, so it is not a tested substitute for the two-candidate path.

### Positive fixtures: two terms, five repeats each

Terms: `DFlash2`, `NVFP4`. Local synthetic speech, direct PCM input.

| Clip | Fast greedy median | Unboosted beam median | Boosted beam median | Boosted raw output |
| --- | --- | --- | --- | --- |
| Full phrase, 5.623 s | 130.6 ms | 204.0 ms | 234.3 ms | `Use DFlash2 for this project. Test NVFP4 as well.` — 5/5 |
| Short name, 1.083 s | 75.4 ms | 123.3 ms | 148.7 ms | `Dflash2.` — 5/5; canonical case still needs formatting |

The unboosted full phrase remained `D flash 2` and `N V F P 4`. The fast greedy short clip was empty; the unboosted beam returned `D flash 2.`. These are direct-file decoder observations, not evidence about microphone startup or missing opening words. That investigation remains on hold.

### Independent negative controls

Selected 32 clips with `random.Random(42).sample(records, 32)` from the existing local `spoken-heldout-200/manifest.json`: 195.29 seconds total, 521 reference words, mixed GigaSpeech and Earnings22. No settings were selected from these controls. Each condition had one pass per clip, with shuffled decoder order.

| Term list | Fast greedy WER | Unboosted beam WER | Boosted beam WER | Result |
| --- | --- | --- | --- | --- |
| Two target terms | 65/521 = 12.48% | 63/521 = 12.09% | 63/521 = 12.09% | Boosted output exactly matched unboosted beam on all 32 clips |
| 24 screen-like terms | 65/521 = 12.48% | 63/521 = 12.09% | 80/521 = 15.36% | Nine text outputs changed; four clips had more word errors, one had fewer |

The 24-term list was: DFlash2, NVFP4, Parakeet, Nemotron, MLX, REAP, Spoke, ChatGPT, Codex, Marble, Cove, Electron, MTP, BF16, FP8, TypeScript, React, SQLite, NVIDIA, Whisper, Willow, Swift, CoreML, ScreenCaptureKit. It was a stress list, not a saved user dictionary or an actual OCR capture.

False changes included `Because` becoming `Cove`, an uncertain survey name becoming `MLX`, and long clauses becoming truncated. With the same 24 terms, the short positive clip became `D F willow reap willow` in all three repeats. This confirms a bias-strength/list problem, separate from whether OCR selected the right names.

The median paired latency addition over fast greedy was 75.6 ms with two terms and 71.6 ms with 24 terms on the control clips. Absolute medians differed between runs under desktop load; this is not evidence that more terms are faster. A separate 0.5.1 baseline produced exactly the same greedy text as 0.7.0 on all 32 controls. Its timings were not interleaved with 0.7.0, so they do not establish an upgrade speed gain.

These are small diagnostic samples, not a release gate or proof across accents, microphones, silence, long dictations, and arbitrary dictionaries. Only the MLX route was benchmarked. Other framework speed claims above remain unmeasured on this app.

## Integration plan recorded before the follow-up

1. Upgrade only `parakeet-mlx` in an isolated runtime first. Test packaged imports, model loading, cold/warm inference and existing patches. The local prototype demonstrates weight compatibility, not packaging compatibility.
2. Add a structured per-request `boost_terms` field across `localSttLifecycle` → `sidecarEngine` → Python. Do not overload the Whisper prompt or treat a prose prompt as terms. Read only context already available when decoding starts. Do not wait for OCR; late context can still help the existing post-correction path.
3. Keep screen terms separate from saved vocabulary and rank them before boosting. The current 24-term OCR cap is not a safe decoder-boosting limit. Test limits, phrase strength, short/common names, confusable alternatives and negative speech together. Two successful terms do not prove an arbitrary two-term list is safe.
4. Use request-local state. Blank tokens must not advance phrase state; unfinished prefixes must not earn a completed-phrase bonus; state must not leak into the next dictation. Disabling the feature or having no eligible terms must use the current fast greedy path.
5. Keep canonical-case/identifier formatting after decode. Decoder bias cannot guarantee the exact case of every name. Do not rerun transcription after paste, or wait for a second model to complete.
6. Measure and reduce the beam path's repeated GPU-to-Python synchronization and vocabulary-state table cost. Start from the upstream implementation, not a new independent port. The speed budget must include any term preparation deferred from the start of recording.
7. Add opt-in diagnostics that distinguish selected terms, terms actually sent, decoder mode, raw text, corrected text and latency. Then test full dictation/paste separately. UI cleanup and user controls remain later work, as requested.

There is no need to submit a new upstream PR merely to add word boosting: it already exists. A focused beam-decoder performance or guarded greedy-boosting contribution could be useful after a matched accuracy/latency benchmark proves it. No upstream issue or PR was submitted.

## Reproduction and evidence

The benchmark accepts a JSON array of `{ "id": "clip", "path": "/absolute/clip.wav", "reference": "expected text" }` and an optional JSON string array of terms. Without `--terms` it runs the installed greedy baseline. Use mono PCM16 16 kHz WAV files. It never downloads or uploads inputs.

Example from the repository root, using the separately extracted 0.7.0 wheel:

```sh
PYTHONPATH=/tmp/spoke-word-boost/latest-parakeet local-stt/.venv/bin/python \
  local-stt/benchmark_parakeet_boost.py \
  --manifest /tmp/spoke-word-boost/positive.json \
  --terms /tmp/spoke-word-boost/two-terms.json \
  --weights "$HOME/Library/Application Support/Spoke/local-stt/weights/parakeet" \
  --repeats 5 --output /tmp/spoke-word-boost/repeat.json
```

Local evidence is preserved in the ignored `local-stt/benchmarks/word-boost-2026-11-14/` directory: `grid.json`, `positive-two.json`, `positive-24.json`, `negative-two.json`, `negative-24.json`, `baseline-051-positive.json`, `baseline-051-negative.json`, manifests and the synthetic WAV fixtures. Reports include package versions, per-file SHA-256, output text and request timings. The original work directory, registry snapshots and extracted wheels are in `/tmp/spoke-word-boost/`. The temporary files can be removed by the OS; the conclusions and method are recorded here. Audio, full transcript sets and screen data are not committed or uploaded.

Prior implementation and live-testing history is in [the context test log](context-live-tests-2026-11-14.md). Both documents belong to draft PR #42. The opt-in integration and current vocabulary modes are described in the follow-up above.
