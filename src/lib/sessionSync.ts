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
export function initializeSessionSync(): void {
    if (syncInitialized) {
        console.warn("[SessionSync] Already initialized");
        return;
    }

    const supabase = getSupabase();
    if (!supabase) {
        console.warn("[SessionSync] Supabase not available");
        return;
    }

    // Listen to auth state changes and sync to electron-store
    supabase.auth.onAuthStateChange(async (event, session) => {
        console.log(`[SessionSync] Auth event: ${event}`);

        try {
            if (session) {
                // Session exists - sync all Supabase keys to electron-store
                const supabaseKeys = Object.keys(localStorage).filter(key =>
                    key.startsWith('sb-')
                );

                for (const key of supabaseKeys) {
                    const value = localStorage.getItem(key);
                    if (value) {
                        await window.supabaseSession.setItem(key, value);
                    }
                }

                console.log(`[SessionSync] Synced ${supabaseKeys.length} keys to electron-store`);
            } else {
                // No session - clear from electron-store
                const supabaseKeys = Object.keys(localStorage).filter(key =>
                    key.startsWith('sb-')
                );

                for (const key of supabaseKeys) {
                    await window.supabaseSession.removeItem(key);
                }

                console.log(`[SessionSync] Cleared ${supabaseKeys.length} keys from electron-store`);
            }
        } catch (error) {
            console.error("[SessionSync] Failed to sync:", error);
        }
    });

    syncInitialized = true;
    console.log("[SessionSync] Initialized");
}
