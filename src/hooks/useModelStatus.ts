import { useState, useEffect, useCallback } from "react";
import type { ModelStatus } from "../types/shared";

export function useModelStatus() {
  const [status, setStatus] = useState<ModelStatus>({
    state: "not_installed",
    modelId: null,
    version: null,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const s = await window.stt?.getModelStatus?.();
      if (s) setStatus(s);
    } catch {
      // ignore
    }
  }, []);

  // Load on mount + subscribe to progress events
  useEffect(() => {
    refresh();

    // Subscribe to download progress
    const unsubProgress = window.stt?.onModelProgress?.((payload) => {
      setStatus((prev) => ({
        ...prev,
        state: "downloading",
        downloadProgress: payload.progress,
        downloadedBytes: payload.downloadedBytes,
        totalBytes: payload.totalBytes,
      }));
    });

    // Poll on window focus to catch state changes
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubProgress?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const install = useCallback(async () => {
    try {
      setStatus((prev) => ({
        ...prev,
        state: "downloading",
        downloadProgress: 0,
        error: null,
      }));
      await window.stt?.installModel?.();
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Install failed";
      setStatus((prev) => ({
        ...prev,
        state: "broken",
        error: message,
      }));
    }
  }, [refresh]);

  const remove = useCallback(async () => {
    try {
      await window.stt?.removeModel?.();
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Remove failed";
      setStatus((prev) => ({
        ...prev,
        error: message,
      }));
    }
  }, [refresh]);

  return { status, install, remove, refresh };
}
