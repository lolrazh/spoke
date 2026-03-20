import { getPrepareUrl, getTranscribeUrl } from "../../../config/api";
import type { TranscriptionProvider } from "../providerContracts";
import { SPOKE_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { TranscriptionSessionError } from "../sessionErrors";

const DEFAULT_QUOTA_LIMIT = 1000;

type LegacyPrepareResponse = {
  ocrWords?: string[];
  quotaInfo?: {
    wordsUsed?: number;
    quotaLimit?: number;
    subscriptionActive?: boolean;
  };
};

type LegacyTranscribeResponse = {
  error?: string;
  text?: string;
  wordCount?: number;
  metrics?: Record<string, unknown>;
};

async function parseJsonSafely<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

function requireAuthToken(authToken?: string | null): string {
  if (!authToken) {
    throw new TranscriptionSessionError(
      "permission_required",
      "Cloud transcription requires an auth token.",
      { recoverable: false },
    );
  }

  return authToken;
}

export const spokeCloudProvider: TranscriptionProvider = {
  descriptor: {
    id: SPOKE_CLOUD_PROVIDER_ID,
    displayName: "Spoke Cloud",
    kind: "cloud",
    requiresAuthToken: true,
    requiresApiKey: false,
  },
  prepare: async ({ authToken, screenshotBase64 }) => {
    const prepareRes = await fetch(getPrepareUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireAuthToken(authToken)}`,
      },
      body: JSON.stringify({
        screenshot: screenshotBase64 || undefined,
      }),
    });

    if (!prepareRes.ok) {
      if (prepareRes.status === 401) {
        return {
          authError: "auth_failed",
        };
      }

      if (prepareRes.status === 402) {
        return {
          authError: "payment_required",
        };
      }

      const errorData = await parseJsonSafely<{ error?: string }>(prepareRes);
      console.warn("[HTTP] Prepare failed:", errorData.error);
      return {};
    }

    const prepareData = await parseJsonSafely<LegacyPrepareResponse>(prepareRes);

    return {
      ocrWords: prepareData.ocrWords ?? [],
      quotaInfo: prepareData.quotaInfo
        ? {
            wordsUsed: prepareData.quotaInfo.wordsUsed ?? 0,
            quotaLimit: prepareData.quotaInfo.quotaLimit ?? DEFAULT_QUOTA_LIMIT,
            subscriptionActive:
              prepareData.quotaInfo.subscriptionActive ?? false,
          }
        : undefined,
    };
  },
  transcribe: async ({ authToken, audioBlob, context, prepareResult }) => {
    if (!audioBlob) {
      throw new TranscriptionSessionError(
        "transcription_failed",
        "Cloud transcription requires an audio blob.",
        { recoverable: false },
      );
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append(
      "metadata",
      JSON.stringify({
        mode: context.mode,
        ocrWords: prepareResult?.ocrWords ?? [],
        selection: context.selectionText || undefined,
        identity: context.identityName || undefined,
        language: context.language || "en",
      }),
    );

    const transcribeRes = await fetch(getTranscribeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireAuthToken(authToken)}`,
      },
      body: formData,
    });

    if (!transcribeRes.ok) {
      const errorData =
        await parseJsonSafely<LegacyTranscribeResponse>(transcribeRes);
      throw new TranscriptionSessionError(
        "transcription_failed",
        errorData.error || "Transcription failed",
        {
          details: { status: transcribeRes.status },
        },
      );
    }

    const result =
      await parseJsonSafely<LegacyTranscribeResponse>(transcribeRes);

    return {
      text: result.text ?? "",
      wordCount: result.wordCount,
      metrics: result.metrics,
    };
  },
};
