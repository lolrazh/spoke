import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCapturedAudio } from "../capturedAudio";
import { TranscriptionSessionError } from "../sessionErrors";
import { localSttProvider } from "./localSttProvider";

describe("localSttProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "stt", {
      value: {
        getModelStatus: vi.fn(() =>
          Promise.resolve({
            state: "ready",
            family: "whisper",
            modelId: "test-model",
            displayName: "Test Model",
            version: "1.0.0",
            manifestVersion: 1,
            downloadProgress: 1,
            downloadedBytes: 1,
            totalBytes: 1,
            error: null,
          }),
        ),
        getModelInfos: vi.fn(() =>
          Promise.resolve([
            {
              modelId: "test-model",
              family: "whisper",
              displayName: "Test Model",
              tagline: "Test",
              languageCount: 1,
              quantization: "4-bit",
              totalBytes: 1,
              isDefault: true,
              streaming: false,
            },
          ]),
        ),
        transcribeLocal: vi.fn(() =>
          Promise.resolve({
            text: "local transcript",
            metrics: { inference_ms: 42 },
          }),
        ),
      },
      writable: true,
    });
  });

  it("transcribes PCM16 audio through the Electron bridge", async () => {
    const audio = createCapturedAudio(new Int16Array([1, 2, 3, 4]));

    const result = await localSttProvider.transcribe({
      audio,
      context: { mode: "dictation" },
      prepareResult: preparedLocalModel(),
    });

    expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
    expect(window.stt.transcribeLocal).toHaveBeenCalledWith(
      "test-model",
      expect.any(ArrayBuffer),
      undefined,
    );
    expect(result).toEqual({
      text: "local transcript",
      metrics: { inference_ms: 42 },
    });
  });

  it("pins the ready local model during preparation", async () => {
    await expect(
      localSttProvider.prepare?.({ context: { mode: "dictation" } }),
    ).resolves.toEqual(preparedLocalModel());
  });

  it("passes the context's sttPrompt through to the Electron bridge", async () => {
    const audio = createCapturedAudio(new Int16Array([1, 2, 3, 4]));
    const sttPrompt = "Your vocabulary includes: Spoke, Sandeep";

    await localSttProvider.transcribe({
      audio,
      context: { mode: "dictation", sttPrompt },
      prepareResult: preparedLocalModel(),
    });

    expect(window.stt.transcribeLocal).toHaveBeenCalledWith(
      "test-model",
      expect.any(ArrayBuffer),
      sttPrompt,
    );
  });

  it("passes partial PCM views without copying their backing buffer", async () => {
    const backing = new Int16Array([99, 1, 2, 88]);
    const audio = createCapturedAudio(backing.subarray(1, 3));

    await localSttProvider.transcribe({
      audio,
      context: { mode: "dictation" },
      prepareResult: preparedLocalModel(),
    });

    const pcmPayload = vi.mocked(window.stt.transcribeLocal).mock.calls[0][1];
    expect(pcmPayload).toBeInstanceOf(Uint8Array);
    if (!(pcmPayload instanceof Uint8Array)) {
      throw new Error("Expected a bounded Uint8Array PCM payload.");
    }
    expect(pcmPayload).toMatchObject({
      buffer: backing.buffer,
      byteOffset: backing.byteOffset + 2,
      byteLength: 4,
    });
    expect(
      Array.from(
        new Int16Array(
          pcmPayload.buffer,
          pcmPayload.byteOffset,
          pcmPayload.byteLength / 2,
        ),
      ),
    ).toEqual([1, 2]);
  });

  it("fails prepare with a clear message when the model is not installed", async () => {
    (window.stt.getModelStatus as any).mockResolvedValueOnce({
      state: "not_installed",
      family: null,
      modelId: null,
      displayName: null,
      version: null,
      manifestVersion: null,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
    });

    await expect(
      localSttProvider.prepare?.({
        context: { mode: "dictation" },
      }),
    ).rejects.toMatchObject({
      code: "model_not_installed",
      message: "Model unavailable. Open Settings to install.",
    });
  });

  it("throws a typed error when PCM audio is missing", async () => {
    await expect(
      localSttProvider.transcribe({
        context: { mode: "dictation" },
      } as any),
    ).rejects.toBeInstanceOf(TranscriptionSessionError);
  });
});

function preparedLocalModel() {
  return {
    localModel: {
      modelId: "test-model",
      family: "whisper" as const,
      streaming: false,
    },
  };
}
