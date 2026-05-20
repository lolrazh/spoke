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
    expect(isOnboardingStep("settings-info")).toBe(false);
    expect(isOnboardingStep("missing-step")).toBe(false);
  });

  it("sets up transcription before hotkey testing", () => {
    const steps = buildOnboardingSteps();
    expect(steps.indexOf("transcription-setup")).toBeGreaterThan(
      steps.indexOf("mic-check"),
    );
    expect(steps.indexOf("transcription-setup")).toBeLessThan(
      steps.indexOf("hotkey-test"),
    );
    expect(steps.indexOf("hotkey-info")).toBeGreaterThan(
      steps.indexOf("transcription-setup"),
    );
    expect(steps.indexOf("hotkey-info")).toBeLessThan(
      steps.indexOf("hotkey-test"),
    );
  });

  it("keeps first-run focused on local setup and one guided dictation test", () => {
    const steps = buildOnboardingSteps();
    expect(steps).toEqual([
      "permissions",
      "mic-check",
      "transcription-setup",
      "hotkey-info",
      "hotkey-test",
      "complete",
    ]);
    expect(steps).not.toContain("hands-free-test");
    expect(steps).not.toContain("edit-test");
    expect(steps).not.toContain("meta-directives");
    expect(steps).not.toContain("cancel-info");
  });

  it("does not include auth or name-verification", () => {
    const steps = buildOnboardingSteps();
    expect(steps).not.toContain("auth");
    expect(steps).not.toContain("name-verification");
  });
});
