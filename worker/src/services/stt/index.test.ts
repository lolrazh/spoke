import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIMPLISMART_STT_MODEL,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_PROVIDER,
} from "../../config";

vi.mock("./providers/groq", () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: "groq-text",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  }),
}));

vi.mock("./providers/simplismart", () => ({
  transcribeWav: vi.fn().mockResolvedValue({
    text: "simplismart-text",
    timings: { startAt: 3, headersAt: 6, bodyDoneAt: 9 },
  }),
}));

import { transcribeWav } from ".";
import { transcribeWav as groqTranscribe } from "./providers/groq";
import { transcribeWav as simplismartTranscribe } from "./providers/simplismart";

const groqMock = vi.mocked(groqTranscribe);
const simplismartMock = vi.mocked(simplismartTranscribe);

describe("services/stt index transcribeWav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to configured provider", async () => {
    const wav = new Uint8Array([0, 1]);
    const result = await transcribeWav(wav, { apiKey: "default-key" });

    if (STT_DEFAULT_PROVIDER === "groq") {
      expect(result.text).toBe("groq-text");
      expect(groqMock).toHaveBeenCalledTimes(1);
      expect(simplismartMock).not.toHaveBeenCalled();
      const [, , opts] = groqMock.mock.calls[0];
      expect(opts.model).toBe(STT_DEFAULT_MODEL);
      expect(opts.language).toBeTruthy();
    } else {
      expect(result.text).toBe("simplismart-text");
      expect(simplismartMock).toHaveBeenCalledTimes(1);
      expect(groqMock).not.toHaveBeenCalled();
      const [, , opts] = simplismartMock.mock.calls[0];
      expect(opts.model).toBe(SIMPLISMART_STT_MODEL);
      expect(opts.language).toBeTruthy();
    }
  });

  it("routes to simplismart provider when specified", async () => {
    const wav = new Uint8Array([2, 3]);
    const result = await transcribeWav(wav, {
      apiKey: "sm-key",
      provider: "simplismart",
    });

    expect(result.text).toBe("simplismart-text");
    expect(simplismartMock).toHaveBeenCalledTimes(1);
    expect(groqMock).not.toHaveBeenCalled();
    const [, , opts] = simplismartMock.mock.calls[0];
    expect(opts.model).toBe("whisper");
  });

  it("throws when apiKey missing", async () => {
    const wav = new Uint8Array([1]);
    await expect(
      transcribeWav(wav, { apiKey: "", provider: "groq" }),
    ).rejects.toThrow(/Missing API key/);
  });
});
