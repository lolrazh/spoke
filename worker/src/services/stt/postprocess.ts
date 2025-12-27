/**
 * Post-processing utilities for STT transcriptions
 * Filters out common Whisper hallucinations
 */

/**
 * Hallucination patterns to remove from the end of transcriptions.
 * These are common Whisper hallucinations from YouTube video training data.
 */
const HALLUCINATION_PATTERNS = [
  /[Tt]hank you for watching!$/, // YouTube outro (case-insensitive first letter)
  /Subtitles by the Amara\.org community\.$/, // Amara subtitles (exact match)
];

/**
 * Removes common hallucinations from the end of transcriptions.
 *
 * Patterns removed:
 * - "Thank you for watching!" / "thank you for watching!"
 * - "Subtitles by the Amara.org community."
 *
 * Note: This may remove legitimate dictation that ends with these exact phrases.
 * If the entire transcription is ONLY a hallucination phrase, it will NOT be removed
 * to allow users to retry dictation.
 *
 * @param text - The transcription text to process
 * @returns The text with hallucination removed if present
 */
export function stripHallucinations(text: string): string {
  const trimmed = text.trim();

  // Try to match and remove each hallucination pattern
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      const cleaned = trimmed.replace(pattern, "").trim();

      // Don't strip if the result would be empty - let user retry dictation
      if (cleaned.length === 0) {
        return trimmed;
      }

      return cleaned;
    }
  }

  return trimmed;
}
