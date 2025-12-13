/**
 * Session Storage Module
 * 
 * Stores Supabase session data in electron-store for reliable persistence.
 * Electron's localStorage with file:// URLs is unreliable in packaged builds,
 * so we use file-based storage and sync it with localStorage.
 */

import Store from "electron-store";

interface SessionStoreSchema {
    sessionData: Record<string, string>;
}

const sessionStore = new Store<SessionStoreSchema>({
    name: "supabase-session",
    defaults: {
        sessionData: {},
    },
});

/**
 * Get all Supabase session data (keys starting with 'sb-')
 */
export function getAllSessionData(): Record<string, string> {
    return sessionStore.get("sessionData", {});
}

/**
 * Set a session key-value pair
 */
export function setSessionItem(key: string, value: string): void {
    const session = getAllSessionData();
    session[key] = value;
    sessionStore.set("sessionData", session);
}

/**
 * Get a specific session value
 */
export function getSessionItem(key: string): string | null {
    const session = getAllSessionData();
    return session[key] || null;
}

/**
 * Remove a session key
 */
export function removeSessionItem(key: string): void {
    const session = getAllSessionData();
    delete session[key];
    sessionStore.set("sessionData", session);
}

/**
 * Clear all session data
 */
export function clearAllSessionData(): void {
    sessionStore.set("sessionData", {});
}
