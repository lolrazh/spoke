import { describe, expect, it } from "vitest";
import {
  buildOnboardingSteps,
  isOnboardingStep,
} from "./onboardingFlow";

describe("onboardingFlow", () => {
  it("keeps auth and name verification in the flow when auth is required", () => {
    expect(buildOnboardingSteps({ requiresAuth: true }).slice(0, 3)).toEqual([
      "auth",
      "name-verification",
      "permissions",
    ]);
  });

  it("skips name verification when auth is not required", () => {
    expect(buildOnboardingSteps({ requiresAuth: false }).slice(0, 2)).toEqual([
      "auth",
      "permissions",
    ]);
    expect(buildOnboardingSteps({ requiresAuth: false })).not.toContain(
      "name-verification",
    );
  });

  it("recognizes valid onboarding steps", () => {
    expect(isOnboardingStep("auth")).toBe(true);
    expect(isOnboardingStep("settings-info")).toBe(true);
    expect(isOnboardingStep("missing-step")).toBe(false);
  });
});
