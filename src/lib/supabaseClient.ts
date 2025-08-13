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

export async function getGoogleOAuthUrl(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  // Ask Electron main which redirect to use
  const redirect = await (window.electron?.getAuthRedirectUrl?.() ?? Promise.resolve({ url: "sonicflow://auth/callback" }));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirect.url,
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    console.error("[Auth] Google OAuth error:", error.message);
    return null;
  }
  return data?.url ?? null;
}

export async function startEmailOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const redirect = await (window.electron?.getAuthRedirectUrl?.() ?? Promise.resolve({ url: "sonicflow://auth/callback" }));
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect.url },
  });
  if (error) return { ok: false, error: error.message };
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

  try {
    const parsed = new URL(url);
    // OAuth PKCE callback: code in query
    const code = parsed.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
    // Magic link/implicit callback: access_token in fragment
    if (parsed.hash && parsed.hash.includes("access_token")) {
      const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      }
    }
    // PKCE email template variant: token_hash in query
    const token_hash = parsed.searchParams.get("token_hash");
    const type = parsed.searchParams.get("type");
    if (token_hash && type === "email") {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
    return { ok: false, error: "Unrecognized auth callback" };
  } catch (e: any) {
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


