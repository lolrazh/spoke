/**
 * Provider Selection Hook
 *
 * Manages transcription provider loading, catalog computation, and
 * selection state. Used by both Onboarding and Settings to provide
 * a consistent provider picker experience.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { LOCAL_STT_PROVIDER_ID } from "../core/transcription/defaultSessionOrchestrator";
import {
  listTranscriptionProviderCatalog,
  type TranscriptionProviderSettingsEntry,
  type TranscriptionProviderSettingsSnapshot,
} from "../core/transcription/providerCatalog";
import type { PreferredTranscriptionProviderId } from "../core/transcription/providerPreferences";

function fallbackProviders(): TranscriptionProviderSettingsEntry[] {
  return listTranscriptionProviderCatalog().map((provider) => ({
    ...provider,
    selectable: provider.requiresApiKey ? false : provider.selectable,
    apiKeyConfigured: false,
  }));
}

export function useProviderSelection() {
  const [providerSettings, setProviderSettings] =
    useState<TranscriptionProviderSettingsSnapshot | null>(null);

  const loadProviderSettings =
    useCallback(async (): Promise<TranscriptionProviderSettingsSnapshot> => {
      if (window.stt?.getProviderSettings) {
        return window.stt.getProviderSettings();
      }

      return {
        preferredProviderId:
          LOCAL_STT_PROVIDER_ID as PreferredTranscriptionProviderId,
        providers: fallbackProviders(),
      };
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
    if (providerSettings?.providers.length) {
      return providerSettings.providers;
    }
    return fallbackProviders();
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
