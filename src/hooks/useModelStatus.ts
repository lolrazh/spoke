import { useState, useEffect, useCallback, useRef } from "react";
import type { ModelStatus } from "../types/shared";

type UseModelStatusOptions = {
  enabled?: boolean;
};

function sameModelStatus(a: ModelStatus, b: ModelStatus): boolean {
  return (
    a.state === b.state &&
    a.family === b.family &&
    a.modelId === b.modelId &&
    a.displayName === b.displayName &&
    a.version === b.version &&
    a.manifestVersion === b.manifestVersion &&
    a.downloadProgress === b.downloadProgress &&
    a.downloadedBytes === b.downloadedBytes &&
    a.totalBytes === b.totalBytes &&
    a.error === b.error
  );
}

const DEFAULT_MODEL_STATUS: ModelStatus = {
  state: "not_installed",
  family: null,
  modelId: null,
  displayName: null,
  version: null,
  manifestVersion: null,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
};

export function useModelStatus(options: UseModelStatusOptions = {}) {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<ModelStatus>(DEFAULT_MODEL_STATUS);
  const statusRef = useRef(status);
  // False until the first real status arrives, so consumers can avoid
  // rendering a default ("not_installed") state before the truth is known.
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  const updateStatus = useCallback(
    (nextOrUpdater: ModelStatus | ((previous: ModelStatus) => ModelStatus)) => {
      const previous = statusRef.current;
      const next =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(previous)
          : nextOrUpdater;
      if (sameModelStatus(previous, next)) return;
      statusRef.current = next;
      setStatus(next);
    },
    [],
  );

  const markLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await window.stt?.getModelStatus?.();
      if (s) updateStatus(s);
    } catch {
      // ignore
    } finally {
      markLoaded();
    }
  }, [markLoaded, updateStatus]);

  // Load on mount + subscribe to progress events
  useEffect(() => {
    if (!enabled) return;

    refresh();

    // Poll on window focus to catch state changes
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, markLoaded, refresh]);

  const install = useCallback(async () => {
    try {
      updateStatus((prev) => ({
        ...prev,
        state: "downloading",
        downloadProgress: 0,
        error: null,
      }));
      await window.stt?.installModel?.();
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Install failed";
      updateStatus((prev) => ({
        ...prev,
        state: "broken",
        error: message,
      }));
    }
  }, [refresh, updateStatus]);

  const remove = useCallback(async () => {
    try {
      await window.stt?.removeModel?.();
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Remove failed";
      updateStatus((prev) => ({
        ...prev,
        error: message,
      }));
    }
  }, [refresh, updateStatus]);

  return { status, install, remove, refresh, loaded };
}
