#!/usr/bin/env python3
"""
Benchmark the Spoke local STT sidecar.

Runs the same length-prefixed daemon protocol used by Electron, computes WER
against a reference corpus, and writes JSON + Markdown reports.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import re
import shutil
import statistics
import string
import struct
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_STT_DIR = Path(__file__).resolve().parent
DEFAULT_CORPUS = LOCAL_STT_DIR / "benchmark_corpus.json"
DEFAULT_OUTPUT_DIR = LOCAL_STT_DIR / "benchmarks"
DEFAULT_WEIGHTS_DIR = (
    Path.home() / "Library" / "Application Support" / "Spoke" / "local-stt" / "weights"
)
REQUIRED_MODEL_FILES = {
    "whisper": ("config.json", "weights.safetensors", "multilingual.tiktoken"),
    "parakeet": ("config.json", "model.safetensors", "mel_filters.npy"),
    "cohere": (
        "config.json",
        "model.safetensors",
        "tokenizer.json",
        "tokenizer.model",
    ),
}
REPORT_ENV_KEYS = (
    "SPOKE_STT_FAST_ATTENTION",
    "SPOKE_STT_SAMPLE_LEN",
    "SPOKE_STT_PROFILE",
    "SPOKE_STT_WARMUP",
    "SPOKE_STT_CLEAR_CACHE",
    "SPOKE_STT_ENCODER_EVAL_INTERVAL",
    "SPOKE_STT_ENCODER_ATTENTION_CHUNK_SIZE",
    "SPOKE_STT_DYNAMIC_PADDING_FRAMES",
    "SPOKE_STT_PARAKEET_ENCODER_EVAL_INTERVAL",
)
TIMING_METRIC_KEYS = (
    "audio_analysis_ms",
    "mel_ms",
    "language_detection_ms",
    "encoder_ms",
    "decoder_ms",
    "postprocess_ms",
)


@dataclass(frozen=True)
class CorpusCase:
    id: str
    reference: str
    audio_path: Path | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Spoke local STT")
    parser.add_argument("--label", default="baseline", help="Run label for output files.")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--audio-cache-dir",
        type=Path,
        help="Directory for generated/converted PCM corpus audio shared across benchmark runs.",
    )
    parser.add_argument("--weights-dir", type=Path, default=DEFAULT_WEIGHTS_DIR)
    parser.add_argument(
        "--family",
        choices=tuple(REQUIRED_MODEL_FILES),
        default="whisper",
        help="Sidecar engine family (default: whisper).",
    )
    parser.add_argument("--language", default="en")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--voice", default="Samantha")
    parser.add_argument(
        "--no-tts",
        action="store_true",
        help="Do not generate missing audio with macOS say + ffmpeg.",
    )
    parser.add_argument(
        "--binary",
        type=Path,
        help="Run a packaged sidecar binary instead of local-stt/sidecar.py.",
    )
    parser.add_argument(
        "--python",
        type=Path,
        default=LOCAL_STT_DIR / ".venv" / "bin" / "python",
        help="Python interpreter for dev sidecar mode.",
    )
    parser.add_argument(
        "--sidecar",
        type=Path,
        default=LOCAL_STT_DIR / "sidecar.py",
        help="Sidecar script for dev sidecar mode.",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def ensure_weights(weights_dir: Path, family: str) -> None:
    missing = [
        name for name in REQUIRED_MODEL_FILES[family] if not (weights_dir / name).exists()
    ]
    require(
        not missing,
        f"Missing model files in {weights_dir}: {', '.join(missing)}. Install the local model first.",
    )


def load_corpus(path: Path, max_cases: int) -> list[CorpusCase]:
    data = json.loads(path.read_text())
    require(isinstance(data, list), f"Corpus must be a JSON array: {path}")

    cases: list[CorpusCase] = []
    for item in data:
        require(isinstance(item, dict), "Each corpus item must be an object.")
        case_id = str(item["id"])
        reference = str(item["reference"]).strip()
        audio_value = item.get("audio_path")
        audio_path = resolve_audio_path(path, str(audio_value)) if audio_value else None
        cases.append(CorpusCase(id=case_id, reference=reference, audio_path=audio_path))

    if max_cases > 0:
        return cases[:max_cases]
    return cases


def resolve_audio_path(corpus_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    candidate = corpus_path.parent / path
    if candidate.exists():
        return candidate
    return REPO_ROOT / path


def shell_quote(path: Path) -> str:
    return str(path)


def require_tools(generate_tts: bool) -> None:
    require(shutil.which("ffmpeg") is not None, "ffmpeg is required for benchmark audio conversion.")
    if generate_tts:
        require(shutil.which("say") is not None, "macOS say is required to generate missing corpus audio.")


def generate_tts_audio(case: CorpusCase, audio_dir: Path, voice: str) -> Path:
    audio_dir.mkdir(parents=True, exist_ok=True)
    aiff_path = audio_dir / f"{case.id}.aiff"
    pcm_path = audio_dir / f"{case.id}.pcm"
    if pcm_path.exists():
        return pcm_path

    subprocess.run(
        ["say", "-v", voice, "-o", shell_quote(aiff_path), case.reference],
        check=True,
    )
    convert_to_pcm(aiff_path, pcm_path)
    return pcm_path


def convert_to_pcm(input_path: Path, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            shell_quote(input_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            shell_quote(output_path),
        ],
        check=True,
    )
    return output_path


def prepare_audio(
    cases: list[CorpusCase],
    run_dir: Path,
    *,
    audio_cache_dir: Path | None,
    generate_tts: bool,
    voice: str,
) -> dict[str, Path]:
    audio_paths: dict[str, Path] = {}
    generated_dir = audio_cache_dir or run_dir / "audio"

    for case in cases:
        if case.audio_path:
            require(case.audio_path.exists(), f"Audio file does not exist: {case.audio_path}")
            if case.audio_path.suffix == ".pcm":
                audio_paths[case.id] = case.audio_path
            else:
                audio_paths[case.id] = convert_to_pcm(
                    case.audio_path,
                    generated_dir / f"{case.id}.pcm",
                )
            continue

        require(
            generate_tts,
            f"Corpus case {case.id} has no audio_path. Provide audio or omit --no-tts.",
        )
        audio_paths[case.id] = generate_tts_audio(case, generated_dir, voice)

    return audio_paths


def make_sidecar_command(args: argparse.Namespace) -> list[str]:
    if args.binary:
        require(args.binary.exists(), f"Sidecar binary not found: {args.binary}")
        return [
            str(args.binary),
            "--family",
            args.family,
            "--weights-dir",
            str(args.weights_dir),
            "--language",
            args.language,
        ]

    require(args.python.exists(), f"Python interpreter not found: {args.python}")
    require(args.sidecar.exists(), f"Sidecar script not found: {args.sidecar}")
    return [
        str(args.python),
        str(args.sidecar),
        "--family",
        args.family,
        "--weights-dir",
        str(args.weights_dir),
        "--language",
        args.language,
    ]


def benchmark_env_snapshot() -> dict[str, str | None]:
    return {key: os.environ.get(key) for key in REPORT_ENV_KEYS}


def command_output(command: list[str]) -> str:
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT).strip()
    except Exception:
        return ""


def sysctl_value(name: str) -> str:
    return command_output(["sysctl", "-n", name])


def top_cpu_processes(limit: int = 8) -> list[dict[str, Any]]:
    output = command_output(["ps", "-Ao", "pid,pcpu,pmem,comm", "-r"])
    rows: list[dict[str, Any]] = []
    for line in output.splitlines()[1 : limit + 1]:
        parts = line.strip().split(None, 3)
        if len(parts) != 4:
            continue
        pid, cpu, memory, command = parts
        rows.append(
            {
                "pid": int(pid),
                "cpu_percent": float(cpu),
                "memory_percent": float(memory),
                "command": command,
            }
        )
    return rows


def system_snapshot() -> dict[str, Any]:
    load_avg = list(os.getloadavg()) if hasattr(os, "getloadavg") else []
    cpu_count = os.cpu_count() or 0
    memory_bytes = int(sysctl_value("hw.memsize") or 0)
    return {
        "captured_at": dt.datetime.now(dt.UTC).isoformat(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cpu_brand": sysctl_value("machdep.cpu.brand_string"),
        "cpu_count": cpu_count,
        "memory_gb": round(memory_bytes / 1024 / 1024 / 1024, 1)
        if memory_bytes
        else 0.0,
        "load_avg": [round(value, 2) for value in load_avg],
        "thermal": command_output(["pmset", "-g", "therm"]),
        "top_cpu_processes": top_cpu_processes(),
    }


def benchmark_caveats(system: dict[str, Any]) -> list[str]:
    caveats: list[str] = []
    snapshots = [system.get("before", {}), system.get("after", {})]
    cpu_count = max(int(snapshots[0].get("cpu_count") or 0), 1)

    max_load = 0.0
    for snapshot in snapshots:
        load_avg = snapshot.get("load_avg") or []
        if load_avg:
            max_load = max(max_load, float(load_avg[0]))

    if max_load >= cpu_count * 0.5:
        caveats.append(
            f"High system load during benchmark: max 1m load {max_load:.2f} across {cpu_count} CPUs."
        )

    top_processes = snapshots[-1].get("top_cpu_processes") or []
    busy_processes = [
        process
        for process in top_processes
        if float(process.get("cpu_percent") or 0.0) >= 20.0
    ]
    if busy_processes:
        names = ", ".join(
            f"{Path(str(process['command'])).name} {process['cpu_percent']:.1f}%"
            for process in busy_processes[:3]
        )
        caveats.append(f"Background CPU contention detected: {names}.")

    thermal = "\n".join(str(snapshot.get("thermal") or "") for snapshot in snapshots)
    if "warning" in thermal.lower() and "no thermal warning" not in thermal.lower():
        caveats.append("macOS reported a thermal or performance warning.")

    return caveats


def start_sidecar(command: list[str]) -> tuple[subprocess.Popen[bytes], int, list[str]]:
    stderr_lines: list[str] = []
    proc = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            stderr_lines.append(raw.decode("utf-8", "replace").rstrip())

    threading.Thread(target=drain_stderr, daemon=True).start()
    assert proc.stdout is not None

    start = time.perf_counter()
    line = proc.stdout.readline().decode("utf-8", "replace").strip()
    ready_ms = round((time.perf_counter() - start) * 1000)
    require(line, "Sidecar exited before ready.")
    event = json.loads(line)
    require(event.get("type") == "ready", f"Expected ready event, got: {event}")
    return proc, ready_ms, stderr_lines


def stop_sidecar(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    assert proc.stdin is not None
    proc.stdin.write(struct.pack("<I", 0))
    proc.stdin.flush()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def child_pids(pid: int) -> list[int]:
    try:
        output = subprocess.check_output(["pgrep", "-P", str(pid)], text=True)
        return [int(line.strip()) for line in output.splitlines() if line.strip()]
    except Exception:
        return []


def process_tree_pids(root_pid: int) -> list[int]:
    pending = [root_pid]
    seen: set[int] = set()
    while pending:
        pid = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        pending.extend(child for child in child_pids(pid) if child not in seen)
    return sorted(seen)


def rss_kb(pid: int) -> int:
    try:
        output = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True)
        value = output.strip()
        return int(value) if value else 0
    except Exception:
        return 0


def process_rss_mb(pid: int) -> float:
    total_kb = sum(rss_kb(process_pid) for process_pid in process_tree_pids(pid))
    return round(total_kb / 1024, 1)


def transcribe_pcm(proc: subprocess.Popen[bytes], pcm_path: Path) -> dict[str, Any]:
    assert proc.stdin is not None and proc.stdout is not None
    data = pcm_path.read_bytes()
    metadata = b"{}"
    start = time.perf_counter()
    proc.stdin.write(struct.pack("<I", len(metadata)))
    proc.stdin.write(metadata)
    proc.stdin.write(struct.pack("<I", len(data)))
    proc.stdin.write(data)
    proc.stdin.flush()

    while True:
        line = proc.stdout.readline().decode("utf-8", "replace").strip()
        require(line, "Sidecar closed stdout during transcription.")
        event = json.loads(line)
        if event.get("type") == "done":
            event["wall_ms"] = round((time.perf_counter() - start) * 1000)
            event["rss_after_mb"] = process_rss_mb(proc.pid)
            return event
        if event.get("type") == "error":
            raise RuntimeError(event)


def strict_tokens(text: str) -> list[str]:
    return text.strip().split()


def normalized_tokens(text: str) -> list[str]:
    text = text.lower()
    text = text.translate(str.maketrans("", "", string.punctuation.replace("_", "")))
    text = re.sub(r"\s+", " ", text).strip()
    return text.split() if text else []


def levenshtein(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, ref_token in enumerate(reference, start=1):
        current = [i]
        for j, hyp_token in enumerate(hypothesis, start=1):
            cost = 0 if ref_token == hyp_token else 1
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + cost,
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str, *, strict: bool) -> float:
    ref_tokens = strict_tokens(reference) if strict else normalized_tokens(reference)
    hyp_tokens = strict_tokens(hypothesis) if strict else normalized_tokens(hypothesis)
    if not ref_tokens:
        return 0.0 if not hyp_tokens else 1.0
    return levenshtein(ref_tokens, hyp_tokens) / len(ref_tokens)


def summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"mean": 0.0, "median": 0.0, "p95": 0.0, "min": 0.0, "max": 0.0}
    sorted_values = sorted(values)
    p95_index = min(len(sorted_values) - 1, round((len(sorted_values) - 1) * 0.95))
    return {
        "mean": round(statistics.fmean(values), 3),
        "median": round(statistics.median(values), 3),
        "p95": round(sorted_values[p95_index], 3),
        "min": round(sorted_values[0], 3),
        "max": round(sorted_values[-1], 3),
    }


def mb(value: Any) -> float:
    try:
        return round(float(value) / 1024 / 1024, 1)
    except Exception:
        return 0.0


def make_summary(results: list[dict[str, Any]], ready_ms: int) -> dict[str, Any]:
    measured = [row for row in results if not row["warmup"]]
    summary = {
        "ready_ms": ready_ms,
        "cases": len({row["case_id"] for row in measured}),
        "runs": len(measured),
        "wall_ms": summarize([row["wall_ms"] for row in measured]),
        "inference_ms": summarize([row["inference_ms"] for row in measured]),
        "rtf_wall": summarize([row["rtf_wall"] for row in measured]),
        "wer": summarize([row["wer"] for row in measured]),
        "strict_wer": summarize([row["strict_wer"] for row in measured]),
        "rss_after_mb": summarize([row["rss_after_mb"] for row in measured]),
        "mlx_peak_mb": summarize([row["mlx_peak_mb"] for row in measured]),
        "mlx_active_mb": summarize([row["mlx_active_mb"] for row in measured]),
        "mlx_cache_mb": summarize([row["mlx_cache_mb"] for row in measured]),
    }
    for key in TIMING_METRIC_KEYS:
        summary[key] = summarize([row[key] for row in measured])
    return summary


def write_markdown(report: dict[str, Any], path: Path) -> None:
    summary = report["summary"]
    rows = [row for row in report["results"] if not row["warmup"]]
    caveats = report.get("caveats", [])
    system_before = report.get("system", {}).get("before", {})
    system_after = report.get("system", {}).get("after", {})
    lines = [
        f"# STT Benchmark: {report['label']}",
        "",
        f"- Timestamp: `{report['timestamp']}`",
        f"- Command: `{' '.join(report['command'])}`",
        f"- Environment: `{json.dumps(report.get('environment', {}), sort_keys=True)}`",
        f"- System: `{system_before.get('cpu_brand', 'unknown')}`, `{system_before.get('memory_gb', 0)} GB`, `{system_before.get('platform', 'unknown')}`",
        f"- Load avg before: `{system_before.get('load_avg', [])}`",
        f"- Load avg after: `{system_after.get('load_avg', [])}`",
        f"- Ready: `{summary['ready_ms']} ms`",
        f"- Cases: `{summary['cases']}`",
        f"- Runs: `{summary['runs']}`",
        "",
        "## Summary",
        "",
        "| Metric | Mean | Median | P95 | Min | Max |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for key in (
        "wall_ms",
        "inference_ms",
        "rtf_wall",
        "wer",
        "strict_wer",
        "rss_after_mb",
        "mlx_peak_mb",
        "mlx_active_mb",
        "mlx_cache_mb",
        *TIMING_METRIC_KEYS,
    ):
        item = summary[key]
        lines.append(
            f"| {key} | {item['mean']} | {item['median']} | {item['p95']} | {item['min']} | {item['max']} |"
        )

    if caveats:
        lines.extend(["", "## Caveats", ""])
        lines.extend(f"- {caveat}" for caveat in caveats)

    lines.extend(
        [
            "",
            "## Runs",
            "",
            "| Case | Iter | Audio ms | Wall ms | Inference ms | WER | Strict WER | RSS MB | MLX Peak MB | Transcript |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ]
    )
    for row in rows:
        transcript = row["transcript"].replace("|", "\\|")
        lines.append(
            f"| {row['case_id']} | {row['iteration']} | {row['audio_duration_ms']} | {row['wall_ms']} | {row['inference_ms']} | "
            f"{row['wer']:.3f} | {row['strict_wer']:.3f} | {row['rss_after_mb']} | {row['mlx_peak_mb']} | {transcript} |"
        )
    path.write_text("\n".join(lines) + "\n")


def run_benchmark(args: argparse.Namespace) -> dict[str, Any]:
    ensure_weights(args.weights_dir.expanduser(), args.family)
    require_tools(generate_tts=not args.no_tts)

    timestamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.output_dir / "runs" / f"{timestamp}-{args.label}"
    run_dir.mkdir(parents=True, exist_ok=True)

    cases = load_corpus(args.corpus, args.max_cases)
    audio_paths = prepare_audio(
        cases,
        run_dir,
        audio_cache_dir=args.audio_cache_dir.expanduser()
        if args.audio_cache_dir
        else None,
        generate_tts=not args.no_tts,
        voice=args.voice,
    )
    command = make_sidecar_command(args)
    system_before = system_snapshot()
    proc, ready_ms, stderr_lines = start_sidecar(command)

    results: list[dict[str, Any]] = []
    try:
        schedule: list[tuple[bool, int, CorpusCase]] = []
        for index in range(args.warmup):
            schedule.append((True, index + 1, cases[index % len(cases)]))
        for iteration in range(1, args.repeat + 1):
            for case in cases:
                schedule.append((False, iteration, case))

        for warmup, iteration, case in schedule:
            event = transcribe_pcm(proc, audio_paths[case.id])
            metrics = event["metrics"]
            audio_duration_ms = int(metrics.get("audio_duration_ms") or 0)
            wall_ms = int(event["wall_ms"])
            inference_ms = int(metrics.get("inference_ms") or 0)
            transcript = str(event.get("transcript") or "")
            row = {
                "case_id": case.id,
                "iteration": iteration,
                "warmup": warmup,
                "reference": case.reference,
                "transcript": transcript,
                "audio_path": str(audio_paths[case.id]),
                "audio_duration_ms": audio_duration_ms,
                "wall_ms": wall_ms,
                "inference_ms": inference_ms,
                "rtf_wall": round(wall_ms / audio_duration_ms, 4)
                if audio_duration_ms
                else 0.0,
                "wer": word_error_rate(case.reference, transcript, strict=False),
                "strict_wer": word_error_rate(case.reference, transcript, strict=True),
                "word_count": int(metrics.get("word_count") or 0),
                "segment_count": int(metrics.get("segment_count") or 0),
                "decode_sample_len": metrics.get("decode_sample_len"),
                "profile_enabled": bool(metrics.get("profile_enabled")),
                **{
                    key: int(metrics.get(key) or 0)
                    for key in TIMING_METRIC_KEYS
                },
                "rss_after_mb": float(event.get("rss_after_mb") or 0.0),
                "mlx_peak_mb": mb(metrics.get("peak_memory_bytes")),
                "mlx_active_mb": mb(metrics.get("active_memory_bytes")),
                "mlx_cache_mb": mb(metrics.get("cache_memory_bytes")),
                "model_load_ms": int(metrics.get("model_load_ms") or 0),
                "model_load_peak_mb": mb(metrics.get("model_load_peak_memory_bytes")),
            }
            results.append(row)
            marker = "warmup" if warmup else f"iter {iteration}"
            print(
                f"{case.id:18s} {marker:8s} wall={wall_ms:5d}ms "
                f"infer={inference_ms:5d}ms wer={row['wer']:.3f} "
                f"rss={row['rss_after_mb']:.1f}MB peak={row['mlx_peak_mb']:.1f}MB"
            )
    finally:
        stop_sidecar(proc)

    system = {
        "before": system_before,
        "after": system_snapshot(),
    }
    report = {
        "label": args.label,
        "timestamp": timestamp,
        "command": command,
        "environment": benchmark_env_snapshot(),
        "system": system,
        "caveats": benchmark_caveats(system),
        "weights_dir": str(args.weights_dir.expanduser()),
        "corpus": str(args.corpus),
        "audio_cache_dir": str(args.audio_cache_dir.expanduser())
        if args.audio_cache_dir
        else None,
        "repeat": args.repeat,
        "warmup": args.warmup,
        "summary": make_summary(results, ready_ms),
        "results": results,
        "stderr_tail": stderr_lines[-50:],
    }
    json_path = run_dir / "report.json"
    md_path = run_dir / "report.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    write_markdown(report, md_path)

    print("")
    print(f"JSON: {json_path}")
    print(f"Markdown: {md_path}")
    print(json.dumps(report["summary"], indent=2))
    return report


def main() -> int:
    args = parse_args()
    require(args.repeat >= 1, "--repeat must be >= 1")
    require(args.warmup >= 0, "--warmup must be >= 0")
    run_benchmark(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
