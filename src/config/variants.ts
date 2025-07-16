import { Variants } from 'framer-motion';
import { TOKENS } from './uiTokens';

const PILL_EXPANDED_WIDTH = TOKENS.PILL_BASE_W;
const PILL_EXPANDED_HEIGHT = TOKENS.PILL_BASE_H;
const PILL_RESTING_HEIGHT = TOKENS.PILL_RESTING_H;

// Animation variants for the pill's state machine
export const pillVariants: Variants = {
  // Resting, thin bar
  IDLE: {
    width: TOKENS.PILL_BASE_W,
    height: TOKENS.PILL_RESTING_H,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  // A temporary resting state to pause before notifications
  IDLE_TRANSITION: {
    width: PILL_EXPANDED_WIDTH,
    height: PILL_RESTING_HEIGHT,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  // When hovered in idle state
  HOVER_PREVIEW: {
    width: TOKENS.PILL_BASE_W,
    height: TOKENS.PILL_BASE_H,
    transition: { type: 'spring', stiffness: 400, damping: 25, mass: 0.9 },
  },
  // Dictation active
  LISTENING: {
    width: TOKENS.PILL_BASE_W,
    height: TOKENS.PILL_BASE_H,
    transition: { type: 'spring', stiffness: 400, damping: 25, mass: 0.9 },
  },
  // Processing transcription
  PROCESSING: {
    width: TOKENS.PILL_BASE_W,
    height: TOKENS.PILL_BASE_H,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
  NOTIFICATION: {
    width: 'auto',
    height: TOKENS.PILL_BASE_H,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
}; 