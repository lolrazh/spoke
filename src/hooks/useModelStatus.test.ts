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

  it("provides install and remove functions", () => {
    const { result } = renderHook(() => useModelStatus());

    expect(typeof result.current.install).toBe("function");
    expect(typeof result.current.remove).toBe("function");
    expect(typeof result.current.refresh).toBe("function");
  });

  it("calls getModelStatus on mount", async () => {
    renderHook(() => useModelStatus());

    await waitFor(() => {
      expect(window.stt.getModelStatus).toHaveBeenCalled();
    });
  });

  it("subscribes to model progress events on mount", () => {
    renderHook(() => useModelStatus());

    expect(window.stt.onModelProgress).toHaveBeenCalled();
  });

  it("can skip byte-level progress updates for readiness-only consumers", async () => {
    const { result } = renderHook(() => useModelStatus({ trackProgress: false }));

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
      expect(result.current.status.modelId).toBe(
        "spokedotso/whisper-large-v3-turbo-4bit",
      );
    });
    expect(window.stt.onModelProgress).not.toHaveBeenCalled();
  });

  it("does not re-render when a refresh returns the same status", async () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useModelStatus({ trackProgress: false });
    });

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
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

  it("calls installModel on the bridge when install is invoked", async () => {
    const { result } = renderHook(() => useModelStatus());

    await result.current.install();

    expect(window.stt.installModel).toHaveBeenCalled();
  });

  it("calls removeModel on the bridge when remove is invoked", async () => {
    const { result } = renderHook(() => useModelStatus());

    await result.current.remove();

    expect(window.stt.removeModel).toHaveBeenCalled();
  });

  it("sets error state when install fails", async () => {
    vi.mocked(window.stt.installModel).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const { result } = renderHook(() => useModelStatus());

    await result.current.install();

    await waitFor(() => {
      expect(result.current.status.state).toBe("broken");
      expect(result.current.status.error).toBe("Network error");
    });
  });

  it("sets error when remove fails", async () => {
    vi.mocked(window.stt.removeModel).mockRejectedValueOnce(
      new Error("Permission denied"),
    );

    const { result } = renderHook(() => useModelStatus());

    await result.current.remove();

    await waitFor(() => {
      expect(result.current.status.error).toBe("Permission denied");
    });
  });
});
