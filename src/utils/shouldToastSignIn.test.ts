import { describe, it, expect } from "vitest";
import { shouldToastSignIn } from "./shouldToastSignIn";

describe("shouldToastSignIn", () => {
  const now = 1_000_000;
  it("allows toast on fresh SIGNED_IN with intent and new user", () => {
    const ok = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: null,
      currentUserId: "u1",
      now,
      lastToastTs: null,
      authIntentTs: now - 5_000,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 1000,
    });
    expect(ok).toBe(true);
  });

  it("suppresses when only TOKEN_REFRESHED or no intent", () => {
    const ok = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: "u1",
      currentUserId: "u1",
      now,
      lastToastTs: null,
      authIntentTs: null,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 1000,
    });
    expect(ok).toBe(false);
  });

  it("suppresses during focus jitter (Mission Control)", () => {
    const ok = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: null,
      currentUserId: "u1",
      now,
      lastToastTs: null,
      authIntentTs: now - 1000,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 100, // < 300ms guard
    });
    expect(ok).toBe(false);
  });

  it("respects cooldown unless account actually changed", () => {
    const ok1 = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: null,
      currentUserId: "u1",
      now,
      lastToastTs: now - 1_000,
      authIntentTs: now - 1000,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 1000,
    });
    expect(ok1).toBe(true); // first time allowed

    const ok2 = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: "u1",
      currentUserId: "u1",
      now: now + 2_000,
      lastToastTs: now + 500, // within cooldown
      authIntentTs: now + 1500,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 1000,
    });
    expect(ok2).toBe(false);

    const ok3 = shouldToastSignIn({
      event: "SIGNED_IN",
      prevUserId: "u1",
      currentUserId: "u2", // account switch
      now: now + 2_000,
      lastToastTs: now + 500,
      authIntentTs: now + 1500,
      authCallbackTs: null,
      onboardingTs: null,
      documentHidden: false,
      msSinceFocus: 1000,
    });
    expect(ok3).toBe(true);
  });
});
