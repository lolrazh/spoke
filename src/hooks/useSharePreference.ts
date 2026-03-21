/**
 * Share Preference Hook
 *
 * Manages the user's transcription sharing preference with optimistic
 * local caching (localStorage) and server persistence (Supabase).
 */

import { useState, useCallback, useRef } from "react";

const STORAGE_PREFIX = "sf.shareTranscriptions.";

export function useSharePreference() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const load = useCallback(async (userId: string | null) => {
    userIdRef.current = userId;

    if (!userId) {
      setEnabled(false);
      setLoading(false);
      return;
    }

    let seeded = false;
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
      if (stored != null) {
        seeded = true;
        setEnabled(stored === "true");
      }
    } catch {}

    setLoading(true);
    try {
      const { getShareTranscriptionsPreference } = await import(
        "../lib/supabaseClient"
      );
      const pref = await getShareTranscriptionsPreference();
      if (pref === null) {
        if (!seeded) setEnabled(false);
      } else {
        const value = pref === true;
        setEnabled(value);
        try {
          localStorage.setItem(
            `${STORAGE_PREFIX}${userId}`,
            value ? "true" : "false",
          );
        } catch {}
      }
    } catch {
      if (!seeded) setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(
    async (nextEnabled: boolean) => {
      const userId = userIdRef.current;
      if (!userId) {
        try {
          window.notifications?.send?.("Sign in to change this setting");
        } catch {}
        return;
      }
      if (updating) return;
      if (nextEnabled === enabled) return;
      const previous = enabled;
      setEnabled(nextEnabled);
      setUpdating(true);
      try {
        const { setShareTranscriptionsPreference } = await import(
          "../lib/supabaseClient"
        );
        const ok = await setShareTranscriptionsPreference(nextEnabled);
        if (!ok) throw new Error("update failed");
        try {
          localStorage.setItem(
            `${STORAGE_PREFIX}${userId}`,
            nextEnabled ? "true" : "false",
          );
        } catch {}
      } catch {
        setEnabled(previous);
        try {
          window.notifications?.send?.("Unable to update sharing preference");
        } catch {}
      } finally {
        setUpdating(false);
      }
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
