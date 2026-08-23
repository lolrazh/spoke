/**
 * STT IPC
 *
 * Local Whisper/model-manager handlers, enhancement + OCR, and the
 * transcription-provider handlers (including the CLOUD_STT_ENABLED-gated
 * API-key-provider paths, which are dormant while cloud STT is disabled).
 */

import { ipcMain } from "electron";
import { randomUUID } from "crypto";

import {
  isApiKeyTranscriptionProviderId,
  isSelectableTranscriptionProviderId,
  OPENAI_CLOUD_PROVIDER_ID,
  GROQ_CLOUD_PROVIDER_ID,
  DEEPGRAM_CLOUD_PROVIDER_ID,
} from "../../core/transcription/providerCatalog";
import {
  LOCAL_STT_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "../../core/transcription/providerPreferences";
import type { TranscriptionContext } from "../../core/transcription/sessionTypes";
import {
  CLOUD_STT_ENABLED,
  getPreferredProviderId,
  setPreferredProviderId,
  hasProviderApiKey,
  setProviderApiKey,
  clearProviderApiKey,
  getProviderSettingsSnapshot,
  transcribeWithOpenAi,
  transcribeWithGroq,
  transcribeWithDeepgram,
} from "../providerStore";
import { enhance } from "../enhanceService";
import { extractOcrWords } from "../ocrService";
import { resolveEnhancementProvider } from "../llmService";
import {
  installLocalModelAndSyncSidecar,
  prewarmLocalSidecar,
  removeLocalModelAndStopSidecar,
  setActiveModelAndResync,
  syncLocalSidecarForCurrentProvider,
  transcribeWithLocalSidecar,
  abortLocalSidecarTranscription,
  beginLocalStreamingSession,
} from "../localSttLifecycle";
import {
  getModelStatus,
  getAllModelStatuses,
  getActiveModelId,
  cancelInstall,
} from "../modelManager";
import { listModelInfos } from "../localModelContract";
import { scheduleLocalSidecarPrewarm } from "../windows";
import { LocalStreamIpcController } from "./localStreamIpcController";

const localStreams = new LocalStreamIpcController(
  beginLocalStreamingSession,
  abortLocalSidecarTranscription,
  randomUUID,
);

export function registerSttIpc(): void {
  // ============ Local Whisper IPC handlers ============

  ipcMain.handle("stt:get-model-status", () => {
    return getModelStatus();
  });

  ipcMain.handle("stt:get-model-statuses", () => {
    return getAllModelStatuses();
  });

  ipcMain.handle("stt:get-active-model", () => {
    return getActiveModelId();
  });

  ipcMain.handle("stt:get-model-infos", () => {
    return listModelInfos();
  });

  ipcMain.handle("stt:set-active-model", async (_event, modelId: string) => {
    await setActiveModelAndResync(modelId);
  });

  ipcMain.handle("stt:prewarm-local", () => {
    prewarmLocalSidecar("renderer");
    return { ok: true };
  });

  ipcMain.handle("stt:install-model", async (_event, modelId?: string) => {
    await installLocalModelAndSyncSidecar(modelId);
    scheduleLocalSidecarPrewarm("model-install", 250);
  });

  ipcMain.handle("stt:remove-model", async (_event, modelId?: string) => {
    await removeLocalModelAndStopSidecar(modelId);
  });

  ipcMain.handle("stt:cancel-install", (_event, modelId?: string) =>
    cancelInstall(modelId),
  );

  // ============ Enhancement + OCR IPC handlers ============

  ipcMain.handle(
    "stt:enhance",
    async (
      _event,
      payload: {
        text: string;
        vocabulary?: string[];
        mode?: "dictation" | "edit";
        selectionText?: string;
      },
    ) => {
      return enhance(payload.text, {
        vocabulary: payload.vocabulary,
        mode: payload.mode,
        selectionText: payload.selectionText,
      });
    },
  );

  ipcMain.handle("stt:cancel-local-transcription", () => {
    localStreams.cancel();
  });

  ipcMain.handle("stt:start-local-stream", (event, modelId: string) =>
    localStreams.start(event.sender, modelId),
  );

  ipcMain.handle(
    "stt:push-local-stream",
    async (event, sessionId: string, pcmBytes: Uint8Array) => {
      await localStreams.push(event.sender, sessionId, pcmBytes);
    },
  );

  ipcMain.handle("stt:finish-local-stream", (event, sessionId: string) =>
    localStreams.finish(event.sender, sessionId),
  );

  ipcMain.handle("stt:extract-ocr", async (_event, imageBase64: string) => {
    const providerId = resolveEnhancementProvider(getPreferredProviderId());
    if (!providerId) {
      return { words: [] };
    }
    return extractOcrWords(imageBase64, providerId);
  });

  ipcMain.handle(
    "stt:transcribe-local",
    async (
      _event,
      modelId: string,
      pcmBuffer: Uint8Array,
      prompt?: string,
    ) => {
      try {
        // Wrap the transferred bytes in place instead of copying them: the
        // sidecar only reads this buffer, and the Uint8Array isn't reused after
        // this handler returns.
        return await transcribeWithLocalSidecar(
          modelId,
          Buffer.from(
            pcmBuffer.buffer,
            pcmBuffer.byteOffset,
            pcmBuffer.byteLength,
          ),
          prompt,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[STT] transcribe-local failed:", msg);
        throw err;
      }
    },
  );

  ipcMain.handle("stt:get-preferred-provider", () => {
    return getPreferredProviderId();
  });

  ipcMain.handle("stt:get-provider-settings", () => {
    return getProviderSettingsSnapshot();
  });

  ipcMain.handle(
    "stt:set-preferred-provider",
    async (_event, providerId: PreferredTranscriptionProviderId) => {
      if (!isSelectableTranscriptionProviderId(providerId)) {
        throw new Error(`Unknown transcription provider '${providerId}'.`);
      }

      // While cloud STT is disabled, only the local provider may be selected
      // (mirrors the startup coercion in providerStore.initProviderStore).
      if (!CLOUD_STT_ENABLED && providerId !== LOCAL_STT_PROVIDER_ID) {
        throw new Error("Cloud transcription is disabled");
      }

      if (
        isApiKeyTranscriptionProviderId(providerId) &&
        !hasProviderApiKey(providerId)
      ) {
        throw new Error(`Save an API key before selecting this provider.`);
      }

      setPreferredProviderId(providerId);
      await syncLocalSidecarForCurrentProvider();
      scheduleLocalSidecarPrewarm("provider-switch", 250);
    },
  );

  ipcMain.handle(
    "stt:transcribe-api-key-provider",
    async (
      _event,
      payload: {
        providerId: string;
        audioBuffer: Uint8Array;
        mimeType?: string;
        context: TranscriptionContext;
      },
    ) => {
      // Cloud STT is dormant: the provider store coerces the preference to
      // local, so no legitimate caller reaches this path. Gate it off rather
      // than leaving live IPC attack surface that ships audio to the cloud.
      if (!CLOUD_STT_ENABLED) {
        return { ok: false, error: "Cloud transcription is disabled" };
      }

      if (!isApiKeyTranscriptionProviderId(payload.providerId)) {
        throw new Error(
          `Provider '${payload.providerId}' does not support direct API-key transcription.`,
        );
      }

      const audioBuffer = Buffer.from(payload.audioBuffer);

      if (payload.providerId === OPENAI_CLOUD_PROVIDER_ID) {
        return transcribeWithOpenAi(
          audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      if (payload.providerId === GROQ_CLOUD_PROVIDER_ID) {
        return transcribeWithGroq(
          audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      if (payload.providerId === DEEPGRAM_CLOUD_PROVIDER_ID) {
        return transcribeWithDeepgram(
          audioBuffer,
          payload.mimeType,
          payload.context,
        );
      }

      throw new Error(
        `Provider '${payload.providerId}' does not have a transcription handler.`,
      );
    },
  );

  ipcMain.handle(
    "stt:set-provider-api-key",
    (_event, payload: { providerId: string; apiKey: string }) => {
      if (!isApiKeyTranscriptionProviderId(payload.providerId)) {
        throw new Error(
          `Provider '${payload.providerId}' does not accept a stored API key.`,
        );
      }

      const apiKey = payload.apiKey.trim();
      if (!apiKey) {
        throw new Error("API key cannot be empty.");
      }

      setProviderApiKey(payload.providerId, apiKey);

      return getProviderSettingsSnapshot();
    },
  );

  ipcMain.handle("stt:clear-provider-api-key", (_event, providerId: string) => {
    if (!isApiKeyTranscriptionProviderId(providerId)) {
      throw new Error(
        `Provider '${providerId}' does not accept a stored API key.`,
      );
    }

    if (getPreferredProviderId() === providerId) {
      throw new Error(
        "Switch transcription providers before clearing the active provider's API key.",
      );
    }

    clearProviderApiKey(providerId);

    return getProviderSettingsSnapshot();
  });
}
