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

  const refresh = useCallback(async () => {
    try {
      const s = await window.stt?.getModelStatus?.();
      if (s) updateStatus(s);
    } catch {
      // ignore
    }
  }, [updateStatus]);

  // Load on mount and refresh when the window regains focus.
  useEffect(() => {
    if (!enabled) return;

    refresh();

    const onStatusChanged = (next: ModelStatus) => {
      // The event includes every installed model. Update directly when it is
      // the active row; re-read the active row when selection changes.
      if (next.modelId === statusRef.current.modelId) {
        updateStatus(next);
      } else {
        void refresh();
      }
    };
    const unsubscribeStatus = window.stt?.onModelStatusChanged?.(
      onStatusChanged,
    );

    // Refresh on window focus to catch changes made while the app was hidden.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubscribeStatus?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  return { status, refresh };
}
