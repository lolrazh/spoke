#!/usr/bin/env python3
"""
Run comparable Spoke local STT benchmark variants with a shared audio cache.

This keeps the audio corpus fixed across runs so runtime changes are measured
against identical PCM input instead of fresh dictation.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_STT_DIR = Path(__file__).resolve().parent
DEFAULT_CORPUS = LOCAL_STT_DIR / "benchmark_corpus.json"
DEFAULT_OUTPUT_DIR = LOCAL_STT_DIR / "benchmarks"
DEFAULT_AUDIO_CACHE_DIR = DEFAULT_OUTPUT_DIR / "audio-cache"
DEFAULT_WEIGHTS_DIR = (
    Path.home()
    / "Library"
    / "Application Support"
    / "Spoke"
    / "local-stt"
    / "weights"
    / "whisper"
)
DEFAULT_DEV_PYTHON = LOCAL_STT_DIR / ".venv" / "bin" / "python"
DEFAULT_DIST_BINARY = LOCAL_STT_DIR / "dist" / "spoke-stt"
DEFAULT_ONEDIR_BINARY = LOCAL_STT_DIR / "dist-ondir" / "spoke-stt" / "spoke-stt"
DEFAULT_PACKAGED_BINARY = (
    REPO_ROOT
    / "out"
    / "Spoke-darwin-arm64"
    / "Spoke.app"
    / "Contents"
    / "Resources"
    / "spoke-stt"
)


@dataclass(frozen=True)
class Variant:
    name: str
    description: str
    env: dict[str, str]
    binary: Path | None = None
    repeat: int | None = None
    warmup: int | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Spoke STT benchmark variants")
    parser.add_argument("--label", default="mlx-suite", help="Suite label.")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--audio-cache-dir", type=Path, default=DEFAULT_AUDIO_CACHE_DIR)
    parser.add_argument("--weights-dir", type=Path, default=DEFAULT_WEIGHTS_DIR)
    parser.add_argument("--language", default="en")
    parser.add_argument("--repeat", type=int, default=2)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--voice", default="Samantha")
    parser.add_argument("--no-tts", action="store_true")
    parser.add_argument("--python", type=Path, default=DEFAULT_DEV_PYTHON)
    parser.add_argument(
        "--include-profile",
        action="store_true",
        help="Also run a profiling variant with explicit phase timings.",
    )
    parser.add_argument(
        "--include-dist-binary",
        action="store_true",
        help="Also benchmark local-stt/dist/spoke-stt if it exists.",
    )
    parser.add_argument(
        "--include-onedir-binary",
        action="store_true",
        help="Also benchmark local-stt/dist-ondir/spoke-stt/spoke-stt if it exists.",
    )
    parser.add_argument(
        "--include-packaged-binary",
        action="store_true",
        help="Also benchmark the packaged app sidecar if it exists.",
    )
    parser.add_argument(
        "--binary",
        action="append",
        type=Path,
        default=[],
        help="Additional sidecar binary to benchmark. Can be provided more than once.",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def benchmark_variants(args: argparse.Namespace) -> list[Variant]:
    variants = [
        Variant(
            name="dev-default",
            description="Dev Python sidecar with production defaults.",
            env={},
        ),
        Variant(
            name="dev-no-clear-cache",
            description="Dev Python sidecar without mx.clear_cache() after warmup/request.",
            env={"SPOKE_STT_CLEAR_CACHE": "0"},
        ),
        Variant(
            name="dev-cold-no-sidecar-warmup",
            description="Dev Python sidecar with internal warmup disabled; first request is measured.",
            env={"SPOKE_STT_WARMUP": "0"},
            repeat=1,
            warmup=0,
        ),
    ]
    if args.include_profile:
        variants.append(
            Variant(
                name="dev-profile",
                description="Dev Python sidecar with phase profiling enabled.",
                env={"SPOKE_STT_PROFILE": "1"},
            )
        )

    binaries: list[tuple[str, Path]] = []
    if args.include_dist_binary:
        binaries.append(("dist", DEFAULT_DIST_BINARY))
    if args.include_onedir_binary:
        binaries.append(("onedir", DEFAULT_ONEDIR_BINARY))
    if args.include_packaged_binary:
        binaries.append(("packaged", DEFAULT_PACKAGED_BINARY))
    binaries.extend((f"binary-{index}", path) for index, path in enumerate(args.binary, start=1))

    for prefix, binary in binaries:
        if not binary.exists():
            print(f"[suite] Skipping missing binary: {binary}", flush=True)
            continue
        variants.extend(
            [
                Variant(
                    name=f"{prefix}-default",
                    description=f"{prefix} sidecar binary with production defaults.",
                    env={},
                    binary=binary,
                ),
                Variant(
                    name=f"{prefix}-no-clear-cache",
                    description=f"{prefix} sidecar binary without mx.clear_cache() after warmup/request.",
                    env={"SPOKE_STT_CLEAR_CACHE": "0"},
                    binary=binary,
                ),
                Variant(
                    name=f"{prefix}-cold-no-sidecar-warmup",
                    description=f"{prefix} sidecar binary with internal warmup disabled; first request is measured.",
                    env={"SPOKE_STT_WARMUP": "0"},
                    binary=binary,
                    repeat=1,
                    warmup=0,
                ),
            ]
        )

    return variants


def run_variant(args: argparse.Namespace, variant: Variant) -> dict[str, Any]:
    label = f"{args.label}-{variant.name}"
    command = [
        str(args.python),
        str(LOCAL_STT_DIR / "benchmark.py"),
        "--label",
        label,
        "--corpus",
        str(args.corpus),
        "--output-dir",
        str(args.output_dir),
        "--audio-cache-dir",
        str(args.audio_cache_dir),
        "--weights-dir",
        str(args.weights_dir),
        "--language",
        args.language,
        "--repeat",
        str(variant.repeat if variant.repeat is not None else args.repeat),
        "--warmup",
        str(variant.warmup if variant.warmup is not None else args.warmup),
        "--voice",
        args.voice,
    ]
    if args.max_cases > 0:
        command.extend(["--max-cases", str(args.max_cases)])
    if args.no_tts:
        command.append("--no-tts")
    if variant.binary:
        command.extend(["--binary", str(variant.binary)])

    env = os.environ.copy()
    env.update(variant.env)

    print("", flush=True)
    print(f"[suite] Running {variant.name}: {variant.description}", flush=True)
    print(f"[suite] Env overrides: {variant.env or '{}'}", flush=True)
    subprocess.run(command, check=True, env=env)

    report_path = newest_report(args.output_dir, label)
    report = json.loads(report_path.read_text())
    report["suite_variant"] = {
        "name": variant.name,
        "description": variant.description,
        "env": variant.env,
        "binary": str(variant.binary) if variant.binary else None,
        "report_path": str(report_path),
    }
    return report


def newest_report(output_dir: Path, label: str) -> Path:
    candidates = sorted(
        (output_dir / "runs").glob(f"*-{label}/report.json"),
        key=lambda path: path.stat().st_mtime,
    )
    require(candidates, f"No report generated for {label}")
    return candidates[-1]


def write_suite_report(reports: list[dict[str, Any]], suite_dir: Path) -> None:
    suite_dir.mkdir(parents=True, exist_ok=True)
    suite_json = suite_dir / "suite.json"
    suite_md = suite_dir / "suite.md"
    suite_json.write_text(json.dumps({"reports": reports}, indent=2) + "\n")

    lines = [
        "# STT Benchmark Suite",
        "",
        "| Variant | Scenario | Ready ms | Wall mean | Wall P95 | Inference mean | WER | Strict WER | RSS MB | MLX Peak MB | MLX Cache MB |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for report in reports:
        variant = report["suite_variant"]
        summary = report["summary"]
        lines.append(
            f"| {variant['name']} | {variant['description']} | "
            f"{summary['ready_ms']} | "
            f"{summary['wall_ms']['mean']} | "
            f"{summary['wall_ms']['p95']} | "
            f"{summary['inference_ms']['mean']} | "
            f"{summary['wer']['mean']} | "
            f"{summary['strict_wer']['mean']} | "
            f"{summary['rss_after_mb']['mean']} | "
            f"{summary['mlx_peak_mb']['mean']} | "
            f"{summary['mlx_cache_mb']['mean']} |"
        )

    lines.extend(["", "## Report Paths", ""])
    for report in reports:
        variant = report["suite_variant"]
        lines.append(f"- {variant['name']}: `{variant['report_path']}`")

    suite_md.write_text("\n".join(lines) + "\n")
    print("", flush=True)
    print(f"Suite JSON: {suite_json}", flush=True)
    print(f"Suite Markdown: {suite_md}", flush=True)


def main() -> int:
    args = parse_args()
    require(args.repeat >= 1, "--repeat must be >= 1")
    require(args.warmup >= 0, "--warmup must be >= 0")
    require(args.python.exists(), f"Python interpreter not found: {args.python}")

    timestamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    suite_dir = args.output_dir / "suites" / f"{timestamp}-{args.label}"
    reports = [run_variant(args, variant) for variant in benchmark_variants(args)]
    write_suite_report(reports, suite_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
