# Vocabulary Learning System

## The Core Problem

Whisper consistently gets certain words wrong:
- Proper nouns: "Groq" → "grok", "Anthropic" → "antropic"
- Multi-word corrections: "Base 10" → "Baseten"
- Technical terms: "PostgreSQL" → "postgres quill"
- Personal names: Custom spellings
- Domain vocabulary: Medical, legal, technical terms

These errors are **systematic** - they happen every time. Users correct them every time. That's wasted effort.

**Solution:** Learn from corrections automatically. No manual dictionary. Zero friction.

---

## Design Philosophy: It's 2025, Not 1995

### No Manual Dictionary

**The Question:** Would Steve Jobs build dictation software with a dictionary dashboard?

**The Answer:** No. He'd make it fucking work without asking users to manage vocabulary.

**Dragon Dictate had manual dictionaries 20 years ago. Why is that still a thing?**

We're building the future of software. The future doesn't come with a "Manage Vocabulary" dashboard.

**Core Principle:**
- ❌ Don't make the user do the work
- ✅ Make the algorithm smart enough
- ❌ Don't shift complexity to the UI
- ✅ Fix the problem, don't give the user a workaround

If we need a dictionary UI to handle "Base 10" → "Baseten", **we haven't solved the problem - we've just made it the user's problem.**

---

## The Three-Tier System (Phased Approach)

### Tier 1: Whisper Vocabulary

**What:** Pass learned words to Whisper's prompt parameter
**Limit:** ~200 words (Whisper's token limit)
**How:** "Your vocabulary includes: Groq, Anthropic, PostgreSQL..."

**Example:**
- You say "Groq"
- Whisper has "Groq" in vocabulary
- Whisper transcribes "Groq" correctly ✓

### Tier 2: LLM Disambiguation (When Needed)

**What:** When homophones exist, let LLM pick the right one
**When:** Only triggered if multiple words sound the same
**How:** Add context to LLM prompt

**Example:**
- Whisper outputs "grok"
- Database has both "Groq" (inference provider) and "Grok" (AI model)
- LLM sees context: "using grok for API calls"
- LLM picks: "Groq" ✓

### Tier 3: Learn from Corrections

**What:** Detect when user fixes mistakes, learn the pattern
**How:** Diff-based detection after insertion
**Confidence:** Only learn high confidence corrections automatically

**Example:**
- Whisper: "using Base 10 for this"
- User fixes: "using Baseten for this"
- System detects via diff: "Base 10" → "Baseten"
- Auto-learns (high confidence) → Stored
- Next time: Whisper recognizes "Baseten" ✓

---

## The Database (Super Simple)

```sql
CREATE TABLE vocabulary (
  word TEXT PRIMARY KEY,           -- Correct spelling: "Groq", "Baseten"
  frequency INTEGER DEFAULT 1,     -- Usage count (for ranking)
  last_used INTEGER                -- Timestamp (for pruning)
);

CREATE INDEX idx_frequency ON vocabulary(frequency DESC);
```

**That's it.** No `whisper_hears`, no `context`, no complexity for MVP.

**Why so simple?**
- We learn what words SHOULD exist, not mappings
- Diff-based detection handles multi-word corrections automatically
- Context can be added later if needed (homophones)

**Examples:**
- `("Groq", 5, ...)`
- `("Baseten", 2, ...)`
- `("Anthropic", 3, ...)`

**Storage:** `~/Library/Application Support/Sonic Flow/vocabulary.db`

---

## How Detection Works (Diff-Based Approach)

### Why Not N-grams?

**Initial approach:** Generate 1-grams, 2-grams, 3-grams from entire sentence.

**Problem:** For a 10-word sentence:
- 10 unigrams + 9 bigrams + 8 trigrams = 27 n-grams
- Check each against every edited word
- Works, but feels wasteful

**Insight:** If we're using diff, we already GET the multi-word changes automatically!

### Diff-Based Detection (The Smart Way)

**How it works:**

1. **Run diff to find what changed:**
   ```
   Original: "Let's use Base 10 for inference"
   Edited:   "Let's use Baseten for inference"

   Diff:
   - DELETE: "Base 10"
   - INSERT: "Baseten"
   - KEEP: everything else
   ```

2. **Compare deleted vs inserted segments:**
   ```
   "Base 10" vs "Baseten"
   Edit distance: 3
   Similarity: ~57%
   Confidence: Medium → Learn it
   ```

3. **Store the correction:**
   ```sql
   INSERT INTO vocabulary (word, frequency, last_used)
   VALUES ("Baseten", 1, NOW());
   ```

**Benefits:**
- ✅ Naturally handles multi-word corrections ("Base 10" → "Baseten")
- ✅ Only looks at what changed (efficient)
- ✅ No n-gram complexity needed
- ✅ Works for 1-word, 2-word, 3-word corrections automatically

**Example test cases:**
```
✓ "grok" → "Groq" (single word)
✓ "Base 10" → "Baseten" (multi-word to single)
✓ "postgres quill" → "PostgreSQL" (multi-word to single)
✓ "my cardial infection" → "myocardial infarction" (multi-word)
✗ "cat" → "dog" (too different, ignore)
✗ "follow" → "fall off" (word count changed, ignore)
```

---

## Confidence Scoring (Automatic Learning)

### The Problem: Not All Corrections Are Vocabulary

**Type 1: Vocabulary Errors** (Systematic - SHOULD learn)
```
User says: "I'm using Groq"
Whisper hears: "I'm using grok"
User fixes: → "Groq"
✅ Will happen every time → Learn it automatically
```

**Type 2: Acoustic Mishearings** (Random - should NOT learn)
```
User says: "fall off"
Whisper hears: "follow"
User fixes: → "fall off"
❌ One-time mistake → Don't learn it
```

If we learn Type 2, we create problems: next time you actually say "follow", we'd incorrectly change it.

### Confidence Calculation

```typescript
function calculateConfidence(from: string, to: string): number {
  const distance = levenshteinDistance(from.toLowerCase(), to.toLowerCase());
  const maxLen = Math.max(from.length, to.length);
  const similarity = 1 - (distance / maxLen);

  // High similarity = likely vocabulary
  if (similarity > 0.7) return 0.9;  // Auto-learn
  if (similarity > 0.5) return 0.6;  // Consider
  return 0.3;                        // Ignore
}
```

**Learning Rules:**
- **High confidence (>0.7):** Auto-learn silently
- **Medium confidence (0.5-0.7):** Requires multiple occurrences
- **Low confidence (<0.5):** Ignore (probably mishearing)

**Examples:**
- "grok" → "Groq": 75% similar → Auto-learn ✓
- "Base 10" → "Baseten": 57% similar → Auto-learn ✓
- "follow" → "fall off": 14% similar → Ignore ✓
- "cat" → "dog": 0% similar → Ignore ✓

---

## Edge Cases & Design Decisions

### Multi-Word Corrections (The Critical Test)

**Problem:** "Base 10" → "Baseten"

**Old approach (word-by-word):**
- Detects "Base" → "Baseten" (wrong!)
- Misses that "10" was part of it

**New approach (diff-based):**
- Diff shows: DELETE "Base 10", INSERT "Baseten"
- Compares the segments directly
- Learns "Baseten" (correct!)

**This was the key insight that validated diff-based detection.**

### Homophones (Future Problem)

**Example:** "Groq" (API provider) vs "Grok" (AI model from xAI)

**MVP approach:**
- Learn both words separately
- LLM disambiguates using surrounding context
- No manual context needed

**Future approach (if needed):**
- Add optional context column to database
- User can add context via speech: "That's Groq the inference provider"
- LLM extracts and stores context

**For now:** Keep it simple. Let LLM handle disambiguation.

### Spelled-Out Words

**Scenario:** User dictates "spell it G-R-O-Q"

**What Whisper outputs:** "spell it G. R. O. Q." (with periods)

**MVP approach:**
- User fixes manually to "Groq"
- We learn "Groq" from the correction
- Works, but requires one manual fix

**Future approach:**
- LLM detects spelling pattern
- Extracts "GROQ" → "Groq"
- Auto-adds to vocabulary
- Next time works immediately

**For MVP:** Manual fix is acceptable. Optimize later if users hit this often.

### Verbs and Common Words

**Observation:** Words like "replace"/"replay", "follow"/"fall off" are verbs and common words.

**Strategy:**
- These get lower confidence scores (moderate similarity but high ambiguity)
- Require multiple occurrences before learning
- Less likely to be vocabulary, more likely to be mishearings

**The algorithm naturally handles this** via confidence scoring.

---

## Testing Strategy: Dataset-Driven Development

### The Old Way (Manual Testing)
- Click through playground examples
- Manually verify each one
- Inconsistent, slow, error-prone

### The New Way (Systematic Testing)

**Dataset of test cases:**
```javascript
[
  {
    original: "using grok",
    corrected: "using Groq",
    expected: "should-detect"
  },
  {
    original: "using Base 10",
    corrected: "using Baseten",
    expected: "should-detect"  // THE KEY TEST
  },
  {
    original: "cat sat",
    corrected: "dog ran",
    expected: "should-ignore"
  }
]
```

**Automated validation:**
- Run algorithm against all test cases
- Check: Did it detect what it should? Did it ignore what it should?
- Show pass/fail for each case
- Tune algorithm parameters, re-run
- Iterate until all tests pass

**Table view:**
```
┌────────────────┬────────────────┬──────────────┬──────────┬────────┐
│ Original       │ Corrected      │ Detected     │ Expected │ Result │
├────────────────┼────────────────┼──────────────┼──────────┼────────┤
│ using grok     │ using Groq     │ grok → Groq  │ ✓        │ ✅ PASS│
│ using Base 10  │ using Baseten  │ Base10→      │ ✓        │ ✅ PASS│
│                │                │ Baseten      │          │        │
│ cat sat        │ dog ran        │ (none)       │ ✓        │ ✅ PASS│
└────────────────┴────────────────┴──────────────┴──────────┴────────┘
```

**This lets us:**
- Systematically test every edge case
- Tune confidence thresholds
- Compare different algorithms
- Ensure we don't regress
- Add new test cases as we discover issues

**Playground:** `src/lib/vocabulary/playground-dataset.html`

---

## User Experience

### Completely Invisible (Default)

**What the user sees:** Nothing.

**What happens:**
1. You dictate
2. Get "using grok for this"
3. Fix it to "using Groq for this"
4. Keep working
5. Next dictation with "Groq" → It just works now

**No popups, no dialogs, no confirmations, no dictionary UI.**

**The app just gets smarter silently.**

### Why No Manual Dictionary?

**Arguments against:**
- "But users might want to pre-load medical terms!"
- "But what about power users who want control!"
- "But Dragon Dictate had this!"

**Counterarguments:**
- It's 2025. Make it work without asking users to manage vocabulary.
- If the algorithm can't handle it, fix the algorithm, not the UX.
- Manual dictionaries become abandoned databases nobody maintains.
- 95% of users never use them, 5% who do get frustrated.

**Core belief:**
The future of software is not dictionaries and dashboards. It's software that learns and adapts invisibly.

**If we need a UI to make it work, we haven't solved the problem.**

---

## Phased Implementation

### Phase 1: Foundation (Week 1 - MVP)
- ✅ SQLite database (simple schema: word, frequency)
- ✅ Diff-based correction detection
- ✅ Automatic learning (high confidence only)
- ✅ Pass top 200 to Whisper prompt
- ✅ Dataset test playground

**Goal:** Validate that automatic learning works for 80%+ of cases

**Shipped:** Detection algorithm + playground for testing

### Phase 2: Integration (Week 2)
- ⏳ Monitor text after insertion (poll via AX inspection)
- ⏳ Integrate detector into useTranscription hook
- ⏳ Store learned words in database
- ⏳ Update buildSTTPrompt to include learned vocabulary

**Goal:** End-to-end learning flow working

### Phase 3: Polish (Week 3)
- ⏳ Tune confidence thresholds based on real usage
- ⏳ Frequency-based ranking (top 200 words)
- ⏳ Pruning old/unused words
- ⏳ Handle edge cases discovered in testing

**Goal:** Production-ready, reliable

### Future (If Users Need It)
- ❌ LLM-based disambiguation for homophones
- ❌ Explicit spelling commands ("spell it G-R-O-Q")
- ❌ Context extraction from speech
- ❌ Import vocabulary from documents

**But:** Only build these if users actually hit the limitations. Start lean.

---

## Technical Details

### Diff Algorithm (Simplified)

```typescript
function diffWords(original: string, edited: string) {
  const origWords = original.split(/\s+/);
  const editWords = edited.split(/\s+/);

  // Find matching and non-matching segments
  // Returns: [{ deleted: ["Base", "10"], inserted: ["Baseten"] }]
}
```

**Key insight:** The diff algorithm naturally groups consecutive changes, so "Base 10" stays together.

### Whisper Prompt Integration

```typescript
// Get top 200 most frequently used learned words
const topWords = db.query(`
  SELECT word FROM vocabulary
  ORDER BY frequency DESC
  LIMIT 200
`);

// Add to existing STT prompt
const prompt = `Your vocabulary includes: ${topWords.join(', ')}`;
```

### Detection Integration

```typescript
// After text insertion
const inserted = "using grok for this";

// Monitor for changes
setTimeout(async () => {
  const current = await inspectText();
  const corrections = detectCorrections(inserted, current);

  for (const correction of corrections) {
    if (correction.confidence > 0.7) {
      db.learn(correction.to);  // Auto-learn
    }
  }
}, 3000);
```

---

## Why This Approach Works

### Self-Improving
- Week 1: Learning your vocabulary (some corrections needed)
- Month 1: Rarely makes vocabulary mistakes
- Gets smarter with use, no maintenance

### Zero Maintenance
- No manual entry required
- No dictionary to manage
- No decision fatigue
- Just works in background

### Handles Edge Cases
- Multi-word corrections: Diff handles automatically
- Homophones: LLM disambiguates
- Spelled-out words: Learn from manual correction
- All without UI complexity

### Privacy First
- All data stored locally (SQLite on your machine)
- Nothing sent to cloud except during transcription
- No sync, no accounts, no servers

---

## Success Metrics

**Week 1 (MVP):**
- Algorithm detects 90%+ of test cases correctly
- Diff-based approach handles "Base 10" → "Baseten" ✓

**Month 1:**
- System learns 10+ words per active user
- 80% reduction in repeated vocabulary errors
- Zero complaints about "dictionary UI missing"

**Month 3:**
- 95% reduction in repeated vocabulary errors
- System feels invisible - "it just works"
- Users don't think about vocabulary anymore

---

## The Philosophy in Action

**Traditional dictation:** "Here's what I heard. If it's wrong, add it to your dictionary."

**Sonic Flow:** "Here's what I heard. If you fix it, I'll remember. Next time I'll get it right."

It's the difference between asking the user to manage complexity and making the software adapt intelligently.

**It's 2025. We can do better than dictionary dashboards.**

---

*This document represents our commitment to zero-friction vocabulary learning. No manual work, no interruptions, just software that gets smarter as you use it.*