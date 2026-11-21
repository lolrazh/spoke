"""Compare local Parakeet decoding modes. Never downloads audio or model weights.

Input: a JSON list of {id, path, reference} records and an optional JSON list
of vocabulary strings. Audio must be mono PCM16 WAV at 16 kHz. Outputs are raw
decoder text, before Spoke's dictionary correction. See the research report in
docs/parakeet-word-boosting-2026-11-14.md for isolated dependency setup.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import random
import re
import statistics
import time
import wave
from pathlib import Path

import numpy as np

import sidecar


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.lower())


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    row = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        previous, row = row, [i]
        for j, actual in enumerate(hypothesis, 1):
            row.append(min(row[-1] + 1, previous[j] + 1,
                           previous[j - 1] + (expected != actual)))
    return row[-1]


def read_audio(path: Path) -> np.ndarray:
    with wave.open(str(path)) as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate(),
                source.getcomptype()) != (1, 2, 16000, "NONE"):
            raise ValueError(f"Expected mono PCM16 16 kHz WAV: {path}")
        return np.frombuffer(source.readframes(source.getnframes()),
                             dtype="<i2").astype(np.float32) / 32768


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--terms", type=Path)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--beam", type=int, default=2)
    parser.add_argument("--strength", type=float, default=4.0)
    parser.add_argument("--boost-policy", choices=("uniform", "length-scaled"), default="uniform")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.repeats < 1 or args.beam < 1 or not 0 < args.strength <= 20:
        parser.error("repeats and beam must be positive; strength must be in (0, 20]")

    records = json.loads(args.manifest.read_text())
    if not isinstance(records, list) or not records:
        parser.error("manifest must be a nonempty JSON list")
    terms = json.loads(args.terms.read_text()) if args.terms else []
    if not isinstance(terms, list) or any(not isinstance(t, str) or not t.strip() for t in terms):
        parser.error("terms must be a JSON list of nonempty strings")
    terms = list(dict.fromkeys(t.strip().lower() for t in terms))
    # Validate inputs before loading the model. Resolve paths relative to the manifest.
    samples = []
    for record in records:
        path = args.manifest.parent / record["path"]
        samples.append((record, read_audio(path), hashlib.sha256(path.read_bytes()).hexdigest()))

    engine = sidecar.ParakeetEngine(args.weights, None)
    engine.load()
    engine.warmup()
    import mlx.core as mx

    def config_for(mode: str):
        if mode == "greedy":
            return None
        # Imports happen after Spoke's cached-mel frontend setup. The pinned
        # 0.5.1 baseline can run greedy without importing the newer boost API.
        from parakeet_mlx import Beam, DecodingConfig, boost
        machine = boost.EMPTY
        if mode == "boosted":
            weights = dict.fromkeys(terms, args.strength)
            if args.boost_policy == "length-scaled":
                from parakeet_boost import phrase_weights
                weights = phrase_weights(terms, args.strength)
            machine = boost.lift(
                boost.prebind(str.lower, boost.words(weights)),
                engine.model.vocabulary,
            )
        return DecodingConfig(decoding=Beam(
            beam_size=args.beam, duration_reward=0.7, booster=machine,
        ))

    modes = ["greedy", "beam", "boosted"] if terms else ["greedy"]
    rows = []
    rng = random.Random(args.seed)
    # Randomize mode order each repeat to reduce ordering/thermal bias. A new
    # booster per request includes cold vocabulary-table work in each timing.
    for record, audio, digest in samples:
        for repeat in range(args.repeats):
            order = modes.copy()
            rng.shuffle(order)
            for mode in order:
                start = time.perf_counter()
                config = config_for(mode)
                config_ms = (time.perf_counter() - start) * 1000
                mel = sidecar._p["get_logmel"](mx.array(audio), engine.model.preprocessor_config)
                result = engine.model.generate(mel, **({"decoding_config": config} if config else {}))[0]
                text = "".join(token.text for token in result.tokens).strip()
                elapsed_ms = (time.perf_counter() - start) * 1000
                reference = words(record["reference"])
                row = {
                    "id": record["id"], "audio_sha256": digest,
                    "audio_seconds": len(audio) / 16000, "mode": mode,
                    "repeat": repeat, "ms": round(elapsed_ms, 3),
                    "config_ms": round(config_ms, 3), "text": text,
                    "word_errors": edit_distance(reference, words(text)),
                    "reference_words": len(reference),
                }
                rows.append(row)
                print(json.dumps(row), flush=True)

    summary = {}
    for mode in modes:
        selected = [row for row in rows if row["mode"] == mode]
        reference_words = sum(row["reference_words"] for row in selected)
        summary[mode] = {
            "requests": len(selected),
            "median_ms": statistics.median(row["ms"] for row in selected),
            "wer_percent": 100 * sum(row["word_errors"] for row in selected) / reference_words if reference_words else None,
            "rtf": sum(row["ms"] for row in selected) / (1000 * sum(row["audio_seconds"] for row in selected)),
        }
    report = {
        "versions": {name: importlib.metadata.version(name) for name in ("parakeet-mlx", "mlx", "numpy")},
        "platform": platform.platform(), "processor": platform.processor(),
        "terms": terms, "beam": args.beam, "strength": args.strength,
        "duration_reward": 0.7,
        "boost_policy": args.boost_policy,
        "seed": args.seed, "repeats": args.repeats, "model_load_ms": engine.load_ms,
        "summary": summary, "results": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
