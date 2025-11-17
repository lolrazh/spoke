/**
 * Post-processing utilities for STT transcriptions
 * Filters out common Whisper hallucinations
 */

/**
 * Removes "Thank you for watching!" hallucination from the end of transcriptions.
 * This is a common Whisper hallucination from YouTube video training data.
 *
 * @param text - The transcription text to process
 * @returns The text with hallucination removed if present
 */
export function stripHallucinations(text: string): string {
  const trimmed = text.trim();

  // Check if text ends with "thank you for watching!" (case insensitive)
  const pattern = /thank you for watching!$/i;

  if (pattern.test(trimmed)) {
    return trimmed.replace(pattern, '').trim();
  }

  return trimmed;
}
