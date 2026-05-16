import { describe, expect, it } from "vitest";
import { buildOnboardingSteps, isOnboardingStep } from "./onboardingFlow";

describe("onboardingFlow", () => {
  it("starts with permissions and ends with complete", () => {
    const steps = buildOnboardingSteps();
    expect(steps[0]).toBe("permissions");
    expect(steps[steps.length - 1]).toBe("complete");
  });

  it("recognizes valid onboarding steps", () => {
    expect(isOnboardingStep("permissions")).toBe(true);
    expect(isOnboardingStep("transcription-setup")).toBe(true);
    expect(isOnboardingStep("settings-info")).toBe(true);
    expect(isOnboardingStep("missing-step")).toBe(false);
  });

  it("sets up transcription before hotkey testing", () => {
    const steps = buildOnboardingSteps();
    expect(steps.indexOf("transcription-setup")).toBeGreaterThan(
      steps.indexOf("mic-check"),
    );
    expect(steps.indexOf("transcription-setup")).toBeLessThan(
      steps.indexOf("hotkey-info"),
    );
  });

  it("does not include auth or name-verification", () => {
    const steps = buildOnboardingSteps();
    expect(steps).not.toContain("auth");
    expect(steps).not.toContain("name-verification");
  });
});
