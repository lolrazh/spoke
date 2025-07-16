import { Variants } from 'framer-motion';
import { TOKENS } from './uiTokens';

const PILL_EXPANDED_WIDTH = TOKENS.PILL_BASE_W;
const PILL_EXPANDED_HEIGHT = TOKENS.PILL_BASE_H;
const PILL_RESTING_HEIGHT = TOKENS.PILL_RESTING_H;

// Animation variants for the pill's state machine
export const pillVariants: Variants = {
  // Resting, thin bar
  IDLE: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_RESTING_HEIGHT,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  // When hovered in idle state
  HOVER_PREVIEW: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_EXPANDED_HEIGHT,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  // Dictation active
  LISTENING: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_EXPANDED_HEIGHT,
    transition: { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 },
  },
  // Processing transcription
  PROCESSING: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_EXPANDED_HEIGHT,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  // Shrinking before showing notification
  NOTIF_SHRINK: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_RESTING_HEIGHT,
    transition: { ease: 'easeIn', duration: 0.2 },
  },
  // Expanded to show notification text
  NOTIF_SHOW: (custom: { notifWidth?: number }) => ({
    width: custom.notifWidth || PILL_EXPANDED_WIDTH,
    height: PILL_EXPANDED_HEIGHT,
    transition: { ease: 'easeOut', duration: 0.25 },
  }),
}; 