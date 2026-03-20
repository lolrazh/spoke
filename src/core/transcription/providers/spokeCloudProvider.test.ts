import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionSessionError } from "../sessionErrors";
import { spokeCloudProvider } from "./spokeCloudProvider";

vi.mock("../../../config/api", () => ({
  getPrepareUrl: () => "http://test/prepare",
  getTranscribeUrl: () => "http://test/transcribe",
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("spokeCloudProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("maps auth failures from /prepare into session auth errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const result = await spokeCloudProvider.prepare({
      authToken: "test-token",
      screenshotBase64: "base64-image",
      context: { mode: "dictation" },
    });

    expect(result).toEqual({ authError: "auth_failed" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test/prepare",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("normalizes quota info from /prepare", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ocrWords: ["hello", "world"],
          quotaInfo: {
            wordsUsed: 32,
            subscriptionActive: false,
          },
        }),
    });

    const result = await spokeCloudProvider.prepare({
      authToken: "test-token",
      context: { mode: "dictation" },
    });

    expect(result).toEqual({
      ocrWords: ["hello", "world"],
      quotaInfo: {
        wordsUsed: 32,
        quotaLimit: 1000,
        subscriptionActive: false,
      },
    });
  });

  it("sends transcription metadata and returns the response payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: "cloud transcript",
          wordCount: 2,
          metrics: { latency_ms: 100 },
        }),
    });

    const audioBlob = new Blob(["audio"], { type: "audio/webm" });
    const result = await spokeCloudProvider.transcribe({
      authToken: "test-token",
      audioBlob,
      context: {
        mode: "edit",
        identityName: "Test User",
        selectionText: "hello",
      },
      prepareResult: {
        ocrWords: ["screen", "context"],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://test/transcribe",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
        },
      }),
    );
    const [, requestInit] = mockFetch.mock.calls[0];
    const metadataEntry = (requestInit.body as FormData).get("metadata");
    const metadata =
      typeof metadataEntry === "string" ? JSON.parse(metadataEntry) : null;

    expect(metadata).toEqual({
      mode: "edit",
      ocrWords: ["screen", "context"],
      selection: "hello",
      identity: "Test User",
      language: "en",
    });
    expect(result).toEqual({
      text: "cloud transcript",
      wordCount: 2,
      metrics: { latency_ms: 100 },
    });
  });

  it("throws a typed error when /transcribe fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });

    await expect(
      spokeCloudProvider.transcribe({
        authToken: "test-token",
        audioBlob: new Blob(["audio"], { type: "audio/webm" }),
        context: { mode: "dictation" },
      }),
    ).rejects.toBeInstanceOf(TranscriptionSessionError);
  });
});
