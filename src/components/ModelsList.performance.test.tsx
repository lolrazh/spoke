import React, { act } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalModelInfo, ModelStatus } from "../types/shared";

const harness = vi.hoisted(() => ({
  cardRenders: 0,
  emitProgress: null as
    | ((payload: {
        modelId: string;
        progress: number;
        downloadedBytes: number;
        totalBytes: number;
      }) => void)
    | null,
}));

vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

vi.mock("./ModelInstallCard", async () => {
  const actual = await vi.importActual<typeof import("./ModelInstallCard")>(
    "./ModelInstallCard",
  );
  const CardWithRenderCount = React.memo((props: any) => {
    harness.cardRenders += 1;
    return React.createElement(actual.default, props);
  });
  return { default: CardWithRenderCount };
});

const modelInfos: LocalModelInfo[] = [
  {
    modelId: "model-a",
    family: "whisper",
    displayName: "Model A",
    tagline: "Test model A",
    languageCount: 1,
    quantization: "4-bit",
    totalBytes: 1000,
    isDefault: true,
    streaming: false,
  },
  {
    modelId: "model-b",
    family: "cohere",
    displayName: "Model B",
    tagline: "Test model B",
    languageCount: 2,
    quantization: "4-bit",
    totalBytes: 2000,
    isDefault: false,
    streaming: false,
  },
  {
    modelId: "model-c",
    family: "whisper",
    displayName: "Model C",
    tagline: "Test model C",
    languageCount: 3,
    quantization: "4-bit",
    totalBytes: 3000,
    isDefault: false,
    streaming: false,
  },
];

function createStatuses(): ModelStatus[] {
  return modelInfos.map((info) => ({
    state: "not_installed",
    family: info.family,
    modelId: info.modelId,
    displayName: info.displayName,
    version: null,
    manifestVersion: null,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: info.totalBytes,
    error: null,
  }));
}

describe("ModelsList progress rendering", () => {
  beforeEach(() => {
    harness.cardRenders = 0;
    harness.emitProgress = null;
    (window as any).stt = {
      getModelStatuses: vi.fn(async () => createStatuses()),
      getActiveModel: vi.fn(async () => "model-a"),
      getModelInfos: vi.fn(async () => modelInfos),
      onModelProgress: vi.fn((callback: typeof harness.emitProgress) => {
        harness.emitProgress = callback;
        return () => {
          harness.emitProgress = null;
        };
      }),
    };
  });

  it("coalesces a progress burst into one render of the changing card", async () => {
    const ModelsList = (await import("./ModelsList")).default;
    const { unmount } = render(<ModelsList />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(harness.emitProgress).not.toBeNull();
    harness.cardRenders = 0;

    await act(async () => {
      for (const progress of [0.1, 0.2, 0.3]) {
        harness.emitProgress?.({
          modelId: "model-b",
          progress,
          downloadedBytes: progress * 2000,
          totalBytes: 2000,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(harness.cardRenders).toBe(1);
    unmount();
  });
});
