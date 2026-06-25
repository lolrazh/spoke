import type { LocalModelFamily, ModelManifest } from "../types/shared";

export const LOCAL_MODEL_FAMILY: LocalModelFamily = "whisper";
export const LOCAL_MODEL_ID = "spokedotso/whisper-large-v3-turbo-4bit";
export const LOCAL_MODEL_DISPLAY_NAME = "Whisper large-v3 turbo 4-bit";
export const LOCAL_MODEL_MANIFEST_VERSION = 1;
export const LOCAL_MODEL_VERSION = "7bf3b66db8320cbf31d31a9e8a9d4a453bc62f52";

export const LOCAL_MODEL_REQUIRED_FILE_PATHS = [
  "config.json",
  "weights.safetensors",
  "multilingual.tiktoken",
] as const;

const HF_RESOLVE_BASE_URL = `https://huggingface.co/${LOCAL_MODEL_ID}/resolve/${LOCAL_MODEL_VERSION}`;

export const LOCAL_MODEL_MANIFEST: ModelManifest = {
  manifestVersion: LOCAL_MODEL_MANIFEST_VERSION,
  family: LOCAL_MODEL_FAMILY,
  modelId: LOCAL_MODEL_ID,
  displayName: LOCAL_MODEL_DISPLAY_NAME,
  version: LOCAL_MODEL_VERSION,
  files: [
    {
      role: "config",
      path: "config.json",
      url: `${HF_RESOLVE_BASE_URL}/config.json`,
      sha256:
        "538e24557b8f9bc504700add5e7bbe32087c2353001ff563e64772ad4398671a",
      size: 341,
    },
    {
      role: "weights",
      path: "weights.safetensors",
      url: `${HF_RESOLVE_BASE_URL}/model.safetensors`,
      sha256:
        "e2d6146b49644c13ed7467060d3c43c402bbdfca1f01f1c21f6fbeda23b6567e",
      size: 463462982,
    },
    {
      role: "tokenizer",
      path: "multilingual.tiktoken",
      url: `${HF_RESOLVE_BASE_URL}/multilingual.tiktoken`,
      sha256:
        "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
      size: 816730,
    },
  ],
};
