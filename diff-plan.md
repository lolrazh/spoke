**Overall Goal:** Achieve high-quality, accurate streaming transcription with robust handling of chunk overlaps and word-splitting issues, while maintaining your current good Word Error Rate (WER) and speed. We'll operate with the understanding that the output being lowercase is an acceptable trade-off for now, given the good WER.

---

**Phase 1: Robust Overlap Handling & Diagnostics**
*(Focus: Directly address the "long-word split" diffing failures and get better insight)*

*   **Item 1.1: Implement "Suspicious Overlap" Detection & Correction**
    *   **File:** `src/workers/local-worker.ts`
    *   **Task:** Enhance how `runningPrompt` is updated when a new `delta` arrives from the ASR.
        1.  Define constants for "suspicious overlap" detection:
            *   `const OL_MIN_CHARS = 3;` (minimum characters for a valid overlap)
            *   `const OL_MIN_RATIO = 0.25;` (minimum ratio of overlap length to the shorter of prev/next strings)
        2.  When a new `delta` is received and before merging it into `runningPrompt`:
            *   Calculate `actualOverlapLen = overlapLen(runningPrompt, delta);`
            *   Determine if the overlap is suspicious:
                `const isSuspicious = actualOverlapLen < OL_MIN_CHARS || (Math.min(runningPrompt.length, delta.length) > 0 && actualOverlapLen / Math.min(runningPrompt.length, delta.length) < OL_MIN_RATIO);`
            *   **If `isSuspicious`:**
                *   Log this event (e.g., "Suspicious overlap detected. Applying correction.").
                *   Implement a "rollback and replace" strategy:
                    *   Define `const ROLLBACK_WORDS = 5;` (tuneable, number of words to roll back from `runningPrompt`).
                    *   `let promptWords = runningPrompt.split(/\s+/);`
                    *   `const headWords = promptWords.length > ROLLBACK_WORDS ? promptWords.slice(0, -ROLLBACK_WORDS) : [];`
                    *   `const headPrompt = headWords.join(" ");`
                    *   `runningPrompt = mergeWithOverlap(headPrompt, delta).merged;` (This effectively prefers the new `delta`'s interpretation for the contested/rolled-back region).
            *   **Else (overlap is NOT suspicious):**
                *   `runningPrompt = mergeWithOverlap(runningPrompt, delta).merged;` (Your current logic).
        3.  The existing prompt refinements (lowercasing, punctuation stripping, *current status of token limiting*) will apply to this updated `runningPrompt`.
    *   **Rationale:** This directly targets the issue where word splits lead to ASR disagreements that simple overlap merging can't fix. It provides a corrective mechanism by allowing the newer chunk (with potentially more right-hand context) to influence the problematic boundary.

*   **Item 1.2: Add Instrumentation for Overlap & Correction Events**
    *   **File:** `src/workers/local-worker.ts`
    *   **Task:** Inside `processAvailableAudio()`, after the logic in Item 1.1:
        1.  Log the `actualOverlapLen`.
        2.  Log the `delta.length` (the length of the new text from ASR before merging).
        3.  Log whether the "suspicious overlap" correction was triggered (e.g., a boolean flag or specific message).
    *   **Rationale:** To understand how frequently poor overlaps occur, how often the correction is applied, and to help tune `OL_MIN_CHARS`, `OL_MIN_RATIO`, and `ROLLBACK_WORDS`.

*   **Item 1.3: Confirm and Standardize Current Prompt Refinement Strategy**
    *   **File:** `src/workers/local-worker.ts`
    *   **Task:**
        1.  We previously experimented with `MAX_PROMPT_TOKENS`. Let's explicitly decide and document its status. Given your current good WER, it's likely best to **keep `MAX_PROMPT_TOKENS` logic commented out/disabled for now**, relying on the "Suspicious Overlap" correction to handle issues that might arise from very long prompts if they become problematic.
        2.  Ensure the active prompt refinements are consistently:
            *   Lowercasing: `runningPrompt = runningPrompt.toLowerCase();`
            *   Trailing punctuation stripping: `runningPrompt = runningPrompt.replace(/[.,!?;:]+$/, "").trim();`
    *   **Rationale:** Provides a stable baseline for the ASR prompt while we introduce other fixes. We can revisit token limiting later if instrumentation suggests very long prompts are still an issue despite other measures.

---

**Phase 2: Proactive Chunk Boundary Improvement**
*(Focus: Reduce the likelihood of bad word splits happening in the first place)*

*   **Item 2.1: VAD-Guided Chunk Ending (Explore & Implement)**
    *   **File:** `src/workers/local-worker.ts` (primarily in audio acquisition/slicing logic)
    *   **Context:** Current fixed 7s chunks. User constraint: chunks < 10s. GPT-Advisor suggestion: VAD scan in the tail end of the chunk.
    *   **Task:**
        1.  Research and integrate a lightweight client-side VAD library (e.g., `@ricky0123/vad-web` is a common choice).
        2.  Modify audio processing before calling `asr()`:
            *   Maintain your target chunk duration (e.g., 7 seconds).
            *   In the latter part of this target window (e.g., analyze audio from second 4 to 7), use VAD to identify the last significant silence or non-speech segment of a minimum duration (e.g., >= 200ms).
            *   If a suitable VAD endpoint is found that results in a chunk length within an acceptable range (e.g., 4s to 7s, ensuring it's not too short), adjust the audio slice to end at this VAD point.
            *   If no suitable VAD endpoint is found, fall back to the fixed-duration chunk (e.g., 7s).
        3.  The `emittedSamples` and related logic will need to account for potentially variable chunk lengths if this is implemented.
    *   **Rationale:** Cutting chunks at natural speech pauses is less likely to split words, leading to cleaner ASR output and simpler diffing.

---

**Phase 3: Advanced Merging (Future, if necessary)**

*   **Item 3.1: Robust `LocalAgreement-2` with Edit Distance**
    *   **Context:** If merging issues persist even after Phase 1 & 2, or for追求 SOTA (state-of-the-art) accuracy.
    *   **Task:** Implement a `LocalAgreement-2` strategy (likely in `useTranscription.ts` for UI, or influencing how "confirmed" text is managed).
        *   Instead of simple Longest Common Prefix (LCP) for confirming text from an unconfirmed buffer, use word-level Levenshtein distance or `diff-match-patch` to find agreement, making it more tolerant to minor ASR variations.
    *   **Rationale:** Provides a more robust confirmation of transcribed text, especially if ASR output for overlaps isn't perfectly identical.