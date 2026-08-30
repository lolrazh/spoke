import { useState, useEffect, useCallback, useRef } from "react";
import type { LocalModelInfo, ModelStatus } from "../types/shared";

export type ModelRow = {
  info: LocalModelInfo;
  status: ModelStatus;
  isActive: boolean;
};

type UseModelsOptions = {
  enabled?: boolean;
};

type ModelProgressPayload = {
  modelId: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
};

/**
 * Multi-model view: pairs each registered model's static info with its live
 * install status and the active-model selection. Used by the models page.
 */
export function useModels(options: UseModelsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [infos, setInfos] = useState<LocalModelInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const selectionGenerationRef = useRef(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, active, infoList] = await Promise.all([
        window.stt?.getModelStatuses?.(),
        window.stt?.getActiveModel?.(),
        window.stt?.getModelInfos?.(),
      ]);
      if (infoList) setInfos(infoList);
      if (active) setActiveModelId(active);
      if (list) {
        setStatuses(
          Object.fromEntries(list.map((s) => [s.modelId ?? "", s])),
        );
      }
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    refresh();

    // Network streams can emit many progress events between paints. Keep only
    // the latest event per model and publish one React update per frame so a
    // large download cannot turn every response chunk into a render.
    const pendingProgress = new Map<string, ModelProgressPayload>();
    let scheduledFrame: number | null = null;
    let scheduledWithRaf = false;

    const flushProgress = () => {
      scheduledFrame = null;
      const updates = Array.from(pendingProgress.values());
      pendingProgress.clear();
      if (updates.length === 0) return;

      setStatuses((prev) => {
        let next = prev;
        for (const payload of updates) {
          const current = prev[payload.modelId];
          if (!current) continue;
          // A late chunk must not move a completed or checksum-verifying
          // model back to the downloading state.
          if (current.state === "ready" || current.state === "installing") {
            continue;
          }
          if (
            current.state === "downloading" &&
            current.downloadProgress === payload.progress &&
            current.downloadedBytes === payload.downloadedBytes &&
            current.totalBytes === payload.totalBytes
          ) {
            continue;
          }
          if (next === prev) next = { ...prev };
          next[payload.modelId] = {
            ...current,
            state: "downloading",
            downloadProgress: payload.progress,
            downloadedBytes: payload.downloadedBytes,
            totalBytes: payload.totalBytes,
          };
        }
        return next;
      });
    };

    const scheduleProgressFlush = () => {
      if (scheduledFrame !== null) return;
      if (typeof window.requestAnimationFrame === "function") {
        scheduledWithRaf = true;
        scheduledFrame = window.requestAnimationFrame(flushProgress);
      } else {
        scheduledWithRaf = false;
        scheduledFrame = window.setTimeout(flushProgress, 0);
      }
    };

    const unsubProgress = window.stt?.onModelProgress?.((payload) => {
      pendingProgress.set(payload.modelId, payload);
      scheduleProgressFlush();
    });

    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubProgress?.();
      window.removeEventListener("focus", onFocus);
      if (scheduledFrame !== null) {
        if (scheduledWithRaf) {
          window.cancelAnimationFrame(scheduledFrame);
        } else {
          window.clearTimeout(scheduledFrame);
        }
        scheduledFrame = null;
      }
      pendingProgress.clear();
    };
  }, [enabled, refresh]);

  const install = useCallback(
    async (modelId: string) => {
      setStatuses((prev) => {
        const current = prev[modelId];
        if (!current) return prev;
        return {
          ...prev,
          [modelId]: {
            ...current,
            state: "downloading",
            downloadProgress: 0,
            error: null,
          },
        };
      });
      try {
        await window.stt?.installModel?.(modelId);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (modelId: string) => {
      try {
        await window.stt?.removeModel?.(modelId);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const cancel = useCallback(
    async (modelId: string) => {
      try {
        await window.stt?.cancelInstall?.(modelId);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const setActive = useCallback(
    async (modelId: string) => {
      const generation = ++selectionGenerationRef.current;
      setActiveModelId(modelId);
      try {
        await window.stt?.setActiveModel?.(modelId);
      } catch {
        // Only the latest failed request can reconcile renderer state. An older
        // failure must not overwrite a newer optimistic selection.
        if (generation === selectionGenerationRef.current) {
          await refresh();
        }
      }
    },
    [refresh],
  );

  const rows: ModelRow[] = infos.map((info) => ({
    info,
    status: statuses[info.modelId] ?? {
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
    },
    isActive: info.modelId === activeModelId,
  }));

  return {
    rows,
    activeModelId,
    install,
    remove,
    cancel,
    setActive,
    refresh,
    loaded,
  };
}
