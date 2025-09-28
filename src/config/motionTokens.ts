export type SpringToken = {
  stiffness: number;
  damping: number;
  mass?: number;
};

export const MOTION = {
  // CSS durations/easings are defined in :root as CSS variables
  durations: {
    instant: 0,
    fast: 0.2,
    standard: 0.3,
    slow: 0.5,
  },
  springs: {
    // Ultra-fast response for critical interactions (sub-50ms)
    instant: { stiffness: 1000, damping: 15, mass: 0.5 } as SpringToken,
    // General purpose spring for quick transitions
    quick: { stiffness: 520, damping: 26 } as SpringToken,
    // Slightly bouncier for hover/active interactions
    lively: { stiffness: 700, damping: 22, mass: 0.8 } as SpringToken,
    // Heavier feel for large layout changes
    heavy: { stiffness: 420, damping: 34, mass: 1.0 } as SpringToken,
    // Snappy return to idle with minimal bounce
    settle: { stiffness: 720, damping: 28, mass: 0.6 } as SpringToken,
  },
} as const;

export type MotionTokens = typeof MOTION;
