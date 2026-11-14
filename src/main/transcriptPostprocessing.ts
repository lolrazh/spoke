import type { LocalModelFamily } from "../types/shared";
import type { CorrectionTrace } from "../../shared/contextDebug";
import {
  correctTranscript,
  prepareDictionaryCorrection,
} from "./dictionaryCorrection";
import { normalizeParakeetTranscript } from "./parakeetTranscriptNormalizer";
import { normalizeSpokenNumbers, normalizeNumberUnits } from "./spokenNumbers";
import {
  joinSpelledAcronyms,
  formatPullRequestReferences,
} from "./technicalTranscriptNormalizer";

let prepared = false;

/** Prepare regexes and vocabulary before ASR, never during final insertion. */
export function prepareTranscriptPostprocessing(
  dictionary: readonly string[],
): void {
  try {
    if (!prepared) {
      normalizeTranscript(
        'um review P R two thirty one with L O D and M C P. meet me at five thirty a m. the file is twenty megabytes, ninety percent, version two point five. type "um".',
        "parakeet",
        [],
      );
      prepared = true;
    }
    prepareDictionaryCorrection(dictionary);
  } catch (error) {
    console.warn("[STT] Transcript preparation failed:", error);
  }
}

/** One synchronous final-text path; no helper startup, pipe, or graph search. */
export function normalizeTranscript(
  text: string,
  family: LocalModelFamily | undefined,
  dictionary: readonly string[],
  trace?: CorrectionTrace[],
): string {
  let normalized = text;
  try {
    normalized = joinSpelledAcronyms(normalized);
    if (family === "nemotron") {
      normalized = normalizeNumberUnits(normalizeSpokenNumbers(normalized));
    }
    if (family === "parakeet")
      normalized = normalizeParakeetTranscript(normalized);
    normalized = formatPullRequestReferences(joinSpelledAcronyms(normalized));
  } catch (error) {
    console.warn(
      "[STT] Transcript normalization failed; keeping best text:",
      error,
    );
  }
  if (trace) trace.push({ kind: "input", source: normalized, outcome: "before-dictionary" });
  // Whisper already consumes vocabulary during decoding. Do not apply a
  // second, fuzzy vocabulary decision to its output.
  if (family === "whisper" || !Array.isArray(dictionary) || dictionary.length === 0) return normalized;
  try {
    return correctTranscript(normalized, dictionary, trace);
  } catch (error) {
    console.warn("[STT] Dictionary correction failed:", error);
    return normalized;
  }
}
