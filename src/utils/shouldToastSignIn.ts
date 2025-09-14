export type SignInEvent = "SIGNED_IN" | "TOKEN_REFRESHED" | "INITIAL_SESSION" | "USER_UPDATED" | string;

export type ToastGateInputs = {
  event: SignInEvent;
  prevUserId: string | null;
  currentUserId: string | null;
  now: number; // Date.now()
  lastToastTs: number | null;
  authIntentTs: number | null;
  authCallbackTs: number | null;
  onboardingTs: number | null;
  documentHidden: boolean;
  msSinceFocus: number | null; // milliseconds since app focused (null if unknown)
  freshnessMs?: number; // default 90_000
  cooldownMs?: number; // default 30 * 60_000
  focusGuardMs?: number; // default 300
  flapGuardMs?: number; // future use (not currently used here)
};

export function shouldToastSignIn(inp: ToastGateInputs): boolean {
  const {
    event,
    prevUserId,
    currentUserId,
    now,
    lastToastTs,
    authIntentTs,
    authCallbackTs,
    onboardingTs,
    documentHidden,
    msSinceFocus,
    freshnessMs = 90_000,
    cooldownMs = 30 * 60_000,
    focusGuardMs = 300,
  } = inp;

  if (event !== "SIGNED_IN") return false;
  if (!currentUserId) return false;

  const isNewLogin = prevUserId == null || prevUserId !== currentUserId;
  if (!isNewLogin) return false;

  // Intent evidence within freshness window
  const within = (ts: number | null) => (ts ? now - ts <= freshnessMs : false);
  const hasIntentEvidence = within(authIntentTs) || within(authCallbackTs) || within(onboardingTs);
  if (!hasIntentEvidence) return false;

  // App visibility/focus guards
  if (documentHidden) return false;
  if (msSinceFocus != null && msSinceFocus < focusGuardMs) return false;

  // Cooldown unless user id changed (already allowed by isNewLogin)
  if (lastToastTs != null && now - lastToastTs < cooldownMs && prevUserId === currentUserId) {
    return false;
  }

  return true;
}

