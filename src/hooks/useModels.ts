import { useState, useEffect, useCallback } from "react";
import type { LocalModelInfo, ModelStatus } from "../types/shared";

export type ModelRow = {
  info: LocalModelInfo;
  status: ModelStatus;
  isActive: boolean;
};

type UseModelsOptions = {
  enabled?: boolean;
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

    const unsubProgress = window.stt?.onModelProgress?.((payload) => {
      setStatuses((prev) => {
        const current = prev[payload.modelId];
        if (!current) return prev;
        return {
          ...prev,
          [payload.modelId]: {
            ...current,
            state: "downloading",
            downloadProgress: payload.progress,
            downloadedBytes: payload.downloadedBytes,
            totalBytes: payload.totalBytes,
          },
        };
      });
    });

    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubProgress?.();
      window.removeEventListener("focus", onFocus);
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

  const setActive = useCallback(
    async (modelId: string) => {
      setActiveModelId(modelId);
      try {
        await window.stt?.setActiveModel?.(modelId);
      } finally {
        await refresh();
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

  return { rows, activeModelId, install, remove, setActive, refresh, loaded };
}
