import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("[Auth] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    return null;
  }
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: true,
    },
  });
  return client;
}

export type UserMetadata = {
  name?: string;
  avatar_url?: string;
};

export async function getGoogleOAuthUrl(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  
  // Ask Electron main which redirect to use
  const redirect = await (window.electron?.getAuthRedirectUrl?.() ?? Promise.resolve({ url: "sonicflow://auth/callback" }));
  
  console.log(`[Auth] Using redirect URL: ${redirect.url}`);
  console.log(`[Auth] Environment: ${import.meta.env.MODE || 'production'}`);
  
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
  
  console.log(`[Auth] OAuth URL generated successfully: ${data?.url?.substring(0, 100)}...`);
  return data?.url ?? null;
}

export async function startEmailOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  
  const redirect = await (window.electron?.getAuthRedirectUrl?.() ?? Promise.resolve({ url: "sonicflow://auth/callback" }));
  
  console.log(`[Auth] Starting email OTP for: ${email}`);
  console.log(`[Auth] Using email redirect URL: ${redirect.url}`);
  
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

export async function verifyEmailOtp(email: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function handleAuthCallbackUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  console.log(`[Auth] Processing auth callback URL: ${url}`);

  try {
    const parsed = new URL(url);
    console.log(`[Auth] Parsed URL - Protocol: ${parsed.protocol}, Hostname: ${parsed.hostname}, Pathname: ${parsed.pathname}`);
    
    // Validate scheme and path to reduce accidental/hostile inputs
    const isCustomScheme = parsed.protocol === "sonicflow:" || parsed.protocol === "sonicflow-dev:";
    const isDevHttp = (parsed.protocol === "http:" || parsed.protocol === "https:") && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    const isAuthPath = parsed.pathname === "/auth/callback";
    
    console.log(`[Auth] URL validation - Custom scheme: ${isCustomScheme}, Dev HTTP: ${isDevHttp}, Auth path: ${isAuthPath}`);
    
    if (!(isAuthPath && (isCustomScheme || isDevHttp))) {
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
      return { ok: true };
    }
    
    // Magic link/implicit callback: access_token in fragment
    if (parsed.hash && parsed.hash.includes("access_token")) {
      console.log(`[Auth] Processing magic link/implicit callback`);
      const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) {
          console.error(`[Auth] Set session error:`, error);
          return { ok: false, error: error.message };
        }
        console.log(`[Auth] Magic link session set successfully`);
        return { ok: true };
      }
    }
    
    // PKCE email template variant: token_hash in query
    const token_hash = parsed.searchParams.get("token_hash");
    const type = parsed.searchParams.get("type");
    if (token_hash && type === "email") {
      console.log(`[Auth] Processing PKCE email template callback`);
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) {
        console.error(`[Auth] OTP verification error:`, error);
        return { ok: false, error: error.message };
      }
      console.log(`[Auth] PKCE email OTP verification successful`);
      return { ok: true };
    }
    
    console.error(`[Auth] Unrecognized auth callback format`);
    return { ok: false, error: "Unrecognized auth callback" };
  } catch (e: any) {
    console.error(`[Auth] Auth callback processing exception:`, e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function getCurrentUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getProfile(): Promise<
  | { id: string; email: string | null; display_name: string | null; avatar_url: string | null; onboarding_done: boolean | null }
  | null
> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const u = await getCurrentUser();
  if (!u) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,avatar_url,onboarding_done")
    .eq("id", u.id)
    .single();
  if (error) return null;
  return data as any;
}

export async function getProfileDetailed(): Promise<{ ok: true; data: { id: string; email: string | null; display_name: string | null; avatar_url: string | null; onboarding_done: boolean | null } } | { ok: false; error: string } | { ok: false; error: "NO_USER" } | { ok: false; error: "NOT_FOUND" } > {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "NO_USER" };
  try {
    const { data, error, status } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url,onboarding_done")
      .eq("id", u.id)
      .single();
    if (error) {
      // 406/404 are common for missing row
      if ((status === 406 || status === 404)) return { ok: false, error: "NOT_FOUND" };
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: "NOT_FOUND" };
    return { ok: true, data: data as any };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function markOnboardingDone(): Promise<boolean> {
  const supabase = getSupabase();
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
