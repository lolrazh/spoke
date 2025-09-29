import { getCurrentUser, getSupabase, type UserMetadata } from "../lib/supabaseClient";

export type UserIdentity = {
  name: string | null;
  email: string | null;
};

const listeners = new Set<(identity: UserIdentity) => void>();
let identity: UserIdentity = { name: null, email: null };
let initialized = false;
let authUnsubscribe: (() => void) | null = null;
let initPromise: Promise<UserIdentity> | null = null;

try {
  if (typeof window !== "undefined" && window.localStorage) {
    const cachedEmail = window.localStorage.getItem("sf.lastUserEmail");
    if (cachedEmail) {
      identity = { ...identity, email: cachedEmail };
    }
  }
} catch {
  // ignore cache hydration failures
}

function emit(next: UserIdentity) {
  if (identity.name === next.name && identity.email === next.email) return;
  identity = next;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (next.email) {
        window.localStorage.setItem("sf.lastUserEmail", next.email);
      } else {
        window.localStorage.removeItem("sf.lastUserEmail");
      }
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
  try {
    const user = await getCurrentUser();
    const metadata = (user?.user_metadata as UserMetadata | undefined) ?? null;
    const next: UserIdentity = {
      name: metadata?.name ?? null,
      email: user?.email ?? null,
    };
    emit(next);
  } catch {
    emit({ name: null, email: null });
  }
  return identity;
}

function subscribeToAuthChanges() {
  if (authUnsubscribe) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    const metadata = (user?.user_metadata as UserMetadata | undefined) ?? undefined;
    emit({
      name: metadata?.name ?? null,
      email: user?.email ?? null,
    });
  });
  authUnsubscribe = () => subscription.unsubscribe();
}

export function subscribeUserIdentity(listener: (value: UserIdentity) => void) {
  listeners.add(listener);
  listener(identity);
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

export function getUserIdentity(): UserIdentity {
  return identity;
}

export function isUserIdentityInitialized(): boolean {
  return initialized;
}

export function resetUserIdentityForTests() {
  identity = { name: null, email: null };
  initialized = false;
  if (authUnsubscribe) {
    try {
      authUnsubscribe();
    } catch {}
  }
  authUnsubscribe = null;
  initPromise = null;
  listeners.clear();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("sf.lastUserEmail");
    }
  } catch {}
}
