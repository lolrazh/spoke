/**
 * Provider Store
 *
 * Manages STT provider preferences, API key secrets, and provider settings
 * for the Electron main process. All state is file-backed and encrypted
 * where available via Electron's safeStorage.
 */

import * as fs from "fs";
import * as path from "path";
import { safeStorage } from "electron";
import {
  buildTranscriptionProviderSettingsSnapshot,
  isApiKeyTranscriptionProviderId,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
  type ApiKeyTranscriptionProviderId,
} from "../core/transcription/providerCatalog";
import { getModelInstallState } from "./modelManager";
import {
  getDefaultProviderPreferences,
  isLocalProviderSelected,
  LOCAL_STT_PROVIDER_ID,
  normalizeProviderPreferences,
  type PreferredTranscriptionProviderId,
} from "../core/transcription/providerPreferences";
import type {
  TranscriptionContext,
  TranscriptionResult,
} from "../core/transcription/sessionTypes";

// ── Feature flags ──────────────────────────────────────────────────────

/**
 * Cloud transcription providers were removed from the UI; the app is
 * local-only. While this flag is false, any previously-selected cloud
 * provider is coerced back to the local Whisper model at startup and the
 * cloud STT IPC transcribe path is gated off in main.ts. Flip this single
 * flag to re-enable the dormant cloud pipeline.
 */
export const CLOUD_STT_ENABLED = false;

// ── Types ──────────────────────────────────────────────────────────────

export type StoredProviderSecret = {
  storage: "safeStorage" | "plainText";
  value: string;
};

// ── Internal state ─────────────────────────────────────────────────────

let sttPrefsPath = "";
let sttSecretsPath = "";
let preferredProviderId: PreferredTranscriptionProviderId =
  LOCAL_STT_PROVIDER_ID;
let providerSecrets: Partial<
  Record<ApiKeyTranscriptionProviderId, StoredProviderSecret>
> = {};

// ── Initialization ─────────────────────────────────────────────────────

export function initProviderStore(userDataDir: string): void {
  sttPrefsPath = path.join(userDataDir, "stt-preferences.json");
  sttSecretsPath = path.join(userDataDir, "stt-provider-secrets.json");

  const prefs = loadSttPreferences();
  providerSecrets = loadProviderSecrets();
  preferredProviderId = prefs.preferredProviderId;
  // While cloud STT is disabled, coerce any previously-selected cloud
  // provider back to the local Whisper model so a stale preference can't
  // linger at runtime (see CLOUD_STT_ENABLED above).
  if (!CLOUD_STT_ENABLED && preferredProviderId !== LOCAL_STT_PROVIDER_ID) {
    preferredProviderId = LOCAL_STT_PROVIDER_ID;
  }
}

// ── Preferences ────────────────────────────────────────────────────────

function loadSttPreferences() {
  try {
    if (fs.existsSync(sttPrefsPath)) {
      const data = fs.readFileSync(sttPrefsPath, "utf8");
      return normalizeProviderPreferences(JSON.parse(data));
    }
  } catch (error) {
    console.error("[STTPrefs] Failed to load preferences:", error);
  }
  return getDefaultProviderPreferences();
}

function saveSttPreferences(prefs: {
  preferredProviderId: PreferredTranscriptionProviderId;
}): void {
  try {
    const dir = path.dirname(sttPrefsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(sttPrefsPath, JSON.stringify(prefs, null, 2));
    console.log("[STTPrefs] Saved preferences:", prefs);
  } catch (error) {
    console.error("[STTPrefs] Failed to save preferences:", error);
  }
}

export function getPreferredProviderId(): PreferredTranscriptionProviderId {
  return preferredProviderId;
}

export function setPreferredProviderId(
  providerId: PreferredTranscriptionProviderId,
): void {
  preferredProviderId = providerId;
  saveSttPreferences({ preferredProviderId });
}

export function isPreferredProviderLocal(): boolean {
  return isLocalProviderSelected(preferredProviderId);
}

// ── Secrets ────────────────────────────────────────────────────────────

function loadProviderSecrets(): Partial<
  Record<ApiKeyTranscriptionProviderId, StoredProviderSecret>
> {
  try {
    if (fs.existsSync(sttSecretsPath)) {
      const data = fs.readFileSync(sttSecretsPath, "utf8");
      const parsed = JSON.parse(data) as Record<string, StoredProviderSecret>;

      return Object.fromEntries(
        Object.entries(parsed).filter(([providerId, secret]) => {
          return (
            isApiKeyTranscriptionProviderId(providerId) &&
            secret &&
            typeof secret === "object" &&
            typeof secret.storage === "string" &&
            typeof secret.value === "string"
          );
        }),
      ) as Partial<Record<ApiKeyTranscriptionProviderId, StoredProviderSecret>>;
    }
  } catch (error) {
    console.error("[STTSecrets] Failed to load provider secrets:", error);
  }

  return {};
}

function saveProviderSecrets(
  secrets: Partial<Record<ApiKeyTranscriptionProviderId, StoredProviderSecret>>,
): void {
  try {
    const dir = path.dirname(sttSecretsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(sttSecretsPath, JSON.stringify(secrets, null, 2));
  } catch (error) {
    console.error("[STTSecrets] Failed to save provider secrets:", error);
  }
}

export function encodeProviderSecret(apiKey: string): StoredProviderSecret {
  // Never write secrets to disk in plaintext. Legacy "plainText" entries can
  // still be READ (see decodeProviderSecret) so existing users aren't locked
  // out, and are opportunistically re-encrypted once safeStorage is available.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage unavailable; API key not saved.");
  }

  return {
    storage: "safeStorage",
    value: safeStorage.encryptString(apiKey).toString("base64"),
  };
}

export function decodeProviderSecret(secret: StoredProviderSecret): string {
  if (secret.storage === "safeStorage") {
    return safeStorage.decryptString(Buffer.from(secret.value, "base64"));
  }

  return secret.value;
}

/**
 * If a legacy plaintext secret is on disk and encryption is now available,
 * transparently re-encrypt it with safeStorage and persist the upgrade.
 */
function maybeReencryptLegacySecret(
  providerId: ApiKeyTranscriptionProviderId,
  secret: StoredProviderSecret,
): void {
  if (secret.storage !== "plainText" || !safeStorage.isEncryptionAvailable()) {
    return;
  }

  try {
    providerSecrets = {
      ...providerSecrets,
      [providerId]: encodeProviderSecret(secret.value),
    };
    saveProviderSecrets(providerSecrets);
    console.log(
      `[STTSecrets] Re-encrypted legacy plaintext API key for '${providerId}'.`,
    );
  } catch (error) {
    console.error(
      "[STTSecrets] Failed to re-encrypt legacy plaintext secret:",
      error,
    );
  }
}

export function hasProviderApiKey(
  providerId: ApiKeyTranscriptionProviderId,
): boolean {
  const secret = providerSecrets[providerId];
  if (!secret) {
    return false;
  }

  try {
    const hasKey = decodeProviderSecret(secret).trim().length > 0;
    if (hasKey) {
      maybeReencryptLegacySecret(providerId, secret);
    }
    return hasKey;
  } catch (error) {
    console.error("[STTSecrets] Failed to decode provider secret:", error);
    return false;
  }
}

export function getRequiredProviderApiKey(
  providerId: ApiKeyTranscriptionProviderId,
): string {
  const secret = providerSecrets[providerId];
  if (!secret) {
    throw new Error(`No API key configured for provider '${providerId}'.`);
  }

  const apiKey = decodeProviderSecret(secret).trim();
  if (!apiKey) {
    throw new Error(`No API key configured for provider '${providerId}'.`);
  }

  maybeReencryptLegacySecret(providerId, secret);

  return apiKey;
}

export function setProviderApiKey(
  providerId: ApiKeyTranscriptionProviderId,
  apiKey: string,
): void {
  providerSecrets = {
    ...providerSecrets,
    [providerId]: encodeProviderSecret(apiKey),
  };
  saveProviderSecrets(providerSecrets);
}

export function clearProviderApiKey(
  providerId: ApiKeyTranscriptionProviderId,
): void {
  const nextSecrets = { ...providerSecrets };
  delete nextSecrets[providerId];
  providerSecrets = nextSecrets;
  saveProviderSecrets(providerSecrets);
}

// ── Settings Snapshot ──────────────────────────────────────────────────

export function getProviderSettingsSnapshot() {
  const configuredApiKeyProviderIds = (
    [
      OPENAI_CLOUD_PROVIDER_ID,
      GROQ_CLOUD_PROVIDER_ID,
      DEEPGRAM_CLOUD_PROVIDER_ID,
    ] as ApiKeyTranscriptionProviderId[]
  ).filter((id) => hasProviderApiKey(id));

  return buildTranscriptionProviderSettingsSnapshot({
    preferredProviderId,
    configuredApiKeyProviderIds,
    localModelInstalled: getModelInstallState() === "ready",
  });
}

// ── OpenAI Transcription ───────────────────────────────────────────────

const OPENAI_TRANSCRIPTION_API_URL =
  "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const OPENAI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

type OpenAiTranscriptionResponse = {
  text?: string;
  usage?: Record<string, unknown>;
  error?: {
    message?: string;
  };
};

export async function transcribeWithOpenAi(
  audioBuffer: Buffer,
  mimeType: string | undefined,
  context: TranscriptionContext,
): Promise<TranscriptionResult> {
  if (audioBuffer.byteLength > OPENAI_MAX_AUDIO_BYTES) {
    throw new Error("OpenAI supports audio files up to 25 MiB.");
  }

  const formData = new FormData();
  const resolvedMimeType = normalizeAudioMimeType(mimeType);
  formData.append(
    "file",
    new Blob([bufferToArrayBuffer(audioBuffer)], {
      type: resolvedMimeType,
    }),
    getAudioFileName(resolvedMimeType),
  );
  formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");

  if (context.language) {
    formData.append("language", context.language);
  }

  const response = await fetch(OPENAI_TRANSCRIPTION_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getRequiredProviderApiKey(OPENAI_CLOUD_PROVIDER_ID)}`,
    },
    body: formData,
  });

  const result = (await response
    .json()
    .catch(() => ({}))) as OpenAiTranscriptionResponse;

  if (!response.ok) {
    throw new Error(result.error?.message || "OpenAI transcription failed.");
  }

  return {
    text: result.text ?? "",
    metrics: {
      model: OPENAI_TRANSCRIPTION_MODEL,
      usage: result.usage,
    },
  };
}

// ── Groq Direct Transcription ─────────────────────────────────────────

const GROQ_TRANSCRIPTION_API_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const GROQ_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

type GroqTranscriptionResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

export async function transcribeWithGroq(
  audioBuffer: Buffer,
  mimeType: string | undefined,
  context: TranscriptionContext,
): Promise<TranscriptionResult> {
  if (audioBuffer.byteLength > GROQ_MAX_AUDIO_BYTES) {
    throw new Error("Groq supports audio files up to 25 MiB.");
  }

  const formData = new FormData();
  const resolvedMimeType = normalizeAudioMimeType(mimeType);
  formData.append(
    "file",
    new Blob([bufferToArrayBuffer(audioBuffer)], {
      type: resolvedMimeType,
    }),
    getAudioFileName(resolvedMimeType),
  );
  formData.append("model", GROQ_TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");

  if (context.language) {
    formData.append("language", context.language);
  }

  const response = await fetch(GROQ_TRANSCRIPTION_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getRequiredProviderApiKey(GROQ_CLOUD_PROVIDER_ID)}`,
    },
    body: formData,
  });

  const result = (await response
    .json()
    .catch(() => ({}))) as GroqTranscriptionResponse;

  if (!response.ok) {
    throw new Error(result.error?.message || "Groq transcription failed.");
  }

  return {
    text: result.text ?? "",
    metrics: {
      model: GROQ_TRANSCRIPTION_MODEL,
    },
  };
}

// ── Deepgram Direct Transcription ─────────────────────────────────────

const DEEPGRAM_TRANSCRIPTION_API_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = "nova-3";
const DEEPGRAM_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

type DeepgramTranscriptionResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
  error?: string;
};

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function normalizeAudioMimeType(mimeType: string | undefined): string {
  return mimeType || "audio/wav";
}

function getAudioFileName(mimeType: string): string {
  if (mimeType === "audio/wav" || mimeType === "audio/wave") {
    return "audio.wav";
  }
  if (mimeType === "audio/mpeg") {
    return "audio.mp3";
  }
  if (mimeType === "audio/mp4") {
    return "audio.mp4";
  }
  return "audio.webm";
}

export async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  mimeType: string | undefined,
  context: TranscriptionContext,
): Promise<TranscriptionResult> {
  if (audioBuffer.byteLength > DEEPGRAM_MAX_AUDIO_BYTES) {
    throw new Error("Deepgram supports audio files up to 25 MiB.");
  }

  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    smart_format: "true",
    punctuate: "true",
  });
  if (context.language) {
    params.set("language", context.language);
  }

  const response = await fetch(
    `${DEEPGRAM_TRANSCRIPTION_API_URL}?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${getRequiredProviderApiKey(DEEPGRAM_CLOUD_PROVIDER_ID)}`,
        "Content-Type": normalizeAudioMimeType(mimeType),
      },
      body: bufferToArrayBuffer(audioBuffer),
    },
  );

  const result = (await response
    .json()
    .catch(() => ({}))) as DeepgramTranscriptionResponse;

  if (!response.ok) {
    throw new Error(result.error || "Deepgram transcription failed.");
  }

  const transcript =
    result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

  return {
    text: transcript,
    metrics: {
      model: DEEPGRAM_MODEL,
    },
  };
}
