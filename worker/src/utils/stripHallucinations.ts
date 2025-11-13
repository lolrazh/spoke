/**
 * Strips common Whisper hallucination phrases that appear at the end of transcriptions.
 * These phrases are artifacts from YouTube videos in the training data.
 */

// Common hallucination patterns (case-insensitive)
const HALLUCINATION_PATTERNS = [
  /thanks?\s+for\s+watching/i,
  /don'?t\s+forget\s+to\s+like\s+and\s+subscribe/i,
  /subtitles\s+by\s+the\s+amara\.org\s+community/i,
  /please\s+subscribe/i,
  /thank\s+you\s+for\s+watching/i,
];

/**
 * Removes hallucination phrases from the end of transcription text.
 * Only removes phrases that appear at the very end, optionally preceded by punctuation.
 *
 * @param text - The transcription text to clean
 * @returns The cleaned text with hallucinations removed
 *
 * @example
 * stripHallucinations("This is my text. Thanks for watching!")
 * // Returns: "This is my text."
 *
 * stripHallucinations("Don't forget to like and subscribe to my channel")
 * // Returns: "Don't forget to like and subscribe to my channel" (not at end after punctuation)
 */
export function stripHallucinations(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text.trim();
  let foundMatch = true;

  // Keep looping in case multiple hallucinations are stacked
  while (foundMatch) {
    foundMatch = false;

    for (const pattern of HALLUCINATION_PATTERNS) {
      // Create a regex that matches the pattern at the end, with optional punctuation
      // Pattern: (optional space/punctuation) + hallucination phrase + (optional punctuation) + end of string
      const endPattern = new RegExp(
        `[\\s.!?,:;-]*${pattern.source}[\\s.!?,:;-]*$`,
        'i'
      );

      if (endPattern.test(cleaned)) {
        // Remove the hallucination and any trailing/leading punctuation artifacts
        cleaned = cleaned.replace(endPattern, '').trim();

        // Clean up any double punctuation that might be left behind
        cleaned = cleaned.replace(/([.!?])[.!?\s]+$/, '$1');

        foundMatch = true;
        break;
      }
    }
  }

  return cleaned;
}
