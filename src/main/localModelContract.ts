import type { LocalModelFamily } from "../types/shared";

export const LOCAL_MODEL_FAMILY: LocalModelFamily = "whisper";
export const LOCAL_MODEL_ID = "mlx-community/whisper-large-v3-turbo-4bit";
export const LOCAL_MODEL_DISPLAY_NAME = "Whisper large-v3 turbo 4-bit";
export const LOCAL_MODEL_MANIFEST_VERSION = 1;
export const LOCAL_MODEL_MANIFEST_URL =
  "https://download.spoke.so/models/whisper-large-v3-turbo-4bit/manifest.json";

export const LOCAL_MODEL_REQUIRED_FILE_PATHS = [
  "config.json",
  "model.safetensors",
  "multilingual.tiktoken",
] as const;
