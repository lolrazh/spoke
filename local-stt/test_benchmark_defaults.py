#!/usr/bin/env python3

import unittest
from pathlib import Path

import benchmark
import benchmark_suite


class BenchmarkDefaultsTest(unittest.TestCase):
    def test_default_weights_follow_selected_family(self) -> None:
        for family in benchmark.REQUIRED_MODEL_FILES:
            with self.subTest(family=family):
                args = benchmark.parse_args(["--family", family])
                self.assertEqual(
                    args.weights_dir,
                    benchmark.DEFAULT_WEIGHTS_ROOT / family,
                )

    def test_explicit_weights_directory_is_preserved(self) -> None:
        weights_dir = Path("/tmp/custom-stt-weights")
        args = benchmark.parse_args(
            ["--family", "parakeet", "--weights-dir", str(weights_dir)]
        )
        self.assertEqual(args.weights_dir, weights_dir)

    def test_whisper_suite_uses_installed_whisper_directory(self) -> None:
        self.assertEqual(
            benchmark_suite.DEFAULT_WEIGHTS_DIR,
            benchmark.DEFAULT_WEIGHTS_ROOT / "whisper",
        )


if __name__ == "__main__":
    unittest.main()
