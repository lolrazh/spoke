#!/usr/bin/env python3
"""
Convert Moonshine v2 HuggingFace weights to MLX-compatible safetensors.

Downloads from UsefulSensors/moonshine-streaming-medium, remaps key names
to match our MLX model, transposes Conv1d weights, and saves alongside
tokenizer.json into local-stt/weights/.

Usage:
    python convert_weights.py
"""

import sys
import shutil
from pathlib import Path


def convert():
    try:
        from huggingface_hub import snapshot_download
        from safetensors import safe_open
        from safetensors.numpy import save_file
        import numpy as np
    except ImportError:
        print(
            "Install deps first: pip install huggingface_hub safetensors numpy",
            file=sys.stderr,
        )
        sys.exit(1)

    HF_MODEL = "UsefulSensors/moonshine-streaming-medium"
    OUT_DIR = Path(__file__).parent / "weights"
    OUT_DIR.mkdir(exist_ok=True)

    print(f"Downloading {HF_MODEL}...")
    hf_path = Path(
        snapshot_download(HF_MODEL, allow_patterns=["*.safetensors", "tokenizer.json"])
    )

    # Load all HF tensors
    hf_tensors = {}
    for sf_file in hf_path.glob("*.safetensors"):
        with safe_open(str(sf_file), framework="numpy") as f:
            for key in f.keys():
                hf_tensors[key] = f.get_tensor(key)

    print(f"Loaded {len(hf_tensors)} tensors from HF")

    # Remap keys
    mlx_tensors = {}
    skipped = []
    conv1d_transposed = []

    for key, tensor in sorted(hf_tensors.items()):
        new_key = key

        # Skip rotary embedding inverse frequencies (MLX RoPE computes internally)
        if "rotary_emb.inv_freq" in key:
            skipped.append(key)
            continue

        # Strip model. prefix
        if new_key.startswith("model."):
            new_key = new_key[len("model."):]

        # Rename encoder_attn → cross_attn in decoder layers
        new_key = new_key.replace("encoder_attn", "cross_attn")

        # Transpose Conv1d weights: PyTorch (C_out, C_in, K) → MLX (C_out, K, C_in)
        if tensor.ndim == 3 and "weight" in new_key:
            old_shape = tensor.shape
            tensor = np.swapaxes(tensor, 1, 2)
            conv1d_transposed.append(f"{new_key}: {old_shape} → {tensor.shape}")

        mlx_tensors[new_key] = tensor

    # Summary
    print(f"\nSkipped {len(skipped)} keys:")
    for k in skipped:
        print(f"  {k}")

    print(f"\nTransposed {len(conv1d_transposed)} Conv1d weights:")
    for desc in conv1d_transposed:
        print(f"  {desc}")

    print(f"\nOutput: {len(mlx_tensors)} tensors")

    # Save weights
    out_file = OUT_DIR / "weights.safetensors"
    save_file(mlx_tensors, str(out_file))
    size_mb = out_file.stat().st_size / 1e6
    print(f"\nSaved to {out_file} ({size_mb:.1f} MB)")

    # Copy tokenizer
    tokenizer_src = hf_path / "tokenizer.json"
    if tokenizer_src.exists():
        shutil.copy2(tokenizer_src, OUT_DIR / "tokenizer.json")
        print("Copied tokenizer.json")
    else:
        print("WARNING: tokenizer.json not found!", file=sys.stderr)

    # Shape summary
    print("\n=== Shape Summary ===")
    for key in sorted(mlx_tensors.keys()):
        t = mlx_tensors[key]
        print(f"  {key}: {t.shape} {t.dtype}")


if __name__ == "__main__":
    convert()
