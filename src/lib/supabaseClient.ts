import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { markAuthCallback, markAuthIntent } from "../utils/authSignals";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

let client: SupabaseClient | null = null;
let clientInitPromise: Promise<SupabaseClient | null> | null = null;

/**
 * Get the Supabase client, waiting for session injection to complete first.
 * 
 * IMPORTANT: This waits for window.sessionReady to resolve before creating
 * the client. This prevents the race condition where Supabase reads an
 * empty localStorage before the preload script has injected the session.
 */
export async function getSupabase(): Promise<SupabaseClient | null> {
  // Already initialized
  if (client) {
    console.log("[Auth] getSupabase() - returning cached client");
    return client;
  }

  // Initialization in progress - wait for it
  if (clientInitPromise) {
    console.log("[Auth] getSupabase() - waiting for in-progress init");
    return clientInitPromise;
  }

  console.log("[Auth] getSupabase() - starting initialization");

  // Start initialization
  clientInitPromise = (async () => {
    // Wait for session to be injected into localStorage
    // This is the "wait at the mailbox" fix!
    console.log("[Auth] Checking for waitForSessionReady...", {
      hasWindow: typeof window !== "undefined",
      hasWaitFn: typeof window !== "undefined" && !!window.waitForSessionReady
    });

    if (typeof window !== "undefined" && window.waitForSessionReady) {
      try {
        console.log("[Auth] Calling waitForSessionReady()...");
        await window.waitForSessionReady();
        console.log("[Auth] Session ready - localStorage is populated");
        // Log what's in localStorage
        const sbKeys = Object.keys(localStorage).filter(k => k.startsWith('sb-'));
        console.log("[Auth] localStorage sb- keys:", sbKeys);
      } catch (error) {
        console.warn("[Auth] waitForSessionReady failed, continuing anyway:", error);
      }
    } else {
      console.warn("[Auth] waitForSessionReady NOT AVAILABLE - session may not be injected!");
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn("[Auth] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
      return null;
    }

    console.log("[Auth] Creating Supabase client...");
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
        autoRefreshToken: true,
        persistSession: true,
      },
    });
    console.log("[Auth] Supabase client created");

    return client;
  })();

  return clientInitPromise;
}

/**
 * Synchronous version of getSupabase - only use this after getSupabase() 
 * has already been called at least once (e.g., in auth state listeners).
 * Returns null if client hasn't been initialized yet.
 */
export function getSupabaseSync(): SupabaseClient | null {
  return client;
}

export type UserMetadata = {
  name?: string;
  avatar_url?: string;
};

type ProfileRecord = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_done: boolean | null;
  share_transcriptions: boolean | null;
};

export async function getGoogleOAuthUrl(): Promise<string | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;

  // Ask Electron main which redirect to use
  const redirect = await (window.electron?.getAuthRedirectUrl?.() ??
    Promise.resolve({ url: "spoke://auth/callback" }));

  // Check if redirect URL request failed (dev server not ready)
  if ("error" in redirect) {
    console.error("[Auth] Failed to get redirect URL:", redirect.error);
    return null;
  }

  console.log(`[Auth] Using redirect URL: ${redirect.url}`);
  console.log(`[Auth] Environment: ${import.meta.env.MODE || "production"}`);

  // Mark user intent before kicking off OAuth
  try {
    markAuthIntent("google");
  } catch { }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirect.url,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    console.error("[Auth] Google OAuth error:", error.message);
    console.error("[Auth] OAuth error details:", error);
    return null;
  }

  console.log(
    `[Auth] OAuth URL generated successfully: ${data?.url?.substring(0, 100)}...`,
  );
  return data?.url ?? null;
}

export async function startEmailOtp(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const redirect = await (window.electron?.getAuthRedirectUrl?.() ??
    Promise.resolve({ url: "spoke://auth/callback" }));

  // Check if redirect URL request failed (dev server not ready)
  if ("error" in redirect) {
    console.error(
      "[Auth] Failed to get redirect URL for email OTP:",
      redirect.error,
    );
    return {
      ok: false,
      error: "Authentication setup failed. Please try again.",
    };
  }

  console.log(`[Auth] Starting email OTP for: ${email}`);
  console.log(`[Auth] Using email redirect URL: ${redirect.url}`);

  // Mark user intent before kicking off OTP
  try {
    markAuthIntent("email");
  } catch { }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect.url },
  });

  if (error) {
    console.error("[Auth] Email OTP error:", error.message);
    console.error("[Auth] Email OTP error details:", error);
    return { ok: false, error: error.message };
  }

  console.log(`[Auth] Email OTP sent successfully to: ${email}`);
  return { ok: true };
}

export async function handleAuthCallbackUrl(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  console.log(`[Auth] Processing auth callback URL: ${url}`);

  try {
    const parsed = new URL(url);
    console.log(
      `[Auth] Parsed URL - Protocol: ${parsed.protocol}, Hostname: ${parsed.hostname}, Pathname: ${parsed.pathname}`,
    );

    // Validate scheme and path to reduce accidental/hostile inputs
    const isCustomScheme =
      parsed.protocol === "spoke:" || parsed.protocol === "spoke-dev:";
    const isDevHttp =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    // Accept both custom-scheme forms and the dev HTTP path
    // - path form: spoke:///auth/callback -> pathname "/auth/callback"
    // - host form: spoke://auth/callback   -> hostname "auth" and pathname "/callback"
    const isPathForm = parsed.pathname === "/auth/callback";
    const isHostForm =
      isCustomScheme &&
      parsed.hostname === "auth" &&
      parsed.pathname === "/callback";
    const isAuthCallback = isPathForm || isHostForm;

    console.log(
      `[Auth] URL validation - Custom scheme: ${isCustomScheme}, Dev HTTP: ${isDevHttp}, Path form: ${isPathForm}, Host form: ${isHostForm}`,
    );

    if (!((isAuthCallback && isCustomScheme) || (isPathForm && isDevHttp))) {
      console.error(`[Auth] Invalid auth callback URL - failed validation`);
      return { ok: false, error: "Invalid auth callback URL" };
    }

    // OAuth PKCE callback: code in query
    const code = parsed.searchParams.get("code");
    if (code) {
      console.log(`[Auth] Processing OAuth PKCE code callback`);
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error(`[Auth] PKCE code exchange error:`, error);
        return { ok: false, error: error.message };
      }
      console.log(`[Auth] OAuth PKCE code exchange successful`);
      try { markAuthCallback(); } catch { }
      return { ok: true };
    }

    // Magic link/implicit callback: access_token in fragment
    if (parsed.hash && parsed.hash.includes("access_token")) {
      console.log(`[Auth] Processing magic link/implicit callback`);
      const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          console.error(`[Auth] Set session error:`, error);
          return { ok: false, error: error.message };
        }
        console.log(`[Auth] Magic link session set successfully`);
        try { markAuthCallback(); } catch { }
        return { ok: true };
      }
    }

    // PKCE email template variant: token_hash in query
    const token_hash = parsed.searchParams.get("token_hash");
    const type = parsed.searchParams.get("type");
    if (token_hash && type === "email") {
      console.log(`[Auth] Processing PKCE email template callback`);
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: "email",
      });
      if (error) {
        console.error(`[Auth] OTP verification error:`, error);
        return { ok: false, error: error.message };
      }
      console.log(`[Auth] PKCE email OTP verification successful`);
      try { markAuthCallback(); } catch { }
      return { ok: true };
    }

    console.error(`[Auth] Unrecognized auth callback format`);
    return { ok: false, error: "Unrecognized auth callback" };
  } catch (e: unknown) {
    console.error(`[Auth] Auth callback processing exception:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function getCurrentUser() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  try {
    const session = await supabase.auth.getSession();
    const localUser = session.data.session?.user ?? null;
    if (localUser) return localUser;

    if (typeof navigator !== "undefined" && navigator && !navigator.onLine) {
      return localUser;
    }

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn("[Supabase] getUser failed", error);
      return null;
    }
    return data.user ?? null;
  } catch (error) {
    console.warn("[Supabase] Failed to resolve current user", error);
    return null;
  }
}

/**
 * Get the current Supabase access token (JWT)
 * This token can be sent to the Worker for authentication
 * Supabase automatically refreshes the token when needed
 * 
 * @returns The access token string, or null if not authenticated
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[Supabase] getSession failed:", error.message);
      return null;
    }
    return session?.access_token ?? null;
  } catch (error) {
    console.warn("[Supabase] Failed to get access token:", error);
    return null;
  }
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();

  // Clear cached user identity on sign-out
  try {
    const { clearUserIdentityCache } = await import("../state/userIdentity");
    clearUserIdentityCache();
  } catch {
    // Ignore if import fails
  }
}

export async function getProfile(): Promise<{
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_done: boolean | null;
  share_transcriptions: boolean | null;
} | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const u = await getCurrentUser();
  if (!u) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,email,display_name,avatar_url,onboarding_done,share_transcriptions",
    )
    .eq("id", u.id)
    .single();
  if (error) return null;
  return data as unknown as ProfileRecord;
}

export async function getProfileDetailed(): Promise<
  | {
    ok: true;
    data: {
      id: string;
      email: string | null;
      display_name: string | null;
      avatar_url: string | null;
      onboarding_done: boolean | null;
      share_transcriptions: boolean | null;
    };
  }
  | { ok: false; error: string }
  | { ok: false; error: "NO_USER" }
  | { ok: false; error: "NOT_FOUND" }
> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "NO_USER" };
  try {
    const { data, error, status } = await supabase
      .from("profiles")
      .select(
        "id,email,display_name,avatar_url,onboarding_done,share_transcriptions",
      )
      .eq("id", u.id)
      .single();
    if (error) {
      // 406/404 are common for missing row
      if (status === 406 || status === 404)
        return { ok: false, error: "NOT_FOUND" };
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: "NOT_FOUND" };
    return {
      ok: true,
      data: data as unknown as ProfileRecord,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function markOnboardingDone(): Promise<boolean> {
  const supabase = await getSupabase();
  if (!supabase) return false;
  const u = await getCurrentUser();
  if (!u) return false;
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_done: true })
      .eq("id", u.id);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a profiles row exists for the current auth user.
 * Returns { ok: true, existed: boolean } where existed indicates whether the row was already present.
 */
export async function ensureProfileRow(): Promise<
  | { ok: true; existed: boolean }
  | { ok: false; error: string }
> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "NO_USER" };

  // Check if a profile already exists
  const existing = await getProfileDetailed();
  if ((existing as unknown as { ok: boolean }).ok === true)
    return { ok: true, existed: true };
  if (
    (existing as unknown as { ok: boolean; error?: string }).ok === false &&
    (existing as unknown as { error?: string }).error !== "NOT_FOUND"
  ) {
    // Unexpected error; surface it but attempt an insert optimistically anyway
    // Fall through to insert; if it conflicts, treat as existed.
  }

  const md = (u.user_metadata as UserMetadata) || {};
  const displayName = md.name || (u.email ? u.email.split("@")[0] : null);
  try {
    const { error, status } = await supabase.from("profiles").insert({
      id: u.id,
      email: u.email,
      display_name: displayName,
      avatar_url: md.avatar_url || null,
      onboarding_done: false,
      share_transcriptions: false,
    });
    if (error) {
      const msg =
        (error as unknown as { message?: string }).message || String(error);
      const code = (error as unknown as { code?: string }).code;
      // Treat unique/duplicate conflicts as "already existed"
      if (status === 409 || code === "23505" || /duplicate/i.test(msg)) {
        return { ok: true, existed: true };
      }
      return { ok: false, error: msg };
    }
    return { ok: true, existed: false };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

const SHARE_PREF_COLUMN = "share_transcriptions";

export async function getShareTranscriptionsPreference(): Promise<boolean | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const { data, error, status } = await supabase
      .from("profiles")
      .select(`${SHARE_PREF_COLUMN}`)
      .eq("id", user.id)
      .single();
    if (error) {
      if (status === 406 || status === 404) return false;
      return null;
    }
    const share = (data as { share_transcriptions?: boolean | null } | null)?.share_transcriptions;
    return share === true;
  } catch {
    return null;
  }
}

export async function setShareTranscriptionsPreference(
  enabled: boolean,
): Promise<boolean> {
  const supabase = await getSupabase();
  if (!supabase) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ [SHARE_PREF_COLUMN]: enabled })
      .eq("id", user.id);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the user's display name in the profiles table.
 * This will automatically refresh the user identity cache.
 * Retries once on failure for resilience.
 */
export async function updateDisplayName(
  displayName: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "NO_USER" };

  const trimmedName = displayName.trim();
  if (!trimmedName) {
    return { ok: false, error: "Display name cannot be empty" };
  }

  const attemptUpdate = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmedName })
        .eq("id", user.id);

      if (error) {
        return { ok: false, error: error.message };
      }

      // Force refresh identity cache to pick up the new name and notify all subscribers
      try {
        const { forceRefreshIdentity } = await import("../state/userIdentity");
        await forceRefreshIdentity();
      } catch (e) {
        console.warn("[updateDisplayName] Failed to refresh identity:", e);
        // Continue anyway - update succeeded
      }

      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  };

  // First attempt
  const result = await attemptUpdate();
  if (result.ok) return result;

  // Retry once on failure
  console.warn("[updateDisplayName] First attempt failed, retrying...", result.error);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return attemptUpdate();
}
