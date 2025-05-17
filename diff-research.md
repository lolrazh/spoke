# Text Diffing in Streaming Speech-to-Text with Overlapping Chunks

## Introduction

Streaming speech-to-text (STT) systems often split incoming audio into consecutive chunks for real-time processing. To maintain continuity and avoid cutting words, these chunks typically **overlap** in time (stride-based chunking). For example, an application might process 5-second audio segments with a 2-second overlap between consecutive segments. This overlap means each new chunk contains some audio already transcribed in the previous chunk, providing context for the model. However, it also causes **duplicate text** in the raw transcripts. The challenge is merging these partial, overlapping transcripts into a coherent whole *without relying on timestamps*. Below we dive into how libraries like *Transformers.js* (e.g. its WhisperTextStreaming pipeline) and *Moonshine* handle this using text diffing and overlap merging algorithms.

## Stride-Based Audio Chunking and Overlap

In overlapping or stride-based chunking, each audio segment includes a bit of the previous segment’s end. This ensures the speech recognizer has context and doesn’t miss words at boundaries. For instance, if chunk A spans 0–5s and chunk B spans 3–8s (with a 2s overlap), the spoken words during 3–5s are input to the model twice. Ideally, chunk A and chunk B’s transcriptions will share those overlapping words at their boundary. The goal is to leverage that redundancy for accuracy, then remove the duplication in post-processing. Overlap helps prevent partial words or context loss at segment edges, at the cost of needing a smart merging step.

## Overlapping Transcripts and the Need for Diff/Merge

After each chunk is transcribed, you end up with a series of text snippets, each covering its chunk of audio. Due to the overlapping audio, **the text at the end of one chunk will be repeated at the start of the next chunk’s transcript**. If we naively concatenate the outputs, those repeated words appear twice. For example, chunk A might yield:

* *"... **how are**"*

and chunk B might yield:

* *"**how are** you doing today?"*

Simply appending B to A would produce “…how are **how are** you doing today?”, which is incorrect. We need to detect the overlap “how are” and merge the texts, outputting “…how are you doing today?” instead.

Because we assume no reliable word-level timestamps, the merging must be done by comparing text content. In practice, this is handled by finding the **common overlapping substring** between the end of the previous transcript and the start of the new transcript, and then stitching the segments together without duplicating that substring. In other words, the algorithm looks at the new chunk’s text and the recent tail of the accumulated transcript to identify the longest overlap and **remove one copy** of it.

## Diffing Strategies for Merging Overlapping Text

The core strategy is a **textual diff/alignment** between consecutive chunk outputs:

* **Longest Suffix/Prefix Match:** A simple and effective method is to find the longest suffix of the previous transcript that matches a prefix of the new transcript. This works on the assumption that the overlapping audio produces identical (or very similar) text in both chunks. For example, if the end of the current finalized transcript is “…how are” and the new chunk’s result starts with “how are…”, the overlap “how are” is identified. One occurrence is then dropped so it only appears once in the merged output. This **suffix-prefix comparison** can be done at the character or word level. In code, one can slide the new text over the end of the current text to find the largest alignment. Many implementations use a loop or `difflib`-style sequence match to find this overlap efficiently.

* **Longest Common Subsequence/Substring:** In cases where there might be minor discrepancies (e.g. punctuation or slight wording differences) between the two transcripts, a more flexible diff could be used to find the largest common substring around the boundary. However, since overlap segments are usually short and should match exactly (if the model is consistent), a direct suffix-prefix match is typically sufficient and faster.

* **Local Agreement (Two-Pass Confirmation):** An advanced approach used in research (and inspired by *local agreement* streaming policies) is to only consider text *confirmed* when it appears in both the current and the next chunk’s output. Essentially, the system waits for two consecutive overlapping transcripts and takes their **longest common prefix** as the stable text to commit. Anything beyond that prefix in the latest chunk is “unconfirmed” and might change when more audio context arrives. For example, Whisper-Streaming (Macháček et al. 2023) decodes each new audio chunk and compares it with the previous result, committing only the part that didn’t change with the extra context. This ensures that errors at chunk boundaries (like a half-heard word) are corrected by the next chunk before finalizing. The confirmed portion is essentially the diff intersection of the two outputs. While this method improves accuracy at boundaries, it introduces some latency because it delays finalizing a chunk until the next chunk is processed. It also means performing extra decode passes (each chunk is decoded at least twice in overlapping fashion), which is computationally heavier.

In practice, streaming ASR systems like *Transformers.js* Whisper or Moonshine focus on the straightforward **overlap removal** approach: detect the overlapping text and merge. This can be seen as a diff operation where the duplicate segment is excised. The procedure does not require any timing information – it purely uses string matching on the transcripts.

### Merging Algorithm Example

To illustrate, here’s a high-level pseudo-code for merging transcripts on the fly using overlap diffing (suitable for a Moonshine + Transformers.js setup):

```python
final_transcript = ""
prev_text = ""  # text prompt for context

for chunk_audio in audio_stream:  # iterate over incoming audio chunks
    # 1. Transcribe the chunk, using the previous text as a prompt for continuity
    result = transcribe(chunk_audio, initial_prompt=prev_text)  
    chunk_text = result.text

    if not final_transcript:
        # First chunk, just take the text as-is
        final_transcript = chunk_text
    else:
        # 2. Find the longest overlap between end of final_transcript and start of chunk_text
        overlap = longest_suffix_prefix(final_transcript, chunk_text)
        if overlap:
            # 3. Merge by appending only the non-overlapping remainder of the new text
            # (i.e., drop the overlapping prefix of chunk_text)
            overlap_len = len(overlap)
            merged_text = chunk_text[overlap_len:]  # remove duplicate overlap
            final_transcript += merged_text
        else:
            # If no overlap found (e.g. in rare cases), just append with a space
            final_transcript += " " + chunk_text

    # 4. Update prev_text for next chunk’s prompt (e.g., last N words of final_transcript)
    prev_text = get_last_n_words(final_transcript, n=10)
```

In this pseudo-code, `longest_suffix_prefix(A, B)` finds the longest string that is both a suffix of string A and a prefix of string B. By cutting that overlap from the new chunk’s text, we avoid any duplication when concatenating. The `initial_prompt=prev_text` in the transcription call is an important detail explained below. The `prev_text` is updated to the tail of the current transcript (for example, the last few words) so that the next chunk’s transcription knows what came before.

## Prompt-Based Continuation vs. KV Cache

Modern transformer ASR models like OpenAI’s Whisper use an encoder-decoder architecture. Whisper (and Moonshine, which follows a similar API) allows providing an **initial prompt** – essentially a prefix of text tokens that the decoder should treat as already generated. Libraries like Transformers.js expose this as an `initial_prompt` or similar parameter. In a streaming scenario, this can be leveraged for *prompt-based continuation*: we feed the last portion of the already transcribed text as a prompt when processing the next audio chunk.

**How prompt-based continuation helps:** If chunk B’s audio overlaps chunk A’s audio, and we prompt the decoder of chunk B with the text from chunk A, the model is guided not to repeat that text. In the ideal case, the overlapped speech is entirely “covered” by the prompt tokens, so the decoder will focus on generating what comes *after* them. For example, if chunk A produced “Hello world,” and chunk B’s audio starts with “world” (from the overlap) and continues with “how are you?”, giving the prompt “Hello world” to chunk B’s decoder should make it output “ how are you?” (the continuation) rather than repeating “Hello world” again. In effect, the prompt **primes the model with the overlapping content**, reducing duplicate outputs.

**Diffing still needed:** In practice, prompt-based continuation greatly minimizes duplication, but a merging step is usually still implemented as a safeguard. Minor discrepancies can occur – for instance, if the model’s overlap transcription differs in punctuation or spacing despite the prompt, or if the prompt didn’t fully cover a word boundary. The diff algorithm will catch any residual overlap. Essentially, the prompt approach and diff merging work together: the prompt provides **context continuity** (and can improve accuracy), while the diff algorithm ensures no duplicate text slips through.

## Limitations of Using the KV Cache

One might wonder: instead of chunking and merging, why not use the model’s internal **key-value (KV) cache** to maintain state across streaming audio? In Transformers, KV caching refers to preserving the encoder/decoder attention states so that subsequent token generation can reuse previous computations. For language models, KV cache lets you append new tokens without re-processing the entire prefix each time. However, for Whisper-style speech models, the situation is different:

* **Encoder resets on new audio:** Whisper’s encoder processes audio frames (up to 30 seconds worth) in one go to produce a latent representation. It isn’t designed to incrementally update its encoding with new audio without reprocessing. When chunking audio, each chunk is encoded separately. There is no built-in mechanism to *append* new audio to a past encoder state (unlike an RNN, the transformer encoder has no streaming memory by default). This means for each chunk, you must run the encoder anew on that chunk’s audio. The KV cache in Whisper applies to the *decoder’s* autoregressive text generation – it caches past token states for efficiency *within* one decode session, but it doesn’t carry over semantic audio context between independent decoding sessions.

* **Decoder cache continuity is non-trivial:** Suppose we wanted to *continue* the decoder from the previous chunk instead of starting fresh. That would imply the decoder never emitted an end-of-sequence for chunk A and could continue to generate tokens as chunk B’s audio is fed in. Whisper’s decode process, however, expects the full encoder input up front. It’s not like a streaming Transformer Transducer where the model can ingest more audio frames on the fly. If we tried to reuse the decoder KV cache from chunk A and just supply new encoder output for chunk B, the model would likely misalign – the decoder has no training for partially new encoder context mid-stream. In practice, chunked Whisper decoding always *restarts* the decoder for each chunk (optionally with a prompt as noted). Indeed, the “local agreement” strategy explicitly performs **non-streaming decoding each time a chunk is received**, rather than attempting to keep the decoder running continuously with a growing KV cache.

* **Memory and error accumulation:** Even if it were possible to carry decoder state forward indefinitely, it would mean the context (KV) grows with each chunk. This could quickly exhaust memory in long audio streams. Moreover, any errors in earlier decoding would be carried forward. Using a fresh decode (with prompt) for each segment provides a clean slate for the model to reconsider the audio, often yielding better results for that segment with the benefit of new context.

Given these limitations, *viable alternatives* to chunk-and-diff have centered on model or algorithmic changes rather than naive KV reuse. Researchers have explored modified attention mechanisms and fine-tuning to allow **truly streaming Whisper** models (e.g. chunk-wise or time-restricted attention, and methods to decide when to stop decoding before a chunk ends). These approaches can reduce the need for overlapping chunks and diff-based post-processing by making the model itself stream-friendly, but they require extensive changes or fine-tuning to the model. Another alternative is to use voice activity detection (VAD) to choose chunk boundaries at natural pauses (silences) instead of fixed intervals. This can avoid splitting words or phrases, reducing the overlap needed. In practice, many real-time systems (including Moonshine and Transformers.js Whisper pipelines) stick to the proven strategy: **process audio in slightly overlapping chunks, use prompt-based continuation for context, and merge the text results by diffing out duplicates**.

## Conclusion

Text diffing is a crucial step in streaming speech-to-text pipelines that use overlapping audio chunks. By comparing the partial transcripts of consecutive chunks, the system can detect duplicate overlapped content and merge segments seamlessly. The common approach is to find the overlapping text (often via longest suffix/prefix match) and eliminate one copy, ensuring the final transcript reads naturally. This approach does not require timestamps – it operates purely on the text output. Libraries like Transformers.js (with Whisper or Moonshine models) implement this by feeding the last output as a prompt into the next chunk’s transcription and then stitching results together. They avoid trying to carry low-level model state (KV cache) across chunks, because Whisper’s architecture isn’t built for that continuous mode. Instead, the combination of overlapping context and prompt-guided decoding yields high-quality live transcriptions, with the diff/merge algorithm cleaning up any repetition.

Open-source examples of this technique include the *Whisper-Streaming* project from UFAL, which applies a longest-common-prefix merge to overlapping Whisper outputs, and various whisper.cpp-based streaming demos that use overlapping 30s windows and join the texts. In all cases, the emphasis is on **aligning by text content** to decide what’s new versus what was already said, thereby removing duplicated words and producing a coherent real-time transcript. With these strategies, streaming ASR systems can achieve low latency and maintain accuracy, delivering smooth transcripts even when the audio is processed in pieces.

**Sources:** Overlap chunk merging and local alignment methods; discussion of chunk overlap and context in Whisper streaming.
