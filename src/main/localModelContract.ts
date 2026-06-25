/**
 * Local model registry.
 *
 * Each selectable on-device ASR model is described by a download manifest
 * (files + URLs + SHA256 for integrity) plus UI-facing metadata. The model
 * manager reads this registry by modelId; nothing else should hardcode a
 * single model.
 */

import type {
  LocalModelFamily,
  LocalModelInfo,
  ModelManifest,
} from "../types/shared";

export const LOCAL_MODEL_MANIFEST_VERSION = 1;

function hfResolveBase(modelId: string, version: string): string {
  return `https://huggingface.co/${modelId}/resolve/${version}`;
}

function totalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((sum, file) => sum + file.size, 0);
}

// ── Whisper large-v3 turbo (4-bit) ────────────────────────────────────

const WHISPER_ID = "spokedotso/whisper-large-v3-turbo-4bit";
const WHISPER_VERSION = "7bf3b66db8320cbf31d31a9e8a9d4a453bc62f52";
const WHISPER_BASE = hfResolveBase(WHISPER_ID, WHISPER_VERSION);

const WHISPER_MANIFEST: ModelManifest = {
  manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
  family: "whisper",
  modelId: WHISPER_ID,
  displayName: "Whisper Large-v3 Turbo",
  version: WHISPER_VERSION,
  files: [
    {
      role: "config",
      path: "config.json",
      url: `${WHISPER_BASE}/config.json`,
      sha256:
        "538e24557b8f9bc504700add5e7bbe32087c2353001ff563e64772ad4398671a",
      size: 341,
    },
    {
      role: "weights",
      path: "weights.safetensors",
      url: `${WHISPER_BASE}/model.safetensors`,
      sha256:
        "e2d6146b49644c13ed7467060d3c43c402bbdfca1f01f1c21f6fbeda23b6567e",
      size: 463462982,
    },
    {
      role: "tokenizer",
      path: "multilingual.tiktoken",
      url: `${WHISPER_BASE}/multilingual.tiktoken`,
      sha256:
        "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
      size: 816730,
    },
  ],
};

// ── Cohere Transcribe (4-bit) ─────────────────────────────────────────

const COHERE_ID = "spokedotso/cohere-transcribe-03-2026-mlx-4bit";
const COHERE_VERSION = "064e51eab6db47066cbeaa85e2894b5691bd8d12";
const COHERE_BASE = hfResolveBase(COHERE_ID, COHERE_VERSION);

// Cohere loads through mlx-speech's CohereAsrModel.from_path(), which expects
// the full processor + tokenizer set alongside the weights, so all files are
// downloaded verbatim (no rename, unlike Whisper's model->weights mapping).
const COHERE_MANIFEST: ModelManifest = {
  manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
  family: "cohere",
  modelId: COHERE_ID,
  displayName: "Cohere Transcribe 03-2026 4-bit",
  version: COHERE_VERSION,
  files: [
    {
      role: "config",
      path: "config.json",
      url: `${COHERE_BASE}/config.json`,
      sha256:
        "c9f2934c33c22014a339d2451493c72f2fddff289ca83c62cd07c6502fcc092d",
      size: 1218,
    },
    {
      role: "weights",
      path: "model.safetensors",
      url: `${COHERE_BASE}/model.safetensors`,
      sha256:
        "ae947c13ba1cb8ce24c8bf72ded2520dcda1894ebf5a54fbb803c03bc28ef7fb",
      size: 1505759837,
    },
    {
      role: "tokenizer",
      path: "tokenizer.json",
      url: `${COHERE_BASE}/tokenizer.json`,
      sha256:
        "780ccca2de2ccd289971b1fb7d4f0b5ec2dc908872f6e350181c7eba9db3fa9f",
      size: 1816694,
    },
    {
      role: "tokenizer",
      path: "tokenizer.model",
      url: `${COHERE_BASE}/tokenizer.model`,
      sha256:
        "6d21e6a83b2d0d3e1241a7817e4bef8eb63bcb7cfe4a2675af9a35ff3bbf0e14",
      size: 492827,
    },
    {
      role: "aux",
      path: "tokenizer_config.json",
      url: `${COHERE_BASE}/tokenizer_config.json`,
      sha256:
        "b462e16e04c9dbae82289b6ef9b080d8dbad331586ece3ebded0bd09996db636",
      size: 48138,
    },
    {
      role: "aux",
      path: "generation_config.json",
      url: `${COHERE_BASE}/generation_config.json`,
      sha256:
        "a4837377b5696b1d04033536f25a6d0a11d5e613c6d7d75bf20ffc463ae642c6",
      size: 234,
    },
    {
      role: "aux",
      path: "preprocessor_config.json",
      url: `${COHERE_BASE}/preprocessor_config.json`,
      sha256:
        "9f297d330646ecc8ebb9dc5784f48b7c35b118c913e306a1ccd0192f2c976332",
      size: 420,
    },
    {
      role: "aux",
      path: "processor_config.json",
      url: `${COHERE_BASE}/processor_config.json`,
      sha256:
        "d5eff85971bab7f42480856f8fb397d8dd966858d67049def99aa8a665aa87d5",
      size: 131,
    },
    {
      role: "aux",
      path: "special_tokens_map.json",
      url: `${COHERE_BASE}/special_tokens_map.json`,
      sha256:
        "1814ce01458ff6a72b04a6618e75f18ce627be4dc17619cd3a7cd7f71e137f0f",
      size: 4091,
    },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────

export type LocalModelEntry = {
  manifest: ModelManifest;
  info: LocalModelInfo;
  /** Files that must exist on disk for the model to count as installed. */
  requiredFilePaths: readonly string[];
};

/** The model pre-selected in onboarding and used for fresh installs. */
export const DEFAULT_MODEL_ID = COHERE_ID;

function makeInfo(
  manifest: ModelManifest,
  extra: { tagline: string; languageCount: number; isDefault: boolean },
): LocalModelInfo {
  return {
    modelId: manifest.modelId,
    family: manifest.family,
    displayName: manifest.displayName,
    tagline: extra.tagline,
    languageCount: extra.languageCount,
    totalBytes: totalBytes(manifest),
    isDefault: extra.isDefault,
  };
}

export const LOCAL_MODELS: Record<string, LocalModelEntry> = {
  [COHERE_ID]: {
    manifest: COHERE_MANIFEST,
    info: makeInfo(COHERE_MANIFEST, {
      tagline: "Multilingual speech recognition tuned for accuracy at 4-bit precision.",
      languageCount: 14,
      isDefault: true,
    }),
    requiredFilePaths: [
      "config.json",
      "model.safetensors",
      "tokenizer.json",
      "tokenizer.model",
    ],
  },
  [WHISPER_ID]: {
    manifest: WHISPER_MANIFEST,
    info: makeInfo(WHISPER_MANIFEST, {
      tagline: "Broad multilingual speech recognition optimized at 4-bit precision.",
      languageCount: 99,
      isDefault: false,
    }),
    requiredFilePaths: [
      "config.json",
      "weights.safetensors",
      "multilingual.tiktoken",
    ],
  },
};

/** Ordered list of model ids (default first), for stable UI rendering. */
export const LOCAL_MODEL_IDS: string[] = [COHERE_ID, WHISPER_ID];

export function getModelEntry(modelId: string): LocalModelEntry | undefined {
  return LOCAL_MODELS[modelId];
}

export function isKnownModelId(modelId: string | null | undefined): boolean {
  return !!modelId && modelId in LOCAL_MODELS;
}

export function getModelFamily(modelId: string): LocalModelFamily | undefined {
  return LOCAL_MODELS[modelId]?.manifest.family;
}

export function listModelInfos(): LocalModelInfo[] {
  return LOCAL_MODEL_IDS.map((id) => LOCAL_MODELS[id].info);
}
