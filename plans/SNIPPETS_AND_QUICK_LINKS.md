# Snippets and Quick Links Feature Plan

This document outlines the architecture and implementation plan for two new features: **Snippets** and **Quick Links**. These features leverage the existing transcription pipeline but introduce a routing layer to handle specific voice commands for text expansion and browser navigation.

## Table of Contents
1. [Overview](#overview)
2. [Feature 1: Snippets](#feature-1-snippets)
3. [Feature 2: Quick Links](#feature-2-quick-links)
4. [Architecture & Data Flow](#architecture--data-flow)
5. [Configuration Schema](#configuration-schema)

---

## Overview

The goal is to enhance Sonic Flow's utility by allowing users to map specific voice commands to actions:
- **Snippets**: Dictate a trigger word (e.g., "email") to insert a pre-defined text block.
- **Quick Links**: Dictate a trigger word (e.g., "Cloudflare") to open a specific URL in the default browser.

Both features rely on a "Router" logic that sits between the Speech-to-Text (STT) and the Large Language Model (LLM) stages. This ensures that simple commands are processed instantly without incurring the latency or cost of LLM processing.

---

## Feature 1: Snippets

### Concept
Users can define short trigger words that expand into longer text strings. When the user dictates *only* the trigger word, the system recognizes it as a snippet command and outputs the expanded text instead of the literal transcription.

**Example:**
- **Trigger**: "email"
- **Value**: "jane.doe@sonicflow.app"
- **User Action**: Dictates "email" (and nothing else).
- **System Output**: Inserts "jane.doe@sonicflow.app" at the cursor.

### Behavior
- **Exact Match**: The feature only activates if the transcribed text matches the trigger word exactly (case-insensitive, ignoring trailing punctuation/silence).
- **Sentence Context**: If the trigger word is used within a sentence (e.g., "Send me an email"), the snippet logic is **bypassed**, and normal transcription/LLM processing occurs.
- **Bypass LLM**: Successful snippet matches skip the LLM post-processing step entirely.

---

## Feature 2: Quick Links

### Concept
Users can define trigger words that map to URLs. When recognized, the system opens the URL in the user's default web browser instead of inserting text.

**Example:**
- **Trigger**: "Cloudflare"
- **Value**: "https://dash.cloudflare.com"
- **User Action**: Dictates "Cloudflare".
- **System Output**: Opens `https://dash.cloudflare.com` in a new tab.

### Behavior
- **Exact Match**: Similar to snippets, this triggers only on an exact match of the transcribed text.
- **Action**: The server sends a specific command to the client to open the URL.
- **Browser Interaction**: The client uses the operating system's default handler to open the link.

---

## Architecture & Data Flow

The core of this implementation is the **Router**, a new logic block in the server-side processing pipeline.

### Modified Pipeline

```mermaid
graph TD
    A[Microphone] --> B[STT (Whisper)]
    B --> C{Router}
    C -- Exact Match (Snippet) --> D[Expand Text]
    C -- Exact Match (Link) --> E[Command: Open URL]
    C -- No Match --> F[LLM (Post-Processing)]
    D --> G[Client: Insert Text]
    E --> H[Client: Open Browser]
    F --> G
```

### 1. Transcription (Existing)
The audio is processed by the STT provider (e.g., Groq/Whisper) as usual. The result is a raw text string.

### 2. The Router (New)
Before sending the raw text to the LLM, the Router checks the text against the user's configuration.

**Logic:**
1. **Normalize**: Trim whitespace, remove trailing punctuation (e.g., "Email." -> "email"), and convert to lowercase.
2. **Lookup**: Check if the normalized text exists in the `Snippets` or `Quick Links` map.
3. **Decision**:
   - **If Snippet Match**: Return the expanded text immediately. Mark as `final`.
   - **If Link Match**: Return a special response type (e.g., `type: "command", action: "open_url", url: "..."`).
   - **If No Match**: Proceed to LLM processing (if enabled) or return raw text.

### 3. Client Handling (New)
The client's WebSocket message handler needs to support a new message type or payload structure for commands.

**Current `final` message:**
```json
{
  "type": "final",
  "text": "Hello world"
}
```

**Proposed `command` message (for Links):**
```json
{
  "type": "command",
  "action": "open_url",
  "url": "https://dash.cloudflare.com"
}
```

**Client Logic:**
- If `type === "final"`, insert `text` (Standard/Snippet).
- If `type === "command" && action === "open_url"`, use `window.open(url, '_blank')` or Electron's `shell.openExternal(url)`.

---

## Configuration Schema

To support these features, the user configuration (likely stored in the database or local settings and passed to the worker) needs to include these maps.

### Data Structure
```typescript
interface UserConfig {
  snippets: Record<string, string>;   // e.g., { "email": "me@example.com" }
  quickLinks: Record<string, string>; // e.g., { "twitter": "https://x.com" }
}
```

### Transport
This configuration should be passed to the Worker during the **Session Start** handshake (`type: "start"` message), similar to how `identity` is currently passed.

**Updated Start Payload:**
```json
{
  "type": "start",
  "version": 3,
  "config": {
    "snippets": {
      "email": "user@example.com",
      "address": "1234 Market St, SF, CA"
    },
    "quickLinks": {
      "dashboard": "https://dash.cloudflare.com",
      "docs": "https://sonicflow.app/docs"
    }
  }
  // ... existing fields
}
```

## Implementation Checklist

- [ ] **Client**: Add UI for managing Snippets and Quick Links.
- [ ] **Client**: Update `start` message to include `config` payload.
- [ ] **Client**: Update WebSocket handler to process `type: "command"`.
- [ ] **Worker**: Implement `Router` logic after STT and before LLM.
- [ ] **Worker**: Handle `config` parsing from `start` message.
- [ ] **Worker**: Implement `command` message generation.
