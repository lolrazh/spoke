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
    streaming: false,
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
    streaming: false,
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

  it("shows each selection immediately and allows a newer switch", async () => {
    const pending = new Map<
      string,
      { resolve: () => void; promise: Promise<void> }
    >();
    vi.mocked(window.stt.setActiveModel).mockImplementation((modelId) => {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      pending.set(modelId, { resolve, promise });
      return promise;
    });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.setActive("model-b");
    });
    expect(result.current.activeModelId).toBe("model-b");

    let second: Promise<void> = Promise.resolve();
    act(() => {
      second = result.current.setActive("model-a");
    });
    expect(result.current.activeModelId).toBe("model-a");
    expect(window.stt.setActiveModel).toHaveBeenNthCalledWith(1, "model-b");
    expect(window.stt.setActiveModel).toHaveBeenNthCalledWith(2, "model-a");

    await act(async () => {
      pending.get("model-b")?.resolve();
      pending.get("model-a")?.resolve();
      await Promise.all([first, second]);
    });

    expect(result.current.activeModelId).toBe("model-a");
  });

  it("reconciles the latest failed selection with the main process", async () => {
    vi.mocked(window.stt.setActiveModel).mockRejectedValue(
      new Error("not installed"),
    );

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let switching: Promise<void> = Promise.resolve();
    act(() => {
      switching = result.current.setActive("model-b");
    });
    expect(result.current.activeModelId).toBe("model-b");

    await act(async () => {
      await switching;
    });

    expect(result.current.activeModelId).toBe("model-a");
  });

  it("does not let an older failure overwrite a newer selection", async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    const firstRequest = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(window.stt.setActiveModel)
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.setActive("model-b");
      second = result.current.setActive("model-a");
    });
    expect(result.current.activeModelId).toBe("model-a");

    await act(async () => {
      rejectFirst(new Error("stale failure"));
      await Promise.all([first, second]);
    });

    expect(result.current.activeModelId).toBe("model-a");
    expect(window.stt.getActiveModel).toHaveBeenCalledTimes(1);
  });

  it("does not re-render or rebuild rows for an unchanged refresh", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useModels();
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const rows = result.current.rows;
    const rendersAfterInitialLoad = renders;

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.rows).toBe(rows);
    expect(renders).toBe(rendersAfterInitialLoad);
  });
});
