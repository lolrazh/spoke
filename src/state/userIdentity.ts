import { getCurrentUser, getSupabase, type UserMetadata } from "../lib/supabaseClient";

export type UserIdentity = {
  name: string | null;
  email: string | null;
};

const CACHE_KEY_NAME = "sf.userName";
const CACHE_KEY_EMAIL = "sf.userEmail";

const listeners = new Set<(identity: UserIdentity) => void>();
let identity: UserIdentity = { name: null, email: null };
let initialized = false;
let authUnsubscribe: (() => void) | null = null;
let initPromise: Promise<UserIdentity> | null = null;

// Hydrate from cache on startup for offline support
try {
  if (typeof window !== "undefined" && window.localStorage) {
    const cachedName = window.localStorage.getItem(CACHE_KEY_NAME);
    const cachedEmail = window.localStorage.getItem(CACHE_KEY_EMAIL);
    if (cachedName || cachedEmail) {
      identity = {
        name: cachedName,
        email: cachedEmail,
      };
      console.log("[UserIdentity] Hydrated from cache:", { name: cachedName, email: cachedEmail });
    }
  }
} catch {
  // ignore cache hydration failures
}

function emit(next: UserIdentity) {
  const sanitized: UserIdentity = {
    name: typeof next.name === "string" ? next.name : null,
    email: typeof next.email === "string" ? next.email : null,
  };
  if (identity.name === sanitized.name && identity.email === sanitized.email) return;
  identity = sanitized;

  // Update cache with both name and email
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (sanitized.name) {
        window.localStorage.setItem(CACHE_KEY_NAME, sanitized.name);
      } else {
        window.localStorage.removeItem(CACHE_KEY_NAME);
      }

      if (sanitized.email) {
        window.localStorage.setItem(CACHE_KEY_EMAIL, sanitized.email);
      } else {
        window.localStorage.removeItem(CACHE_KEY_EMAIL);
      }

      console.log("[UserIdentity] Cache updated:", { name: sanitized.name, email: sanitized.email });
    }
  } catch {
    // ignore storage failures
  }

  for (const listener of listeners) {
    try {
      listener(identity);
    } catch {
      // ignore listener errors to avoid breaking others
    }
  }
}

async function refreshIdentity(): Promise<UserIdentity> {
  if (typeof navigator !== "undefined" && navigator && !navigator.onLine) {
    console.info("[UserIdentity] Offline; using cached identity");
    return identity;
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      emit({ name: null, email: null });
      return identity;
    }

    // Prefer display_name from profile over user_metadata
    let displayName: string | null = null;
    try {
      const { getProfile } = await import("../lib/supabaseClient");
      const profile = await getProfile();
      displayName = profile?.display_name ?? null;
    } catch (e) {
      console.warn("[UserIdentity] Failed to fetch profile, falling back to metadata", e);
    }

    // Fallback to user_metadata.name if profile doesn't have a display_name
    if (!displayName) {
      const metadata = (user.user_metadata as UserMetadata | undefined) ?? null;
      displayName = metadata?.name ?? null;
    }

    emit({
      name: displayName,
      email: user.email ?? null,
    });
    return identity;
  } catch (error) {
    console.warn("[UserIdentity] Failed to refresh identity", error);
    return identity;
  }
}

function subscribeToAuthChanges() {
  if (authUnsubscribe) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    // Clear identity on sign out
    if (event === "SIGNED_OUT") {
      emit({ name: null, email: null });
      return;
    }

    // Eagerly update cache with session data on sign in, then fetch profile in background
    // IMPORTANT: Defer Supabase operations to avoid breaking the auth listener
    // See: https://supabase.com/docs/client/auth-onauthstatechange
    if (event === "SIGNED_IN" && session?.user) {
      // ✅ IMMEDIATE cache update with session data (prevents race condition)
      const metadata = (session.user.user_metadata as UserMetadata | undefined) ?? null;
      const quickName = metadata?.name ?? null;
      const quickEmail = session.user.email ?? null;

      emit({
        name: quickName,
        email: quickEmail,
      });

      // Then fetch full profile from database in background (will update if display_name differs)
      setTimeout(() => {
        refreshIdentity().catch((e) => {
          console.warn("[UserIdentity] Failed to refresh on sign-in:", e);
        });
      }, 0);
      return;
    }

    // Ignore TOKEN_REFRESHED and other events - don't overwrite cached identity
    // The cached identity comes from Supabase profile (source of truth) via refreshIdentity()
  });
  authUnsubscribe = () => subscription.unsubscribe();
}

export function subscribeUserIdentity(listener: (value: UserIdentity) => void) {
  listeners.add(listener);
  // Only fire immediately if we've already initialized
  // This prevents stale cache from flashing before refresh completes
  if (initialized) {
    listener(identity);
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function initUserIdentity(): Promise<UserIdentity> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await refreshIdentity();
    subscribeToAuthChanges();
    initialized = true;
    return identity;
  })();
  return initPromise;
}

/**
 * Force refresh user identity from the database and notify all subscribers.
 * Use this when you know the identity has changed (e.g., after updating display_name).
 */
export async function forceRefreshIdentity(): Promise<UserIdentity> {
  return refreshIdentity();
}

/**
 * Immediately update the local identity cache and notify all subscribers.
 * Use this for instant client-side updates while database saves happen in background.
 */
export function updateIdentityLocal(updates: Partial<UserIdentity>): void {
  const nextIdentity: UserIdentity = {
    name: updates.name !== undefined ? updates.name : identity.name,
    email: updates.email !== undefined ? updates.email : identity.email,
  };
  emit(nextIdentity);
}

export function getUserIdentity(): UserIdentity {
  return identity;
}

export function isUserIdentityInitialized(): boolean {
  return initialized;
}

/**
 * Clear user identity cache (used on sign-out)
 */
export function clearUserIdentityCache() {
  identity = { name: null, email: null };
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(CACHE_KEY_NAME);
      window.localStorage.removeItem(CACHE_KEY_EMAIL);
      // Remove legacy key for backward compatibility
      window.localStorage.removeItem("sf.lastUserEmail");
      console.log("[UserIdentity] Cache cleared");
    }
  } catch {
    // ignore storage failures
  }
  // Notify listeners about the cleared state
  for (const listener of listeners) {
    try {
      listener(identity);
    } catch { }
  }
}

export function resetUserIdentityForTests() {
  identity = { name: null, email: null };
  initialized = false;
  if (authUnsubscribe) {
    try {
      authUnsubscribe();
    } catch { }
  }
  authUnsubscribe = null;
  initPromise = null;
  listeners.clear();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(CACHE_KEY_NAME);
      window.localStorage.removeItem(CACHE_KEY_EMAIL);
      window.localStorage.removeItem("sf.lastUserEmail");
    }
  } catch { }
}
