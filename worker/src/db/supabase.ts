import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

let cachedClient: SupabaseClient | null = null;

/**
 * Get or create a Supabase client for the Worker
 * Uses service role key for full database access
 */
export function getSupabaseClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      "[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return null;
  }

  // Reuse cached client
  if (cachedClient) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
    return cachedClient;
  } catch (error) {
    console.error("[Supabase] Failed to create client:", error);
    return null;
  }
}
