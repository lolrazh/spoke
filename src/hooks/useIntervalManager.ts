import { useCallback, useEffect, useRef } from "react";

type IntervalId = ReturnType<typeof setInterval> | null;

export function useIntervalManager() {
  const intervalsRef = useRef<Record<string, IntervalId>>({});

  const schedule = useCallback(
    (key: string, handler: () => void, delayMs: number) => {
      const existing = intervalsRef.current[key];
      if (existing) clearInterval(existing as number);
      intervalsRef.current[key] = setInterval(handler, delayMs);
    },
    [],
  );

  const cancel = useCallback((key: string) => {
    const existing = intervalsRef.current[key];
    if (existing) {
      clearInterval(existing as number);
      intervalsRef.current[key] = null;
    }
  }, []);

  const cancelAll = useCallback(() => {
    const keys = Object.keys(intervalsRef.current);
    for (const key of keys) {
      const id = intervalsRef.current[key];
      if (id) clearInterval(id as number);
      intervalsRef.current[key] = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAll();
    };
  }, [cancelAll]);

  return { schedule, cancel, cancelAll } as const;
}
