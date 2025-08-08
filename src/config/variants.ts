import { Variants } from "framer-motion";
import { TOKENS } from "./uiTokens";
import { MOTION } from "./motionTokens";

const PILL_EXPANDED_WIDTH = TOKENS.PILL_BASE_W;
const PILL_RESTING_HEIGHT = TOKENS.PILL_RESTING_H;

// Animation variants for the pill's state machine
export const pillVariants: Variants = {
  // Resting, thin bar
  IDLE: {
    transition: { type: "spring", ...MOTION.springs.quick },
  },
  // A temporary resting state to pause before notifications
  IDLE_TRANSITION: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_RESTING_HEIGHT,
    transition: { type: "spring", ...MOTION.springs.quick },
  },
  // When hovered in idle state
  HOVER_PREVIEW: {
    transition: { type: "spring", ...MOTION.springs.lively },
  },
  // Dictation active
  LISTENING: {
    transition: { type: "spring", ...MOTION.springs.lively },
  },
  // Processing transcription
  PROCESSING: {
    transition: { type: "spring", ...MOTION.springs.quick },
  },
  NOTIFICATION: {
    transition: { type: "spring", ...MOTION.springs.quick },
  },
  // Expanded to full home window size
  EXPANDED: {
    transition: { type: "spring", ...MOTION.springs.heavy },
  },
};
