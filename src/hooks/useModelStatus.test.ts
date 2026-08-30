import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useModelStatus } from "./useModelStatus";

describe("useModelStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_installed as default state", async () => {
    const { result } = renderHook(() => useModelStatus());

    await waitFor(() => {
      expect(result.current.status.state).toBe("not_installed");
    });
  });

  it("provides the status refresh function", () => {
    const { result } = renderHook(() => useModelStatus());

    expect(typeof result.current.refresh).toBe("function");
  });

  it("calls getModelStatus on mount", async () => {
    renderHook(() => useModelStatus());

    await waitFor(() => {
      expect(window.stt.getModelStatus).toHaveBeenCalled();
    });
  });

  it("does not re-render when a refresh returns the same status", async () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useModelStatus();
    });

    await waitFor(() => {
      expect(result.current.status.modelId).toBe(
        "spokedotso/whisper-large-v3-turbo-4bit",
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    renderCount = 0;
    const beforeRefresh = result.current.status;

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe(beforeRefresh);
    expect(renderCount).toBe(0);
  });

});
