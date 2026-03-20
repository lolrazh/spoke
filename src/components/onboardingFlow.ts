export type OnboardingStep =
  | "auth"
  | "name-verification"
  | "permissions"
  | "mic-check"
  | "hotkey-info"
  | "hotkey-test"
  | "hands-free-test"
  | "edit-test"
  | "meta-directives"
  | "cancel-info"
  | "settings-info"
  | "complete";

const SHARED_ONBOARDING_STEPS: OnboardingStep[] = [
  "permissions",
  "mic-check",
  "hotkey-info",
  "hotkey-test",
  "hands-free-test",
  "edit-test",
  "cancel-info",
  "meta-directives",
  "settings-info",
  "complete",
];

const ALL_ONBOARDING_STEPS: OnboardingStep[] = [
  "auth",
  "name-verification",
  ...SHARED_ONBOARDING_STEPS,
];

export function buildOnboardingSteps(input: {
  requiresAuth: boolean;
}): OnboardingStep[] {
  if (input.requiresAuth) {
    return ["auth", "name-verification", ...SHARED_ONBOARDING_STEPS];
  }

  return ["auth", ...SHARED_ONBOARDING_STEPS];
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return ALL_ONBOARDING_STEPS.includes(value as OnboardingStep);
}
