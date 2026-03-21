/**
 * Onboarding Auth Hook
 *
 * Manages authentication lifecycle during onboarding: Google OAuth,
 * email magic link, account switching, session validation, and
 * account summary display.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  getSupabase,
  getGoogleOAuthUrl,
  startEmailOtp,
  getCurrentUser,
  getProfile,
  signOut,
} from "../lib/supabaseClient";
import type { PreferredTranscriptionProviderId } from "../core/transcription/providerPreferences";
import type { TranscriptionProviderSettingsSnapshot } from "../core/transcription/providerCatalog";

export type AccountSummary = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
};

function deriveAccountSummary(
  profile: Awaited<ReturnType<typeof getProfile>>,
  user: Awaited<ReturnType<typeof getCurrentUser>>,
): AccountSummary | null {
  if (!user) return null;
  const metadata = (user.user_metadata ?? {}) as {
    name?: string;
    avatar_url?: string;
  };
  const email = profile?.email ?? user.email ?? null;
  const displayName =
    profile?.display_name ??
    metadata.name ??
    (email ? email.split("@")[0] : null) ??
    "Spoke user";

  return {
    id: profile?.id ?? user.id,
    displayName,
    email,
    avatarUrl: profile?.avatar_url ?? metadata.avatar_url ?? null,
  };
}

export interface UseOnboardingAuthOptions {
  loadProviderSettings: () => Promise<TranscriptionProviderSettingsSnapshot>;
  setProviderSettings: (
    snapshot: TranscriptionProviderSettingsSnapshot | null,
  ) => void;
  isMountedRef: React.RefObject<boolean>;
}

export function useOnboardingAuth(options: UseOnboardingAuthOptions) {
  const { loadProviderSettings, setProviderSettings, isMountedRef } = options;

  const [authEmail, setAuthEmail] = useState("");
  const [authEmailRequested, setAuthEmailRequested] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signedInAccount, setSignedInAccount] = useState<AccountSummary | null>(
    null,
  );
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);
  const switchAccountIntentRef = useRef(false);

  const ensureAuthRuntimeReady = useCallback(async () => {
    try {
      const [{ initializeSessionSync }] = await Promise.all([
        import("../lib/sessionSync"),
        getSupabase(),
      ]);
      await initializeSessionSync();
    } catch (error) {
      console.warn("[Onboarding] Failed to prepare auth runtime:", error);
    }
  }, []);

  const refreshAccountSummary = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        if (isMountedRef.current) setSignedInAccount(null);
        return null;
      }
      const profile = await getProfile();
      const account = deriveAccountSummary(profile, user);
      if (isMountedRef.current) setSignedInAccount(account);
      return account;
    } catch {
      if (isMountedRef.current) setSignedInAccount(null);
      return null;
    }
  }, [isMountedRef]);

  // Sync derived state when signedInAccount changes
  useEffect(() => {
    if (!signedInAccount) {
      setAuthLoading(false);
      setIsSwitchingAccount(false);
      setSessionValid(false);
      switchAccountIntentRef.current = false;
      return;
    }
    switchAccountIntentRef.current = false;
    setSessionValid(true);
    setAuthLoading(false);
    setAuthError(null);
    setAuthEmail(signedInAccount.email ?? "");
    setAuthEmailRequested(false);
    setIsSwitchingAccount(false);
  }, [signedInAccount]);

  const startGoogleOAuth = useCallback(async () => {
    try {
      setAuthLoading(true);
      setAuthError(null);
      await ensureAuthRuntimeReady();
      const url = await getGoogleOAuthUrl();
      if (!url) {
        setAuthError(
          "Authentication setup failed. Please ensure Spoke is properly configured and try again.",
        );
        setAuthLoading(false);
        return false;
      }
      await window.electron?.openExternal(url);
      setAuthLoading(false);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthError(msg || "Could not start Google sign-in");
      setAuthLoading(false);
      return false;
    }
  }, [ensureAuthRuntimeReady]);

  const handleProviderChange = useCallback(
    async (providerId: string) => {
      try {
        await window.stt?.setPreferredProvider?.(
          providerId as PreferredTranscriptionProviderId,
        );
        const snapshot = await loadProviderSettings();
        if (isMountedRef.current) {
          setProviderSettings(snapshot);
        }
        setAuthError(null);
      } catch (error) {
        console.error(
          "[Onboarding] Failed to switch transcription provider:",
          error,
        );
        window.notifications?.send?.(
          "Failed to switch transcription provider.",
        );
      }
    },
    [loadProviderSettings, setProviderSettings, isMountedRef],
  );

  const handleEmailStart = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    const res = await startEmailOtp(authEmail.trim());
    setAuthLoading(false);
    if (!res.ok) {
      setAuthError(res.error || "Failed to send Magic Link");
      return;
    }
    setAuthEmailRequested(true);
  }, [authEmail]);

  const handleSwitchAccount = useCallback(async () => {
    if (authLoading || isSwitchingAccount) return;
    switchAccountIntentRef.current = true;
    setIsSwitchingAccount(true);
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signOut();
    } catch (error) {
      if (isMountedRef.current) {
        const msg = error instanceof Error ? error.message : String(error);
        setAuthError(msg || "Could not switch account");
      }
    }
    if (isMountedRef.current) {
      setSessionValid(false);
    }
    const started = await startGoogleOAuth();
    if (isMountedRef.current) {
      if (!started) {
        setIsSwitchingAccount(false);
        setAuthLoading(false);
        switchAccountIntentRef.current = false;
      } else {
        setIsSwitchingAccount(false);
      }
    }
  }, [authLoading, isSwitchingAccount, isMountedRef, startGoogleOAuth]);

  return {
    // State
    authEmail,
    setAuthEmail,
    authEmailRequested,
    authLoading,
    authError,
    setAuthError,
    signedInAccount,
    setSignedInAccount,
    isSwitchingAccount,
    sessionValid,
    setSessionValid,
    switchAccountIntentRef,
    // Actions
    ensureAuthRuntimeReady,
    refreshAccountSummary,
    startGoogleOAuth,
    handleProviderChange,
    handleEmailStart,
    handleSwitchAccount,
  };
}
