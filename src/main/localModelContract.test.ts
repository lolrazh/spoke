import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_ID,
  LOCAL_MODEL_IDS,
  listModelInfos,
  resolveLocalModelId,
} from "./localModelContract";

const PARAKEET_ID = "spokedotso/parakeet-tdt-0.6b-v2-mlx-6bit";
const NEMOTRON_ID = "spokedotso/nemotron-3.5-asr-streaming-0.6b-8bit";
const LEGACY_NEMOTRON_ID =
  "mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit";

describe("localModelContract", () => {
  it("lists Parakeet first and marks it as the only recommended model", () => {
    const infos = listModelInfos();

    expect(DEFAULT_MODEL_ID).toBe(PARAKEET_ID);
    expect(LOCAL_MODEL_IDS[0]).toBe(PARAKEET_ID);
    expect(infos[0]).toMatchObject({
      modelId: PARAKEET_ID,
      quantization: "6-bit",
      isDefault: true,
      streaming: false,
    });
    expect(infos[1]).toMatchObject({
      modelId: NEMOTRON_ID,
      isDefault: false,
    });
    expect(infos.filter((info) => info.isDefault)).toHaveLength(1);
  });

  it("resolves the previous Nemotron repository ID to the canonical model", () => {
    expect(resolveLocalModelId(LEGACY_NEMOTRON_ID)).toBe(NEMOTRON_ID);
    expect(resolveLocalModelId(NEMOTRON_ID)).toBe(NEMOTRON_ID);
  });
});
