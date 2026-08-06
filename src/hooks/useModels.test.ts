import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalModelInfo, ModelStatus } from "../types/shared";
import { useModels } from "./useModels";

const infos: LocalModelInfo[] = [
  {
    modelId: "model-a",
    family: "whisper",
    displayName: "Model A",
    tagline: "A",
    languageCount: 1,
    quantization: "4-bit",
    totalBytes: 1,
    isDefault: true,
  },
  {
    modelId: "model-b",
    family: "parakeet",
    displayName: "Model B",
    tagline: "B",
    languageCount: 1,
    quantization: "4-bit",
    totalBytes: 1,
    isDefault: false,
  },
];

const statuses: ModelStatus[] = infos.map((info) => ({
  state: "ready",
  family: info.family,
  modelId: info.modelId,
  displayName: info.displayName,
  version: "test",
  manifestVersion: 1,
  downloadProgress: 1,
  downloadedBytes: 1,
  totalBytes: 1,
  error: null,
}));

describe("useModels", () => {
  beforeEach(() => {
    Object.assign(window.stt, {
      getModelInfos: vi.fn().mockResolvedValue(infos),
      getModelStatuses: vi.fn().mockResolvedValue(statuses),
      getActiveModel: vi.fn().mockResolvedValue("model-a"),
      setActiveModel: vi.fn().mockResolvedValue(undefined),
      onModelProgress: vi.fn(() => () => undefined),
    });
  });

  it("keeps the old model active and blocks duplicate switches until readiness", async () => {
    let active = "model-a";
    let releaseSwitch: () => void = () => undefined;
    const switchGate = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    vi.mocked(window.stt.getActiveModel).mockImplementation(async () => active);
    vi.mocked(window.stt.setActiveModel).mockImplementation(async (modelId) => {
      await switchGate;
      active = modelId;
    });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let switching: Promise<void> = Promise.resolve();
    act(() => {
      switching = result.current.setActive("model-b");
    });

    expect(result.current.activeModelId).toBe("model-a");
    expect(result.current.activatingModelId).toBe("model-b");
    await result.current.setActive("model-a");
    expect(window.stt.setActiveModel).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseSwitch();
      await switching;
    });

    expect(result.current.activeModelId).toBe("model-b");
    expect(result.current.activatingModelId).toBeNull();
  });
});
