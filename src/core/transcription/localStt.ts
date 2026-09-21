import { TranscriptionSessionError } from "./sessionErrors";
import type {
  PrepareTranscriptionResult,
  TranscribeAudioInput,
  TranscriptionResult,
} from "./sessionTypes";

/**
 * The local STT sidecar, reached through the preload bridge. `prepare` pins
 * the installed model for a dictation; `transcribe` sends one PCM16 clip to
 * that model.
 */
export const localStt = {
  prepare: async (): Promise<PrepareTranscriptionResult> => {
    if (!window.stt?.getModelStatus || !window.stt.getModelInfos) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Local model status is unavailable.",
        { recoverable: false },
      );
    }

    const [status, modelInfos] = await Promise.all([
      window.stt.getModelStatus(),
      window.stt.getModelInfos(),
    ]);
    if (status.state === "ready") {
      const info = modelInfos.find((model) => model.modelId === status.modelId);
      if (!status.modelId || !status.family || !info) {
        throw new TranscriptionSessionError(
          "provider_unavailable",
          "Local model metadata is unavailable.",
          { recoverable: false },
        );
      }
      return {
        localModel: {
          modelId: status.modelId,
          family: status.family,
          streaming: info.streaming,
          ...(info.streamingChunkMs
            ? { streamingChunkMs: info.streamingChunkMs }
            : {}),
        },
      };
    }

    const message =
      status.state === "downloading" || status.state === "installing"
        ? "Local model is still downloading. Try again when it finishes."
        : status.state === "broken"
          ? "Local model needs to be reinstalled from Models."
          : "Model unavailable. Open Settings to install.";

    throw new TranscriptionSessionError("model_not_installed", message, {
      details: { modelState: status.state },
    });
  },
  transcribe: async ({
    audio,
    context,
    prepareResult,
  }: TranscribeAudioInput): Promise<TranscriptionResult> => {
    if (!audio) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Local transcription requires PCM16 audio input.",
        { recoverable: false },
      );
    }

    if (!window.stt?.transcribeLocal) {
      throw new TranscriptionSessionError(
        "provider_unavailable",
        "Local transcription bridge is unavailable.",
        { recoverable: false },
      );
    }

    const modelId = prepareResult?.localModel?.modelId;
    if (!modelId) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Local transcription target is unavailable.",
        { recoverable: false },
      );
    }

    // The trimmed VAD output is normally a tight, exact-length Int16Array
    // (trimPcm16 -> Int16Array.prototype.slice), so its backing ArrayBuffer can
    // be handed to the bridge as-is. Chunked capture can instead provide a
    // bounded view over a larger backing buffer; pass that view directly so the
    // renderer does not copy the whole chunk before IPC.
    const { pcm16 } = audio;
    const isExact =
      pcm16.byteOffset === 0 && pcm16.byteLength === pcm16.buffer.byteLength;
    // Captured PCM is always backed by a plain ArrayBuffer (never a
    // SharedArrayBuffer), so this cast is safe.
    const pcmPayload = isExact
      ? (pcm16.buffer as ArrayBuffer)
      : new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);

    return window.stt.transcribeLocal(modelId, pcmPayload, context?.sttPrompt);
  },
};
