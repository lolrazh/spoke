from __future__ import annotations

import unittest
from types import SimpleNamespace

from sidecar import PARAKEET_QUANT_GROUP_SIZE, parakeet_quant_bits


def checkpoint(bits: float, inputs: int = 640) -> dict[str, SimpleNamespace]:
    """Shapes of one quantized linear layer, as mlx.nn.quantize packs it."""
    return {
        "joint.pred.weight": SimpleNamespace(shape=(640, int(inputs * bits / 32))),
        "joint.pred.scales": SimpleNamespace(
            shape=(640, inputs // PARAKEET_QUANT_GROUP_SIZE)
        ),
        "joint.pred.biases": SimpleNamespace(
            shape=(640, inputs // PARAKEET_QUANT_GROUP_SIZE)
        ),
        "encoder.conv.weight": SimpleNamespace(shape=(256, 3, 3)),
    }


class ParakeetQuantBitsTests(unittest.TestCase):
    def test_reads_the_current_8_bit_checkpoint(self) -> None:
        self.assertEqual(parakeet_quant_bits(checkpoint(8)), 8)

    def test_reads_the_earlier_6_bit_checkpoint(self) -> None:
        self.assertEqual(parakeet_quant_bits(checkpoint(6)), 6)

    def test_rejects_an_unsupported_width(self) -> None:
        with self.assertRaises(RuntimeError):
            parakeet_quant_bits(checkpoint(4))

    def test_rejects_a_checkpoint_with_mixed_widths(self) -> None:
        mixed = checkpoint(8)
        mixed["decoder.out.weight"] = SimpleNamespace(shape=(640, 120))
        mixed["decoder.out.scales"] = SimpleNamespace(shape=(640, 10))
        with self.assertRaises(RuntimeError):
            parakeet_quant_bits(mixed)

    def test_rejects_an_unquantized_checkpoint(self) -> None:
        with self.assertRaises(RuntimeError):
            parakeet_quant_bits(
                {"encoder.conv.weight": SimpleNamespace(shape=(256, 3, 3))}
            )


if __name__ == "__main__":
    unittest.main()
