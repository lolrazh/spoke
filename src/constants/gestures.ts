/**
 * Push-to-talk gesture timing shared by the pill (App) and onboarding.
 */

// Minimum press duration to count as a hold; slightly longer to avoid
// interfering with slow double-taps
export const HOLD_DURATION_MS = 130;

// Window for detecting a double-tap; more forgiving to avoid PTT interference
export const DOUBLE_TAP_MS = 450;
