/**
 * Supabase Session Sync
 *
 * Listens to Supabase auth state changes and syncs session data to electron-store.
 * This ensures the session persists across app restarts.
 */

import { getSupabase } from "./supabaseClient";

let syncInitialized = false;

/**
 * Initialize session sync - call once on app start
 */
export async function initializeSessionSync(): Promise<void> {
  if (syncInitialized) {
    return;
  }

  const supabase = await getSupabase();
  if (!supabase) {
    console.warn("[SessionSync] Supabase not available");
    return;
  }

  // Listen to auth state changes and sync to electron-store
  supabase.auth.onAuthStateChange(async (_event, session) => {
    try {
      if (session) {
        // Session exists - sync all Supabase keys to electron-store
        const supabaseKeys = Object.keys(localStorage).filter((key) =>
          key.startsWith("sb-"),
        );

        for (const key of supabaseKeys) {
          const value = localStorage.getItem(key);
          if (value) {
            await window.supabaseSession.setItem(key, value);
          }
        }
      } else {
        // No session (SIGNED_OUT) - clear ALL session data from electron-store
        await window.supabaseSession.clearAll();
      }
    } catch (error) {
      console.error("[SessionSync] Failed to sync:", error);
    }
  });

  syncInitialized = true;
}
