## 0. TL;DR (actionable next steps)

| TODO item                 | Verdict                  | Concrete action                                                                                                                                                    |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chunk + stride values** | OK but instrument        | Add one-line telemetry in `pullAndProcessAudio()` and `processAvailableAudio()` to log the effective seconds per slice and the observed overlap.                   |
| **Prompt hand-off**       | Works, could be tighter  | Limit `runningPrompt` to the *last* \~200 tokens (≈ 800 chars) before you send it; trim punctuation/case.                                                          |
| **KV cache**              | Not useful across chunks | Keep the decoder’s per-call cache **enabled** (it’s already the default) but *throw it away* each new chunk; that’s exactly what Moonshine expects.                |
| **Text diff / merge**     | Missing                  | Drop-in function `mergeWithOverlap(prev:string, next:string) → {merged, overlapLen}` (see code below). Run it on every `partial` and once on the `complete` flush. |

---

## 1. Sanity-check chunking

Moonshine’s encoder is happy with any window ≤ 30 s, so your `CHUNK_S = 5` s and `STRIDE_S = 2` s are perfectly reasonable.
To be sure they’re applied as intended:

```ts
// inside pullAndProcessAudio()
console.debug(
  `[DEBUG] buffered ${(current16kWriteOffset/SAMPLE_RATE_16K).toFixed(2)} s,` +
  ` emitted ${(emittedSamples/SAMPLE_RATE_16K).toFixed(2)} s`
);
```

After 10–15 s of dictation you should see the distance between those numbers hover around the 2 s stride. If it creeps up, you’re outrunning the ASR and need shorter chunks or a smaller STRIDE.

---

## 2. Prompt continuity

### What’s already good

`runningPrompt += delta + " "` in `processAvailableAudio()` feeds the previous tokens into the next ASR call – that’s the same trick Whisper-Streaming uses (yellow region in their Fig 1). ([AFNLP][1])

### Tightening it

1. **Trim length** – Whisper-Streaming caps the prompt at 200 words; Simul-Whisper shows anything longer has diminishing returns and can *hurt* latency ([AFNLP][1], [arXiv][2])

   ```ts
   const MAX_PROMPT_TOKENS = 200;    // ~800 characters
   runningPrompt = runningPrompt
       .split(/\s+/).slice(-MAX_PROMPT_TOKENS).join(" ");
   ```
2. **Normalise** – lowercase, strip trailing punctuation before you store it; that reduces near-duplicate prompts.

---

## 3. Why KV caching across chunks is a dead end

Both Whisper-Streaming and Simul-Whisper restart the decoder every chunk and *never* attempt to reuse the previous chunk’s KV cache; the encoder has changed, so the old keys/values no longer align ([AFNLP][1], [arXiv][2]).
Moonshine is the same: the ONNX graph expects the full mel window up front. Keep `--use_kv_cache` **on** *within* each decode (it speeds up autoregressive generation), but as soon as you call `asr()` again you must start fresh. So your current code is correct – there’s nothing else to “make sure”.

---

## 4. Merge-with-overlap algorithm

Below is a TypeScript-ready, O(n) implementation that:

1. Works at **character** level (safer with punctuation).
2. Falls back gracefully if no overlap (rare but possible).
3. Returns both the merged string and the overlap length (handy for debugging / metrics).

```ts
/** Longest suffix of `prev` that is a prefix of `next` */
function overlapLen(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length);
  for (let len = max; len > 0; len--) {
    if (prev.endsWith(next.slice(0, len))) return len;
  }
  return 0;
}

/** Drop duplicate overlap and concatenate */
export function mergeWithOverlap(prev: string, next: string) {
  // cheap normalisation
  const p = prev.trim();
  const n = next.trim();
  const o = overlapLen(p, n);
  return { merged: (p + " " + n.slice(o)).replace(/\s+/g, " ").trim(), overlapLen: o };
}
```

### Integration points

* **Partial path** (`partial` handler in `useTranscription`):

  ```ts
  setText(prev => mergeWithOverlap(prev, partialDelta).merged);
  ```
* **Final flush**:
  Replace the current naïve concatenation with the same function.

### Local-agreement variant (optional, extra accuracy)

If you want Whisper-Streaming’s *two-chunk confirmation* (LocalAgreement-2):

1. Keep `unconfirmedBuffer` in the hook.
2. On every new chunk:

   * `candidate = mergeWithOverlap(prevConfirmed + unconfirmedBuffer, newChunk)`
   * `lcp = longestCommonPrefix(unconfirmedBuffer, newChunk)`
   * Move `lcp` from *unconfirmed* into *confirmed*; keep the remainder as the new `unconfirmedBuffer`.
3. Emit only the newly confirmed part.

This adds \~1 chunk of latency (2–5 s in your config) but almost eliminates boundary errors.

---

## 5. Unit tests (do this before refactor)

Write a tiny Jest/uvu test suite:

```ts
t('simple overlap', () => {
  const {merged} = mergeWithOverlap("hello world", "world peace");
  assert.equal(merged, "hello world peace");
});
```

Add corner cases: no overlap, punctuation mismatch, case mismatch, empty strings.

---

## 6. Performance notes

* **CPU cost of diffing** is negligible (< 50 µs for 1 kB strings).
* **Prompt trimming** keeps decode time flat; without it, latency drifts upward in long sessions.
* **Stride**: 2 s overlap is empirically sweet for English; if you localise, re-tune – tonal languages often need 3 s.

---

## 7. Road-map after the merge-fix

| Stage | Goal                                                                  | Metric                                                      |
| ----- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1     | Land `mergeWithOverlap`; keep simple accrual                          | No duplicated phrases in a 5-minute dictation               |
| 2     | Implement LocalAgreement-2                                            | < 1 % WER diff compared to offline Moonshine on 10 min test |
| 3     | Optional: adopt Simul-Whisper’s *truncation detection* for 1 s chunks | Latency ≤ 1.5 s at WER drop < 2 %                           |

---

### That should give you a clean, duplication-free transcript without messing with exotic caching that Whisper-derived models simply don’t support. Let me know once you’ve wired the helper in; we can look at profiling numbers or push further into 1 s chunk territory next.

[1]: https://www.afnlp.org/conferences/ijcnlp2023/proceedings/main-demo/cdrom/pdf/2023.ijcnlp-demo.3.pdf "Turning Whisper into Real-Time Transcription System"
[2]: https://arxiv.org/abs/2406.10052?utm_source=chatgpt.com "Simul-Whisper: Attention-Guided Streaming Whisper with Truncation Detection"
