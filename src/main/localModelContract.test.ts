import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_ID,
  LOCAL_MODEL_IDS,
  listModelInfos,
} from "./localModelContract";

const NEMOTRON_ID = "mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit";

describe("localModelContract", () => {
  it("lists Nemotron first and marks it as the only recommended model", () => {
    const infos = listModelInfos();

    expect(DEFAULT_MODEL_ID).toBe(NEMOTRON_ID);
    expect(LOCAL_MODEL_IDS[0]).toBe(NEMOTRON_ID);
    expect(infos[0]).toMatchObject({
      modelId: NEMOTRON_ID,
      quantization: "8-bit",
      isDefault: true,
      streaming: true,
      streamingChunkMs: 160,
    });
    expect(infos.filter((info) => info.isDefault)).toHaveLength(1);
  });
});
