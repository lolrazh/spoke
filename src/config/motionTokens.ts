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
    // General purpose spring for quick transitions
    quick: { stiffness: 400, damping: 30 } as SpringToken,
    // Slightly bouncier for hover/active interactions
    lively: { stiffness: 400, damping: 25, mass: 0.9 } as SpringToken,
    // Heavier feel for large layout changes
    heavy: { stiffness: 200, damping: 25, mass: 1.2 } as SpringToken,
  },
} as const;

export type MotionTokens = typeof MOTION;


