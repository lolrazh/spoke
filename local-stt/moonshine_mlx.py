"""
Moonshine v2 (streaming-medium) — MLX implementation.

Encoder-decoder speech model: 768-dim encoder (14 layers), 640-dim decoder
(14 layers), ~245M params. Greedy decode with KV caching.

Weight keys match the output of convert_weights.py (HF keys with 'model.'
stripped, 'encoder_attn' → 'cross_attn', Conv1d weights transposed to NLC).
"""

import math
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ENCODER_DIM = 768
ENCODER_LAYERS = 14
ENCODER_HEADS = 10
ENCODER_HEAD_DIM = 64
ENCODER_INTERMEDIATE = 3072

DECODER_DIM = 640
DECODER_LAYERS = 14
DECODER_HEADS = 10
DECODER_HEAD_DIM = 64
DECODER_INTERMEDIATE = 2560

VOCAB_SIZE = 32768
MAX_POS = 4096
SAMPLE_RATE = 16000
FRAME_MS = 5.0
FRAME_LEN = int(SAMPLE_RATE * FRAME_MS / 1000)  # 80

# Sliding window specs per encoder layer: [left, right]
SLIDING_WINDOWS = [
    [16, 4], [16, 4],                                       # layers 0-1
    [16, 0], [16, 0], [16, 0], [16, 0], [16, 0],           # layers 2-6
    [16, 0], [16, 0], [16, 0], [16, 0], [16, 0],           # layers 7-11
    [16, 4], [16, 4],                                       # layers 12-13
]

ROPE_THETA = 10000.0
PARTIAL_ROTARY_DIMS = DECODER_HEAD_DIM // 2  # 32 of 64


# ---------------------------------------------------------------------------
# Custom modules
# ---------------------------------------------------------------------------
class UnitOffsetLayerNorm(nn.Module):
    """LayerNorm(elementwise_affine=False) * (gamma + 1.0). Encoder-specific."""

    def __init__(self, dims: int):
        super().__init__()
        self.gamma = mx.ones((dims,))

    def __call__(self, x):
        mean = mx.mean(x, axis=-1, keepdims=True)
        centered = x - mean
        var = mx.mean(centered * centered, axis=-1, keepdims=True)
        normed = centered * mx.rsqrt(var + 1e-5)
        return normed * (self.gamma + 1.0)


class DecoderLayerNorm(nn.Module):
    """Standard LayerNorm without bias (decoder). Matches HF nn.LayerNorm(bias=False)."""

    def __init__(self, dims: int):
        super().__init__()
        self.weight = mx.ones((dims,))

    def __call__(self, x):
        mean = mx.mean(x, axis=-1, keepdims=True)
        centered = x - mean
        var = mx.mean(centered * centered, axis=-1, keepdims=True)
        normed = centered * mx.rsqrt(var + 1e-5)
        return normed * self.weight


class AsinhCompression(nn.Module):
    """arcsinh(exp(log_k) * x) with learnable log_k."""

    def __init__(self):
        super().__init__()
        self.log_k = mx.array(math.log(0.75))

    def __call__(self, x):
        return mx.arcsinh(mx.exp(self.log_k) * x)


class CausalConv1d(nn.Module):
    """Left-padded Conv1d. MLX conv1d expects (B, L, C_in), weight (C_out, K, C_in)."""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, stride: int = 1):
        super().__init__()
        self.stride = stride
        self.left_pad = kernel_size - 1
        # Weight shape: (C_out, K, C_in) — already transposed by convert_weights
        self.weight = mx.zeros((out_channels, kernel_size, in_channels))
        self.bias = mx.zeros((out_channels,))

    def __call__(self, x):
        # x: (B, L, C) — NLC format
        # Left-pad along time dimension
        pad_width = [(0, 0), (self.left_pad, 0), (0, 0)]
        x = mx.pad(x, pad_width)
        return mx.conv1d(x, self.weight, stride=self.stride) + self.bias


# ---------------------------------------------------------------------------
# Encoder
# ---------------------------------------------------------------------------
class EncoderEmbedder(nn.Module):
    """Audio frontend: frames → CMVN → compression → linear → conv → conv."""

    def __init__(self):
        super().__init__()
        self.comp = AsinhCompression()
        self.linear = nn.Linear(FRAME_LEN, ENCODER_DIM, bias=False)
        self.conv1 = CausalConv1d(ENCODER_DIM, ENCODER_DIM * 2, kernel_size=5, stride=2)
        self.conv2 = CausalConv1d(ENCODER_DIM * 2, ENCODER_DIM, kernel_size=5, stride=2)

    def __call__(self, audio: mx.array) -> mx.array:
        # audio: (B, samples) raw float32
        B = audio.shape[0]
        num_frames = audio.shape[1] // FRAME_LEN
        x = audio[:, :num_frames * FRAME_LEN].reshape(B, num_frames, FRAME_LEN)

        # Per-frame CMVN (no learned params)
        mean = mx.mean(x, axis=-1, keepdims=True)
        centered = x - mean
        rms = mx.sqrt(mx.mean(centered * centered, axis=-1, keepdims=True) + 1e-6)
        x = centered / rms

        # Compression + projection
        x = self.comp(x)
        x = nn.silu(self.linear(x))  # (B, num_frames, 768)

        # Conv downsampling (NLC format throughout)
        x = nn.silu(self.conv1(x))
        x = self.conv2(x)  # no activation after last conv — matches HF
        return x  # (B, num_frames // 4, 768)


class EncoderAttention(nn.Module):
    """Multi-head attention with sliding window mask."""

    def __init__(self, layer_idx: int):
        super().__init__()
        self.layer_idx = layer_idx
        self.n_heads = ENCODER_HEADS
        self.head_dim = ENCODER_HEAD_DIM
        self.scale = ENCODER_HEAD_DIM ** -0.5
        self.window = SLIDING_WINDOWS[layer_idx]  # [left, right]

        self.q_proj = nn.Linear(ENCODER_DIM, ENCODER_HEADS * ENCODER_HEAD_DIM, bias=False)
        self.k_proj = nn.Linear(ENCODER_DIM, ENCODER_HEADS * ENCODER_HEAD_DIM, bias=False)
        self.v_proj = nn.Linear(ENCODER_DIM, ENCODER_HEADS * ENCODER_HEAD_DIM, bias=False)
        self.o_proj = nn.Linear(ENCODER_HEADS * ENCODER_HEAD_DIM, ENCODER_DIM, bias=False)

    def __call__(self, x: mx.array) -> mx.array:
        B, L, _ = x.shape
        q = self.q_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        k = self.k_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        v = self.v_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)

        # Sliding window mask
        left, right = self.window
        positions = mx.arange(L)
        diff = positions[:, None] - positions[None, :]  # (L, L), diff[i,j] = i - j
        mask = (diff <= left) & (diff >= -right)  # bool (L, L)
        mask = mx.where(mask, mx.array(0.0), mx.array(-1e9))  # additive mask
        mask = mask[None, None, :, :]  # (1, 1, L, L)

        attn = (q @ k.transpose(0, 1, 3, 2)) * self.scale + mask
        attn = mx.softmax(attn, axis=-1)
        out = (attn @ v).transpose(0, 2, 1, 3).reshape(B, L, -1)
        return self.o_proj(out)


class EncoderMLP(nn.Module):
    """fc1 → GELU → fc2."""

    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(ENCODER_DIM, ENCODER_INTERMEDIATE)
        self.fc2 = nn.Linear(ENCODER_INTERMEDIATE, ENCODER_DIM)

    def __call__(self, x):
        return self.fc2(nn.gelu(self.fc1(x)))


class EncoderLayer(nn.Module):
    def __init__(self, layer_idx: int):
        super().__init__()
        self.self_attn = EncoderAttention(layer_idx)
        self.mlp = EncoderMLP()
        self.input_layernorm = UnitOffsetLayerNorm(ENCODER_DIM)
        self.post_attention_layernorm = UnitOffsetLayerNorm(ENCODER_DIM)

    def __call__(self, x: mx.array) -> mx.array:
        x = x + self.self_attn(self.input_layernorm(x))
        x = x + self.mlp(self.post_attention_layernorm(x))
        return x


class Encoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedder = EncoderEmbedder()
        self.layers = [EncoderLayer(i) for i in range(ENCODER_LAYERS)]
        self.final_norm = UnitOffsetLayerNorm(ENCODER_DIM)

    def __call__(self, audio: mx.array) -> mx.array:
        x = self.embedder(audio)
        for layer in self.layers:
            x = layer(x)
        return self.final_norm(x)


# ---------------------------------------------------------------------------
# Decoder
# ---------------------------------------------------------------------------
class RotaryEmbedding:
    """RoPE: partial rotary on first PARTIAL_ROTARY_DIMS of head_dim."""

    def __init__(self):
        inv_freq = 1.0 / (ROPE_THETA ** (mx.arange(0, PARTIAL_ROTARY_DIMS, 2, dtype=mx.float32) / PARTIAL_ROTARY_DIMS))
        self._inv_freq = inv_freq

    def __call__(self, positions: mx.array):
        # positions: (L,) int
        freqs = positions[:, None].astype(mx.float32) * self._inv_freq[None, :]  # (L, D/2)
        cos = mx.cos(freqs)
        sin = mx.sin(freqs)
        return cos, sin


def apply_rope(x: mx.array, cos: mx.array, sin: mx.array) -> mx.array:
    """Apply RoPE to first PARTIAL_ROTARY_DIMS dims of x. x: (B, H, L, D).

    Uses half-split convention (matching HF transformers): split rotary dims
    into first half / second half, not interleaved even/odd.
    """
    d = PARTIAL_ROTARY_DIMS
    x_rot = x[..., :d]
    x_pass = x[..., d:]

    # Half-split: x1 = first 16 dims, x2 = last 16 dims
    x1 = x_rot[..., :d // 2]
    x2 = x_rot[..., d // 2:]

    # cos/sin: (L, D/4) → (1, 1, L, D/4)
    cos = cos[None, None, :, :]
    sin = sin[None, None, :, :]

    first = x1 * cos - x2 * sin
    second = x2 * cos + x1 * sin
    rotated = mx.concatenate([first, second], axis=-1)
    return mx.concatenate([rotated, x_pass], axis=-1)


class DecoderSelfAttention(nn.Module):
    """Causal self-attention with RoPE and KV cache."""

    def __init__(self):
        super().__init__()
        self.n_heads = DECODER_HEADS
        self.head_dim = DECODER_HEAD_DIM
        self.scale = DECODER_HEAD_DIM ** -0.5

        self.q_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.k_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.v_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.o_proj = nn.Linear(DECODER_HEADS * DECODER_HEAD_DIM, DECODER_DIM, bias=False)

    def __call__(self, x: mx.array, rope_cos, rope_sin, cache=None):
        B, L, _ = x.shape
        q = self.q_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        k = self.k_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        v = self.v_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)

        q = apply_rope(q, rope_cos, rope_sin)
        k = apply_rope(k, rope_cos, rope_sin)

        if cache is not None:
            k = mx.concatenate([cache[0], k], axis=2)
            v = mx.concatenate([cache[1], v], axis=2)
        new_cache = (k, v)

        # Causal mask (only needed when L > 1, i.e., not single-token decode)
        attn = (q @ k.transpose(0, 1, 3, 2)) * self.scale
        if L > 1:
            causal = mx.triu(mx.full((L, L), -1e9), k=1)
            attn = attn + causal[None, None, :, :]

        attn = mx.softmax(attn, axis=-1)
        out = (attn @ v).transpose(0, 2, 1, 3).reshape(B, L, -1)
        return self.o_proj(out), new_cache


class DecoderCrossAttention(nn.Module):
    """Cross-attention to encoder output. Cache stores projected K/V."""

    def __init__(self):
        super().__init__()
        self.n_heads = DECODER_HEADS
        self.head_dim = DECODER_HEAD_DIM
        self.scale = DECODER_HEAD_DIM ** -0.5

        self.q_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.k_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.v_proj = nn.Linear(DECODER_DIM, DECODER_HEADS * DECODER_HEAD_DIM, bias=False)
        self.o_proj = nn.Linear(DECODER_HEADS * DECODER_HEAD_DIM, DECODER_DIM, bias=False)

    def __call__(self, x: mx.array, enc_bridged: mx.array, cache=None):
        B, L, _ = x.shape

        q = self.q_proj(x).reshape(B, L, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)

        if cache is not None:
            k, v = cache
        else:
            # enc_bridged is already projected to DECODER_DIM by the bridge
            Ls = enc_bridged.shape[1]
            k = self.k_proj(enc_bridged).reshape(B, Ls, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
            v = self.v_proj(enc_bridged).reshape(B, Ls, self.n_heads, self.head_dim).transpose(0, 2, 1, 3)
        new_cache = (k, v)

        attn = (q @ k.transpose(0, 1, 3, 2)) * self.scale
        attn = mx.softmax(attn, axis=-1)
        out = (attn @ v).transpose(0, 2, 1, 3).reshape(B, L, -1)
        return self.o_proj(out), new_cache


class DecoderMLP(nn.Module):
    """SwiGLU: fc1 → split → silu(gate) * hidden → fc2."""

    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(DECODER_DIM, DECODER_INTERMEDIATE * 2)
        self.fc2 = nn.Linear(DECODER_INTERMEDIATE, DECODER_DIM)

    def __call__(self, x):
        x = self.fc1(x)
        hidden, gate = mx.split(x, 2, axis=-1)
        return self.fc2(nn.silu(gate) * hidden)


class DecoderLayer(nn.Module):
    def __init__(self):
        super().__init__()
        self.self_attn = DecoderSelfAttention()
        self.cross_attn = DecoderCrossAttention()
        self.mlp = DecoderMLP()
        self.input_layernorm = DecoderLayerNorm(DECODER_DIM)
        self.post_attention_layernorm = DecoderLayerNorm(DECODER_DIM)
        self.final_layernorm = DecoderLayerNorm(DECODER_DIM)

    def __call__(self, x, enc_bridged, rope_cos, rope_sin, self_cache=None, cross_cache=None):
        # Self-attention
        r, new_self_cache = self.self_attn(self.input_layernorm(x), rope_cos, rope_sin, self_cache)
        x = x + r
        # Cross-attention (enc_bridged is already 640-dim)
        r, new_cross_cache = self.cross_attn(self.post_attention_layernorm(x), enc_bridged, cross_cache)
        x = x + r
        # FFN
        x = x + self.mlp(self.final_layernorm(x))
        return x, new_self_cache, new_cross_cache


class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed_tokens = nn.Embedding(VOCAB_SIZE, DECODER_DIM)
        self.pos_emb = nn.Embedding(MAX_POS, ENCODER_DIM)
        self.proj = nn.Linear(ENCODER_DIM, DECODER_DIM, bias=False)
        self.layers = [DecoderLayer() for _ in range(DECODER_LAYERS)]
        self.norm = DecoderLayerNorm(DECODER_DIM)

    def bridge(self, encoder_out: mx.array) -> mx.array:
        """Bridge encoder output (768-dim) to decoder space (640-dim)."""
        S = encoder_out.shape[1]
        pos_ids = mx.arange(S)
        bridged = encoder_out + self.pos_emb(pos_ids)[None, :, :]
        return self.proj(bridged)

    def __call__(self, token_ids, enc_bridged, positions, rope_cos, rope_sin, cache=None):
        """
        token_ids: (B, L) int
        enc_bridged: (B, S, 640) — bridged encoder output
        positions: (L,) int — position indices
        rope_cos, rope_sin: RoPE for these positions
        cache: list of (self_cache, cross_cache) per layer, or None
        """
        x = self.embed_tokens(token_ids)

        new_cache = []
        for i, layer in enumerate(self.layers):
            sc = cache[i][0] if cache else None
            cc = cache[i][1] if cache else None
            x, new_sc, new_cc = layer(x, enc_bridged, rope_cos, rope_sin, sc, cc)
            new_cache.append((new_sc, new_cc))

        return self.norm(x), new_cache


# ---------------------------------------------------------------------------
# Full model
# ---------------------------------------------------------------------------
class MoonshineMLX(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = Encoder()
        self.decoder = Decoder()
        self.proj_out = nn.Linear(DECODER_DIM, VOCAB_SIZE, bias=False)
        self._rope = RotaryEmbedding()

    @staticmethod
    def from_pretrained(weights_dir: str | Path) -> "MoonshineMLX":
        """Load model from converted weights directory."""
        weights_dir = Path(weights_dir)
        model = MoonshineMLX()

        weights = mx.load(str(weights_dir / "weights.safetensors"))
        model.load_weights(list(weights.items()))
        mx.eval(model.parameters())
        return model

    def encode(self, audio: mx.array) -> mx.array:
        """Encode audio → encoder hidden states. audio: (B, samples) float32."""
        return self.encoder(audio)

    def decode_step(self, token_ids: mx.array, enc_bridged: mx.array,
                    step: int, cache=None):
        """
        Single decode step.
        token_ids: (B, 1) for cached decode, (B, L) for prefill
        enc_bridged: (B, S, 640) — already bridged encoder output
        step: current position index (for RoPE)
        Returns: logits (B, 1, vocab), new_cache
        """
        L = token_ids.shape[1]
        positions = mx.arange(step, step + L)
        rope_cos, rope_sin = self._rope(positions)

        hidden, new_cache = self.decoder(token_ids, enc_bridged, positions,
                                         rope_cos, rope_sin, cache)
        logits = self.proj_out(hidden)
        return logits, new_cache

    def generate(self, audio: mx.array, max_tokens: int, callback=None):
        """
        Greedy decode. Calls callback(token_id) after each token
        if provided (for streaming partials).

        Returns list of token IDs (excluding BOS).
        """
        BOS, EOS = 1, 2

        encoder_out = self.encode(audio)
        mx.eval(encoder_out)

        # Bridge once (768 → 640), reused for all decode steps
        enc_bridged = self.decoder.bridge(encoder_out)
        mx.eval(enc_bridged)

        # Start with BOS
        token = mx.array([[BOS]])
        cache = None
        tokens = []

        for step in range(max_tokens):
            logits, cache = self.decode_step(token, enc_bridged, step, cache)
            mx.eval(logits, *[c for pair in cache for c in pair])

            next_id = mx.argmax(logits[:, -1, :], axis=-1).item()
            if next_id == EOS:
                break

            tokens.append(next_id)

            # Stop on n-gram repetition (trailing hallucination guard)
            repeated = False
            for w in range(3, 21):
                if len(tokens) >= w * 2:
                    if tokens[-w:] == tokens[-w * 2:-w]:
                        tokens = tokens[:-w]
                        repeated = True
                        break
            if repeated:
                break

            if callback:
                callback(next_id)

            token = mx.array([[next_id]])

        return tokens


def count_params(model: nn.Module) -> int:
    """Count total parameters."""
    import mlx.utils
    total = 0
    for k, v in mlx.utils.tree_flatten(model.parameters()):
        total += v.size
    return total
