import type { Variants } from "framer-motion";
import { MOTION } from "../../config/motionTokens";

const PANEL_ENTER_EASE = [0.16, 1, 0.3, 1] as const;
const PANEL_EXIT_EASE = [0.4, 0, 1, 1] as const;

export const panelCascadeContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.02,
      staggerChildren: 0.032,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.018,
      staggerDirection: -1,
    },
  },
};

export const panelCascadeItem: Variants = {
  hidden: {
    opacity: 0.38,
    y: 4,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: PANEL_ENTER_EASE,
    },
  },
  exit: {
    opacity: 0,
    y: -2,
    transition: {
      duration: MOTION.durations.fast * 0.6,
      ease: PANEL_EXIT_EASE,
    },
  },
};
