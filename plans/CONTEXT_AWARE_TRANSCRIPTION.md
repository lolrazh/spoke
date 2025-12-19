# Context-Aware Transcription Pipeline

**Epic Goal:** Make Spoke smarter about *what* the user is typing by leveraging screen context (OCR), accessibility context (AX), and textbox context (ALIGN).

**Estimated Duration:** 2-3 weeks across multiple milestones

---

## Overview

This plan covers three major features, broken into small, testable tasks:

1. **Phase 1: OCR Context** - Screenshot → Vision LLM → Proper nouns → STT vocabulary
2. **Phase 2: AX Context** - Accessibility API → Extract text → Proper nouns → STT vocabulary  
3. **Phase 3: ALIGN** - Smart text insertion with casing/spacing/punctuation awareness
4. **Phase 4: Context-Aware Textbox** - leftContext/rightContext → server-side text stitching

---

## Phase 1: OCR Context

**Goal:** Extract proper nouns from the screen and inject them into the STT prompt to improve transcription accuracy for names, brands, technical terms visible on screen.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OCR FLOW (Fire-and-Forget)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PTT Down ───┬─→ Start WS → Auth → Stream Audio ─────────────────────────┐  │
│              │                                                            │  │
│              └─→ Screenshot (main process) ───→ Send "context_ocr" msg   │  │
│                        ~5-10ms                   with base64 PNG         │  │
│                                                        ↓                 │  │
│                                            Worker receives screenshot    │  │
│                                                        ↓                 │  │
│                                            Vision LLM (Llama 4 Scout)    │  │
│                                               ~300-500ms                 │  │
│                                                        ↓                 │  │
│                                            OCR words stored in session   │  │
│                                                        ↓                 │  │
│              ←────────────────────────────────────────┘                  │  │
│              ↓                                                            │  │
│  STT called with: vocabulary = base + identity + OCR words (if ready)    │  │
│              ↓                                                            │  │
│  LLM cleanup                                                              │  │
│              ↓                                                            │  │
│  Paste                                                                    │  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Timing Insight

OCR is **fire-and-forget with optional merge**:
- OCR request fires immediately on PTT down
- If OCR completes before STT is called → words are included
- If STT is called before OCR completes → proceed without OCR words (don't block)
- Most dictations are 2-5 seconds; OCR takes ~300-500ms → usually ready in time

### Configuration

**New entries in `worker/src/config.ts`:**
```typescript
// OCR (Vision Model)
export const GROQ_OCR_ENDPOINT = 'https://gateway.ai.cloudflare.com/v1/.../groq/chat/completions';
export const GROQ_OCR_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
export const OCR_DEFAULT_PROVIDER = 'groq' as const;
export const OCR_DEFAULT_TIMEOUT_MS = 5000; // Aggressive timeout - don't block pipeline
export const OCR_MAX_WORDS = 30; // Limit vocabulary size (STT prompt limit)
```

### Output Format

**Vision LLM Response (JSON):**
```json
{"words": ["Anthropic", "Claude", "Spoke", "John Smith", "Acme Corp"]}
```

**LLM System Prompt for OCR:**
```
You are extracting proper nouns from a screenshot for speech recognition.

Extract ONLY:
- Person names (first, last)
- Company/brand names
- Product names
- Technical terms (APIs, libraries, tools)
- Unique identifiers (project names, file names)

Return JSON: {"words": ["Word1", "Word2", ...]}

Rules:
- No common words (the, and, is, etc.)
- No generic terms (button, window, menu)
- Deduplicate (no repeats)
- English words only
- If nothing notable found, return {"words": []}
```

---

## Phase 1 Tasks

### Milestone 1.1: Client-Side Screenshot Capture

**1.1.1 - Add screenshot utility in main process**
- [ ] Create `src/utils/screenshot.ts`
- [ ] Use Electron's `desktopCapturer` to capture active display
- [ ] Determine which display the Spoke bar is on (`screen.getDisplayMatching()`)
- [ ] Return base64 PNG (compressed, ~100-300KB)
- [ ] Test: Call from DevTools, verify base64 output

**1.1.2 - Expose via IPC**
- [ ] Add `take-screenshot` IPC handler in main process
- [ ] Create `window.electronAPI.takeScreenshot()` renderer interface
- [ ] Test: Call from renderer, verify round-trip works

**1.1.3 - Capture timing instrumentation**
- [ ] Add `screenshotStartMs` and `screenshotDoneMs` to metrics
- [ ] Log capture time (target: <50ms)

### Milestone 1.2: Worker OCR Endpoint

**1.2.1 - Add OCR config to `worker/src/config.ts`**
- [ ] Add `GROQ_OCR_ENDPOINT`, `GROQ_OCR_MODEL`, `OCR_DEFAULT_TIMEOUT_MS`
- [ ] Add `OCR_MAX_WORDS = 30`

**1.2.2 - Create `worker/src/services/ocr/index.ts`**
- [ ] Define `OcrResult` type: `{ words: string[] }`
- [ ] Implement `extractOcrWords(imageBase64: string): Promise<OcrResult>`
- [ ] Use Groq chat completions with vision (image in user message)
- [ ] JSON parsing with fallback (empty array on parse error)
- [ ] Test: Unit test with sample base64 image

**1.2.3 - Create OCR system prompt**
- [ ] Create `worker/src/services/ocr/prompt.ts`
- [ ] Implement proper noun extraction prompt
- [ ] Test: Verify prompt produces clean JSON output

**1.2.4 - Add timeout and error handling**
- [ ] 5s aggressive timeout (OCR_DEFAULT_TIMEOUT_MS)
- [ ] On timeout: return empty array (don't block pipeline)
- [ ] Log errors but don't fail session

### Milestone 1.3: WebSocket Protocol Extension

**1.3.1 - Add `context_ocr` message type to protocol**
- [ ] Update `src/types/protocol.ts`: Add `ContextOcrMessage` type
- [ ] Message shape: `{ type: "context_ocr", imageBase64: string }`
- [ ] Update `worker/src/handlers/ws.ts`: Handle new message type

**1.3.2 - Store OCR words in session**
- [ ] Add `ocrWords: string[]` to session state
- [ ] Add `ocrPending: boolean` flag
- [ ] Add `ocrReceivedMs?: number` timestamp

**1.3.3 - Process OCR message in worker**
- [ ] On `context_ocr` message: fire-and-forget `extractOcrWords()`
- [ ] On completion: set `session.ocrWords = result.words`
- [ ] On error: set `session.ocrWords = []`, log warning
- [ ] Use `executionCtx.waitUntil()` for non-blocking

### Milestone 1.4: STT Vocabulary Integration

**1.4.1 - Modify `buildSTTPrompt` to accept OCR words**
- [ ] Update `shared/sttPrompt.ts`
- [ ] New signature: `buildSTTPrompt({ identity, ocrWords?: string[] })`
- [ ] Merge + dedupe: `[...baseVocab, ...identityWords, ...ocrWords]`
- [ ] Limit total words (truncate if >50)

**1.4.2 - Pass OCR words to STT call**
- [ ] In `worker/src/handlers/ws.ts` where STT is called
- [ ] Build prompt: `buildSTTPrompt({ identity, ocrWords: session.ocrWords })`
- [ ] Log OCR word count in metrics

**1.4.3 - Verify end-to-end**
- [ ] Test: Screenshot with visible name → dictate that name → verify transcription
- [ ] Log: `[SF] STT prompt includes OCR words: ["Name1", "Name2"]`

### Milestone 1.5: Client Integration

**1.5.1 - Fire screenshot on PTT down**
- [ ] In `start()` function of `useTranscription.ts`
- [ ] Fire `window.electronAPI.takeScreenshot()` (don't await)
- [ ] Store promise in ref: `ocrPromiseRef`

**1.5.2 - Send screenshot to worker**
- [ ] After WebSocket connected and auth complete
- [ ] `ws.send(JSON.stringify({ type: "context_ocr", imageBase64 }))`
- [ ] Add timing: `ocrSentMs` to metrics

**1.5.3 - Optional: User setting to disable**
- [ ] Add `useOcrContext` setting (default: true)
- [ ] Check setting before capturing screenshot

### Milestone 1.6: Testing & Polish

**1.6.1 - Manual E2E test**
- [ ] Open a webpage with person's name visible
- [ ] Dictate using that name
- [ ] Verify transcription is correct

**1.6.2 - Metrics verification**
- [ ] Verify `screenshotMs`, `ocrMs` in logs
- [ ] Ensure OCR doesn't add latency to main pipeline

**1.6.3 - Edge cases**
- [ ] Multi-display: Correct display captured
- [ ] Fast dictation: OCR not ready, pipeline proceeds
- [ ] Empty screen: Empty words array, no errors

---

## Phase 2: AX Context (Accessibility API)

**Goal:** Extract proper nouns from accessibility tree (focused app, visible text elements).

### Architecture TBD
- Need to research macOS AX API in Electron
- May require native helper extension
- Similar flow to OCR: fire-and-forget with optional merge

### Research Tasks

**2.0.1 - Research macOS Accessibility API**
- [ ] What text can we extract from focused app?
- [ ] Can we get window title, selected text, visible labels?
- [ ] Performance implications?

**2.0.2 - Evaluate approach**
- [ ] Native helper (C binary) vs Electron AX APIs
- [ ] Latency budget: <100ms
- [ ] Privacy considerations

*(Detailed tasks to be added after Phase 1 completion)*

---

## Phase 3: ALIGN (Smart Text Insertion)

**Goal:** Server-side logic to intelligently insert transcription into textbox, handling casing, spacing, and punctuation.

### Problem Statement

When user dictates "hello world" into a textbox containing "The quick brown |" (cursor at end):
- Current: Inserts "Hello world." → "The quick brown Hello world."
- ALIGN: Inserts "hello world" → "The quick brown hello world"

### ALIGN Rules (Draft)

1. **Leading Space:**
   - If `leftContext` ends with letter/number and transcription starts with letter/number → add leading space
   - If `leftContext` ends with space/punctuation → no leading space

2. **Casing:**
   - If preceding char is `.!?` → capitalize first letter
   - If preceding char is `,;:` or letter → lowercase first letter
   - If at start of textbox (leftContext empty) → capitalize

3. **Trailing Punctuation:**
   - If `rightContext` starts with `.!?,;:` → don't add trailing punctuation
   - If `rightContext` starts with letter → add period/comma based on grammar
   - If `rightContext` is empty → add appropriate punctuation

4. **Overlap Deduplication:**
   - If transcription starts with same words as end of `leftContext` → trim duplicate

### Tasks TBD

*(Detailed tasks to be added after Phase 1.5 completion)*

---

## Phase 4: Context-Aware Textbox (leftContext/rightContext)

**Goal:** Capture text before and after cursor, send to server for ALIGN processing.

### Approach

1. **Capture Context:**
   - Use clipboard probe (existing `spoke-helper`)
   - Or AX API for native apps
   - Capture ~100 chars left and ~50 chars right

2. **Send to Server:**
   - New fields in `start` message: `leftContext`, `rightContext`
   - Server uses for ALIGN step

3. **Apply on Paste:**
   - Server returns `insertText` (aligned) separate from `rawText`
   - Client inserts `insertText`

### Tasks TBD

*(Detailed tasks to be added after Phase 3 completion)*

---

## Progress Tracking

### Phase 1: OCR Context
- [ ] **1.1** Client-Side Screenshot Capture (0/3 tasks)
- [ ] **1.2** Worker OCR Endpoint (0/4 tasks)
- [ ] **1.3** WebSocket Protocol Extension (0/3 tasks)
- [ ] **1.4** STT Vocabulary Integration (0/3 tasks)
- [ ] **1.5** Client Integration (0/3 tasks)
- [ ] **1.6** Testing & Polish (0/3 tasks)

### Phase 2: AX Context
- [ ] **2.0** Research (0/2 tasks)

### Phase 3: ALIGN
- [ ] TBD

### Phase 4: Context-Aware Textbox
- [ ] TBD

---

## Open Questions

1. **Screenshot Compression:** Should we resize/compress before sending? (360p vs full res)
2. **OCR Caching:** Should we reuse OCR words for consecutive dictations within N seconds?
3. **Privacy Settings:** Should OCR be opt-in or opt-out?
4. **Multi-language:** Does Llama 4 Scout handle non-English proper nouns?

---

## References

- Wispr Flow transcription pipeline (inspiration)
- `docs/TRANSCRIPTION.md` (current Spoke pipeline)
- `worker/src/config.ts` (model configuration)
- `src/hooks/useTranscription.ts` (client pipeline)

---

**Created:** 2025-12-11
**Last Updated:** 2025-12-11
**Status:** Phase 1 Planning Complete