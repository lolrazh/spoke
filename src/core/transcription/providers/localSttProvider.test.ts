import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionSessionError } from "../sessionErrors";
import { localSttProvider } from "./localSttProvider";

describe("localSttProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "stt", {
      value: {
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
    const result = await localSttProvider.transcribe({
      pcm16: new Int16Array([1, 2, 3, 4]),
      context: { mode: "dictation" },
    });

    expect(window.stt.transcribeLocal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      text: "local transcript",
      metrics: { inference_ms: 42 },
    });
  });

  it("throws a typed error when PCM audio is missing", async () => {
    await expect(
      localSttProvider.transcribe({
        context: { mode: "dictation" },
      }),
    ).rejects.toBeInstanceOf(TranscriptionSessionError);
  });
});
