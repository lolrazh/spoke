import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturedAudio } from "../capturedAudio";
import { TranscriptionSessionError } from "../sessionErrors";
import { OPENAI_CLOUD_PROVIDER_ID } from "../providerPreferences";
import { openAiCloudProvider } from "./openAiCloudProvider";

describe("openAiCloudProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "stt", {
      value: {
        getProviderSettings: vi.fn(() =>
          Promise.resolve({
            preferredProviderId: "local-stt",
            providers: [
              {
                id: OPENAI_CLOUD_PROVIDER_ID,
                displayName: "OpenAI",
                description: "Cloud transcription with your OpenAI API key.",
                kind: "cloud",
                selectable: true,
                requiresApiKey: true,
                status: "ready",
                apiKeyConfigured: true,
              },
            ],
          }),
        ),
        transcribeApiKeyProvider: vi.fn(() =>
          Promise.resolve({
            text: "openai transcript",
            metrics: { provider: OPENAI_CLOUD_PROVIDER_ID },
          }),
        ),
      },
      writable: true,
    });
  });

  it("reports availability from provider settings", async () => {
    await expect(openAiCloudProvider.getAvailability?.()).resolves.toEqual({
      configured: true,
      available: true,
      reason: undefined,
    });
  });

  it("delegates transcription through the secure bridge", async () => {
    const audio = createCapturedAudio(new Int16Array([1, 2, 3, 4]));

    const result = await openAiCloudProvider.transcribe({
      audio,
      context: {
        mode: "dictation",
        language: "en",
      },
    });

    expect(window.stt.transcribeApiKeyProvider).toHaveBeenCalledWith(
      OPENAI_CLOUD_PROVIDER_ID,
      expect.objectContaining({
        mimeType: "audio/wav",
        context: {
          mode: "dictation",
          language: "en",
        },
      }),
    );
    const payload = (window.stt.transcribeApiKeyProvider as any).mock
      .calls[0][1];
    expect(new DataView(payload.audioBuffer).getUint32(0, false)).toBe(
      0x52494646,
    );
    expect(result).toEqual({
      text: "openai transcript",
      metrics: { provider: OPENAI_CLOUD_PROVIDER_ID },
    });
  });

  it("throws a typed error when the audio blob is missing", async () => {
    await expect(
      openAiCloudProvider.transcribe({
        context: { mode: "dictation" },
      } as any),
    ).rejects.toBeInstanceOf(TranscriptionSessionError);
  });
});
