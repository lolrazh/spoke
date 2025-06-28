/**
 * Audio Configuration Constants
 * Centralized location for all audio-related constants used throughout the app
 */

// Primary sample rates
export const TARGET_SAMPLE_RATE = 16000; // Primary rate for STT processing and AudioContext
export const MICROPHONE_PREFERRED_RATE = 48000; // Preferred microphone capture rate

// Buffer and timing constants
export const MAX_RING_BUFFER_SECONDS = 10; // Maximum ring buffer duration
export const INITIAL_BUFFER_SECONDS = 8; // Initial buffer size for workers
export const BUFFER_GROWTH_SECONDS = 8; // Buffer growth increment

// Calculated values
export const RING_BUFFER_SAMPLE_CAPACITY =
  TARGET_SAMPLE_RATE * MAX_RING_BUFFER_SECONDS;
export const INITIAL_BUFFER_SIZE = TARGET_SAMPLE_RATE * INITIAL_BUFFER_SECONDS;
export const BUFFER_GROWTH_SIZE = TARGET_SAMPLE_RATE * BUFFER_GROWTH_SECONDS;

// Legacy constants for backward compatibility
export const TARGET_AUDIO_CONTEXT_RATE = TARGET_SAMPLE_RATE;
export const SAMPLE_RATE_16K = TARGET_SAMPLE_RATE;
