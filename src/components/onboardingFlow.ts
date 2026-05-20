export type OnboardingStep =
  | "permissions"
  | "mic-check"
  | "transcription-setup"
  | "hotkey-info"
  | "hotkey-test"
  | "hands-free-test"
  | "edit-test"
  | "meta-directives"
  | "cancel-info"
  | "settings-info"
  | "complete";

const ALL_ONBOARDING_STEPS: OnboardingStep[] = [
  "permissions",
  "mic-check",
  "transcription-setup",
  "hotkey-info",
  "hotkey-test",
  "complete",
];

export function buildOnboardingSteps(): OnboardingStep[] {
  return ALL_ONBOARDING_STEPS;
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return ALL_ONBOARDING_STEPS.includes(value as OnboardingStep);
}
