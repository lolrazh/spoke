/**
 * Share Preference Hook
 *
 * Manages the user's transcription sharing preference using localStorage only.
 */

import { useState, useCallback } from "react";

const STORAGE_KEY = "sf.shareTranscriptions";

export function useSharePreference() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async (_userId?: string | null) => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setEnabled(stored === "true");
    } catch {
      setEnabled(false);
    }
    setLoading(false);
  }, []);

  const toggle = useCallback(
    async (nextEnabled: boolean) => {
      if (updating) return;
      if (nextEnabled === enabled) return;
      setEnabled(nextEnabled);
      setUpdating(true);
      try {
        localStorage.setItem(STORAGE_KEY, nextEnabled ? "true" : "false");
      } catch {
        // Ignore storage failures
      }
      setUpdating(false);
    },
    [enabled, updating],
  );

  return {
    shareTranscriptionsEnabled: enabled,
    shareTranscriptionsLoading: loading,
    shareTranscriptionsUpdating: updating,
    loadSharePreference: load,
    handleSharePreferenceToggle: toggle,
  };
}
