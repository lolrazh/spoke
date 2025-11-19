# Sonic Flow's Intelligent Vocabulary: A Journey to Human-Like Memory

## The Problem Nobody's Solving

Every dictation app on the market is stupid. They either:
- Have no vocabulary learning at all (Wispr Flow)
- Force you to manually add words like it's 1995 (Dragon Dictate)
- Try to guess from global datasets (which never work for personal terms)

But here's the thing: **you already correct these mistakes every single day**. When Sonic Flow says "grow queue" and you think "Groq," that's a correction event. When you say "my name is Sandheep" and it writes "Sandeep," that's a learning opportunity.

The question isn't "should we learn vocabulary?" It's "how do we learn vocabulary without making it feel like work?"

---

## The Philosophy: Dictation Should Feel Like Talking to Someone

Think about how humans handle vocabulary in conversation:

**Human conversation:**
1. "I'm working with the Groq API"
2. "The Groq documentation says..."
3. "Send this to Groq for processing"

You don't re-explain "Groq" every time. You establish context once, then reference it naturally.

**Sonic Flow should work the same way.** If you've been talking about "Groq" for the last few minutes, the app should remember that. If your cursor is in a document that mentions "Sandheep," it should know that's your name.

The key insight: **dictation isn't isolated utterances. It's a conversation with context.**

---

## The Journey: From Over-Engineered to Elegantly Simple

### Attempt 1: The Complex Architecture (We Were Wrong)

Initially, I proposed a three-tier system:
- Session vocabulary (5 minutes)
- Personal vocabulary (persistent)
- Base vocabulary (hardcoded)

It had confidence scoring, variant detection, disambiguation rules, and complex ranking algorithms.

**Why we abandoned it:** It was trying to be too smart. We were building a vocabulary database when we should have been building a conversation memory.

### Attempt 2: The 80-90% Solution (Better, But Still Not Right)

Then I simplified: just store corrections locally, inject them into prompts, done.

**Why we improved it:** It worked for simple cases, but missed the human element. "Groq" in one context isn't the same as "Groq" in another context.

### Attempt 3: Conversation-First (The Breakthrough)

The real insight: **send your recent dictations along with every request**.

It's like you're continuing a conversation:
- "Hey LLM, remember what I just said about Groq?"
- "And look at what's around my cursor - that might give you context too."

This is human-like. When you talk to someone, you reference what you just said, and you point to things around you.

---

## The Core Architecture: Two-Layer Memory

### Layer 1: Short-Term Memory (The Conversation)

**What:** Last 5 dictations + 5 minutes expiry

**Why:** Humans remember what they just said. If you've been talking about "Groq" for 2 minutes, you don't need to re-establish that context.

**Implementation:**
```typescript
// Simple, in-memory
interface ConversationHistory {
  entries: Array<{text: string, timestamp: number}>;
  maxEntries: 5;
  expiryMs: 5 * 60 * 1000; // 5 minutes
}
```

**Example:**
```
Dictation 1: "Send this to Groq"
Dictation 2: "The Groq API is fast"
Dictation 3: "Let me check Groq docs"

→ Next dictation gets: "Recent: Send this to Groq. The Groq API is fast. Let me check Groq docs."
→ LLM understands "Groq" is established vocabulary
```

### Layer 2: Long-Term Memory (The Embedding Layer)

**What:** Embeddings-based retrieval of past corrections

**Why:** Humans have long-term memory too. You remember "myocardial infarction" from that medical report you dictated 3 months ago, especially if you're dictating in a medical document now.

**Implementation:**
```typescript
// Embed correction events, not just words
interface CorrectionEvent {
  sttText: "grow queue API",
  correctedText: "Groq API",
  context: "AI development",
  embedding: [0.123, -0.456, ...]
}
```

**Example:**
```
3 months ago: "grow queue API" → "Groq API" in AI context

Today: Dictating in code file with "GROQ_API_KEY"
→ Query: "GROQ_API_KEY AI development context"
→ Retrieve: Old "grow queue → Groq" correction
→ STT prompt includes: "Groq"
```

---

## The Technical Beauty: Leverage What We Already Have

### Existing Infrastructure (No New Dependencies)

**Selection Inspector:** Already reads surrounding text for edit mode. We can use this for dictation too.

**Dataset Logging:** Already captures `sttText` → `llmText` diffs. This is our learning signal.

**WebSocket Protocol:** Already sends metadata in `start` messages. We just add conversation history.

**Local Models:** ONNX runtime already set up for VAD. We can use this for embeddings too.

### The Elegant Part: The LLM Does the Hard Work

**We don't parse or classify.** We send context to the LLM and let it figure out what matters.

```typescript
// Before dictation
const prompt = `
You are a verbatim ASR cleaner for Sonic Flow.

<conversation_history>
Recent dictations:
1. Send this to Groq.
2. The Groq API is fast.

Use this context to understand vocabulary the user has been using.
</conversation_history>

<surrounding_text>
Text near cursor: const apiKey = process.env.GROQ_API_KEY;
</surrounding_text>

Fix the ASR input while respecting established vocabulary.
`;
```

The LLM sees "Groq" in recent history AND "GROQ" in surrounding text, so it knows to correct "grow queue" to "Groq."

---

## Why This Solves the Real Problems

### Problem 1: "Groq" vs "grok"

**Human behavior:** You say "Groq" once, then reference it naturally.

**Our solution:** Conversation history shows "I've been talking about Groq."

**Result:** LLM understands context and corrects appropriately.

### Problem 2: "Sandheep" vs "Sandeep"

**Human behavior:** You distinguish by context ("my name" vs "meeting with").

**Our solution:** Conversation history shows "My name is Sandheep with an H."

**Result:** LLM knows "Sandheep" is the user's name, "Sandeep" is someone else.

### Problem 3: Burst Dictations

**Human behavior:** You dictate multiple things in a row about the same topic.

**Our solution:** Recent dictations show the ongoing conversation.

**Result:** No need to re-establish context every time.

### Problem 4: Long-Term Memory

**Human behavior:** You remember things from previous conversations.

**Our solution:** Embeddings retrieve semantically similar corrections.

**Result:** "That medical term I used 3 months ago? I need it again."

---

## The Privacy Philosophy: Nothing Leaves Your Machine

**Short-term memory:** In-memory only, expires after 5 minutes.

**Long-term memory:** Local embeddings, stored in IndexedDB, never sent to cloud.

**Conversation history:** Sent to worker, but anonymized and temporary.

This isn't just privacy-first. It's **privacy-only**. Your vocabulary is yours.

---

## The Implementation Journey

### Phase 1: Short-Term Memory (Week 1)

**Goal:** Make dictation remember what you just said.

**What we build:**
- Conversation history class (last 5 dictations)
- Send recent dictations in `start` message
- Let LLM use conversation context

**Success metric:** If you dictate "Send this to Groq" then "The Groq API is fast" 30 seconds later, it should correctly recognize "Groq" the second time.

### Phase 2: Context Integration (Week 2)

**Goal:** Use surrounding text for additional context.

**What we build:**
- Extend selection inspector for dictation mode
- Send surrounding text in `start` message
- Enhanced LLM prompt with context sections

**Success metric:** If you're in a document mentioning "GROQ_API_KEY" and dictate "grow queue," it should correct to "Groq."

### Phase 3: Long-Term Memory (Week 3-4)

**Goal:** Remember corrections from days/weeks ago.

**What we build:**
- Local embeddings model (BGE-small, 33M params)
- Vector store in IndexedDB
- Semantic retrieval based on current context

**Success metric:** If you used "myocardial infarction" in a medical report 3 months ago, and now you're dictating in another medical document, it should remember that correction.

### Phase 4: Polish & Scale (Week 5)

**Goal:** Make it invisible and reliable.

**What we build:**
- Automatic pruning of old corrections
- Confidence scoring based on frequency
- Optional UI for viewing learned vocabulary

---

## Why This Is Revolutionary

### For Users

**Before:** Dictation apps are dumb. They don't learn, don't remember, don't adapt.

**After:** Sonic Flow remembers what you say, learns from your corrections, and gets smarter over time. It feels like talking to someone who actually listens.

### For the Product

**Differentiation:** No other dictation app has this level of intelligence. This is the "sticky" feature that makes users never want to leave.

**Technical elegance:** We leverage existing infrastructure, local models, and the LLM's intelligence rather than building complex parsing systems.

### For the Future

**Extensibility:** This architecture scales to:
- Domain-specific vocabulary (medical, legal, technical)
- Multi-language support
- Collaborative contexts (if users opt in)
- Local STT models (Whisper.cpp + MLX)

---

## The Technical Details (For Nerds)

### Short-Term Memory Implementation

```typescript
class ConversationHistory {
  private entries: Array<{text: string, timestamp: number}> = [];

  add(text: string) {
    this.entries.push({text, timestamp: Date.now()});
    if (this.entries.length > 5) this.entries.shift();

    // Expire after 5 minutes
    this.entries = this.entries.filter(
      e => Date.now() - e.timestamp < 5 * 60 * 1000
    );
  }

  getRecent(): string[] {
    return this.entries.map(e => e.text);
  }
}
```

### Long-Term Memory Implementation

```typescript
// Embed corrections, retrieve by similarity
interface CorrectionEvent {
  sttText: string;
  correctedText: string;
  context: string;
  embedding: number[]; // 384-dim vector
}

const relevant = await vectorStore.search(queryEmbedding, {
  topK: 10,
  threshold: 0.7
});
```

### The LLM Prompt Enhancement

```typescript
const prompt = `
<conversation_history>
${recentDictations.map((text, i) => `${i + 1}. ${text}`).join('\n')}
</conversation_history>

<surrounding_text>
${surroundingText}
</surrounding_text>

Fix the ASR input while respecting established vocabulary and context.
`;
```

---

## The Philosophy in Action

**This isn't just a feature. It's a different kind of intelligence.**

Traditional dictation: "Here's what I heard. Fix it if you can."

Sonic Flow: "Here's what I heard. Here's what you just said. Here's what's around your cursor. Here's what you've taught me before. Now, what did you actually mean?"

It's the difference between a dumb transcription service and a dictation assistant that actually understands you.

---

## Future Vision: Fully Local Intelligence

With the embeddings layer in place, we can go further:

**Local STT:** Run Whisper.cpp in MLX for fully offline dictation

**Advanced Memory:** Remember not just corrections, but conversation patterns

**Context Awareness:** Know that "in this codebase, 'Groq' means the API" vs "in this document, 'Groq' might mean something else"

**Privacy by Design:** All learning happens locally, no cloud processing of your data

This is dictation that respects your intelligence rather than treating you like a voice input device.

---

*This document represents the evolution of our thinking about vocabulary in Sonic Flow. It's not just about being smart—it's about being human.*