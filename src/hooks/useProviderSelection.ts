/**
 * Provider Selection Hook
 *
 * Manages transcription provider loading, catalog computation, and
 * selection state. Used by both Onboarding and Settings to provide
 * a consistent provider picker experience.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  TranscriptionProviderSettingsEntry,
  TranscriptionProviderSettingsSnapshot,
} from "../core/transcription/providerCatalog";
import { LOCAL_STT_PROVIDER_ID } from "../core/transcription/providerPreferences";

export function useProviderSelection() {
  const [providerSettings, setProviderSettings] =
    useState<TranscriptionProviderSettingsSnapshot | null>(null);

  const loadProviderSettings =
    useCallback(async (): Promise<TranscriptionProviderSettingsSnapshot> => {
      if (!window.stt?.getProviderSettings) {
        throw new Error("STT provider settings bridge is unavailable.");
      }

      return window.stt.getProviderSettings();
    }, []);

  // Load on mount
  useEffect(() => {
    let isMounted = true;

    loadProviderSettings()
      .then((snapshot) => {
        if (isMounted) {
          setProviderSettings(snapshot);
        }
      })
      .catch((): undefined => undefined);

    return () => {
      isMounted = false;
    };
  }, [loadProviderSettings]);

  const providerEntries = useMemo<TranscriptionProviderSettingsEntry[]>(() => {
    return providerSettings?.providers ?? [];
  }, [providerSettings]);

  const selectableProviderEntries = useMemo(
    () => providerEntries.filter((provider) => provider.selectable),
    [providerEntries],
  );

  const selectedProviderId =
    providerSettings?.preferredProviderId ?? LOCAL_STT_PROVIDER_ID;

  const selectedProviderEntry =
    providerEntries.find((provider) => provider.id === selectedProviderId) ??
    null;

  return {
    providerSettings,
    setProviderSettings,
    loadProviderSettings,
    providerEntries,
    selectableProviderEntries,
    selectedProviderId,
    selectedProviderEntry,
  };
}
