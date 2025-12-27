// Minimal shared auth signals used to gate sign-in toasts.
// These are mirrored to localStorage so separate renderer windows (pill/onboarding)
// can coordinate intent/callback recency. In-memory values remain as a fast path.

export type AuthSignalsSnapshot = {
  authIntentTs: number | null;
  authIntentProvider: string | null;
  authCallbackTs: number | null;
  onboardingTs: number | null;
  lastToastTs: number | null;
};

// LocalStorage keys
const LS_KEYS = {
  intentTs: "sf.auth.intentTs",
  intentProvider: "sf.auth.intentProvider",
  callbackTs: "sf.auth.callbackTs",
  onboardingTs: "sf.auth.onboardingTs",
  lastToastTs: "sf.auth.lastToastTs",
} as const;

let authIntentTs: number | null = null;
let authIntentProvider: string | null = null;
let authCallbackTs: number | null = null;
let onboardingTs: number | null = null;
let lastToastTs: number | null = null;

const readNumber = (key: string): number | null => {
  try {
    const v = window.localStorage?.getItem(key);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

const readString = (key: string): string | null => {
  try {
    const v = window.localStorage?.getItem(key);
    return v ?? null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value == null) window.localStorage?.removeItem(key);
    else window.localStorage?.setItem(key, value);
  } catch {
    // ignore storage failures
  }
};

function hydrateFromStorage() {
  // Only hydrate once at module init; getSignals() will also read live values.
  authIntentTs = readNumber(LS_KEYS.intentTs);
  authIntentProvider = readString(LS_KEYS.intentProvider);
  authCallbackTs = readNumber(LS_KEYS.callbackTs);
  onboardingTs = readNumber(LS_KEYS.onboardingTs);
  lastToastTs = readNumber(LS_KEYS.lastToastTs);
}

try {
  hydrateFromStorage();
} catch {}

export function markAuthIntent(provider: string) {
  authIntentProvider = provider;
  authIntentTs = Date.now();
  write(LS_KEYS.intentProvider, provider);
  write(LS_KEYS.intentTs, String(authIntentTs));
}

export function clearAuthIntent() {
  authIntentProvider = null;
  authIntentTs = null;
  write(LS_KEYS.intentProvider, null);
  write(LS_KEYS.intentTs, null);
}

export function markAuthCallback() {
  authCallbackTs = Date.now();
  write(LS_KEYS.callbackTs, String(authCallbackTs));
}

export function markOnboardingEvent() {
  onboardingTs = Date.now();
  write(LS_KEYS.onboardingTs, String(onboardingTs));
}

export function setLastToastTs(ts: number) {
  lastToastTs = ts;
  write(LS_KEYS.lastToastTs, String(ts));
}

export function getSignals(): AuthSignalsSnapshot {
  // Read through to storage to reflect updates from other windows.
  const lsIntentTs = readNumber(LS_KEYS.intentTs);
  const lsIntentProvider = readString(LS_KEYS.intentProvider);
  const lsCallbackTs = readNumber(LS_KEYS.callbackTs);
  const lsOnboardingTs = readNumber(LS_KEYS.onboardingTs);
  const lsLastToastTs = readNumber(LS_KEYS.lastToastTs);

  return {
    authIntentTs: lsIntentTs ?? authIntentTs,
    authIntentProvider: lsIntentProvider ?? authIntentProvider,
    authCallbackTs: lsCallbackTs ?? authCallbackTs,
    onboardingTs: lsOnboardingTs ?? onboardingTs,
    lastToastTs: lsLastToastTs ?? lastToastTs,
  };
}
