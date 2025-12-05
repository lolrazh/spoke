# Cloudflare AI Gateway Caching Strategy

## Overview

This document outlines caching optimization opportunities for Sonic Flow's LLM pipeline using Cloudflare AI Gateway's built-in caching capabilities.

## Current State

As of implementation, caching has been **enabled via the Cloudflare AI Gateway dashboard** but not yet configured at the code level with custom cache headers.

## Performance Analysis

### Worker Overhead (Current)

The routing logic and runtime configuration in our Worker adds minimal overhead:

- **Routing logic** (`selectLLMRoute()`): ~0.1-0.5ms
  - Text normalization
  - 3 regex pattern matches
  - Word count calculation
  - Conditional logic

- **Runtime config parsing** (`getRuntimeConfig()`): ~0.1ms
  - Environment variable reads
  - String parsing

- **Total Worker overhead**: ~1-2ms

### Request Latency Breakdown

```
Total Request Time = Worker Overhead + Gateway Overhead + Provider API Time
                   = ~1-2ms         + ~10-20ms         + 500-2000ms
```

**Key Finding**: Worker code overhead is <1% of total latency. The bottleneck is provider API response time.

### Workers Plan Consideration

**Free Plan**:
- CPU time: 10ms per request
- Duration: 30 seconds wall time
- More frequent cold starts

**Paid Plan Benefits**:
- CPU time: 50ms (Standard) or unlimited (Unbound)
- No duration limit
- Fewer cold starts

**Recommendation**: Don't upgrade solely for routing performance. Your current routing logic (~0.5ms) is well within the free plan's 10ms CPU limit. Consider paid plan only for:
- Heavy CPU processing (not applicable)
- Better WebSocket stability for long sessions
- Cold start reduction (marginal benefit)

## Caching Potential

### How AI Gateway Caching Works

When requests pass through the gateway:

1. Gateway computes cache key from: endpoint, model, messages, parameters
2. **Cache HIT**: Returns from edge (~10-50ms)
3. **Cache MISS**: Forwards to provider, caches response, returns (~500-2000ms)

**Result**: Repeated/similar requests become 10-20x faster.

### Expected Performance Impact

#### Dictation Mode (Conservative Estimate)
- Common phrases (10-20% of requests): 80% latency reduction
- Unique content (80-90% of requests): No change
- **Average improvement: ~10-15%**

#### Edit Mode (Conservative Estimate)
- Common instructions (30-50% of requests): 85% latency reduction
- Unique combinations (50-70% of requests): No change
- **Average improvement: ~25-40%**

#### Best Case (Power Users)
- Edit mode: 50-70% faster on average
- Dictation: 20-30% faster on average

### Why Edit Mode Benefits More

Edit instructions are often repeated:
- "make it shorter"
- "fix grammar"
- "capitalize first letter"

Similar text + similar instruction → same result → high cache hit rate

## Implementation Options

### Option 1: Request-Level Cache Headers (Recommended)

Add cache control headers to provider fetch calls:

```typescript
// In cerebras.ts, groq.ts, baseten.ts, etc.
const res = await fetch(CEREBRAS_LLM_ENDPOINT, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'cf-aig-cache-ttl': '3600', // Cache for 1 hour (seconds)
  },
  body: JSON.stringify(body),
  signal: controller.signal,
});
```

### Option 2: Dynamic Cache Control

Pass cache config through options:

```typescript
// Update ChatCompleteOptions type
export type ChatCompleteOptions = {
  apiKey: string;
  model?: string;
  // ... existing fields
  cacheTtl?: number; // Optional: cache TTL in seconds
  skipCache?: boolean;
};

// Then in fetch call:
headers: {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  ...(opts.cacheTtl && { 'cf-aig-cache-ttl': String(opts.cacheTtl) }),
  ...(opts.skipCache && { 'cf-aig-skip-cache': 'true' }),
}
```

## Recommended Caching Strategy

### Dictation Mode: Short TTL (5-10 minutes)

**Rationale**: Dictation is mostly unique, but users repeat common phrases.

```typescript
export const LLM_DEFAULT_CACHE_TTL = 300; // 5 minutes
```

### Edit Mode: Longer TTL (1-24 hours)

**Rationale**: Edit instructions have higher reuse patterns.

```typescript
export const EDIT_LLM_DEFAULT_CACHE_TTL = 3600; // 1 hour
```

### STT: No Caching

**Rationale**: Audio files are always unique. Skip cache overhead.

```typescript
// Don't add cf-aig-cache-ttl header to STT endpoints
```

## Implementation Steps

### Step 1: Update Config Constants

Add to `worker/src/config.ts`:

```typescript
export const LLM_DEFAULT_CACHE_TTL = 300; // 5 minutes
export const EDIT_LLM_DEFAULT_CACHE_TTL = 3600; // 1 hour
```

### Step 2: Update Runtime Config Type

Add to `worker/src/config/runtime.ts`:

```typescript
export type RuntimeConfig = {
  llm: {
    // ... existing fields
    cacheTtl: number;
  };
  edit: {
    // ... existing fields
    cacheTtl: number;
  };
};

// In getRuntimeConfig():
return {
  llm: {
    // ... existing fields
    cacheTtl: Number(env.LLM_CACHE_TTL) || LLM_DEFAULT_CACHE_TTL,
  },
  edit: {
    // ... existing fields
    cacheTtl: Number(env.EDIT_LLM_CACHE_TTL) || EDIT_LLM_DEFAULT_CACHE_TTL,
  },
};
```

### Step 3: Update ChatCompleteOptions

Add to `worker/src/services/llm/index.ts`:

```typescript
export type ChatCompleteOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  userContent: string;
  stream?: boolean;
  temperature?: number;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  providerConfig?: Record<string, any>;
  extraHeaders?: Record<string, string>;
  cacheTtl?: number; // ← Add this
};
```

### Step 4: Update All Provider Files

Modify fetch calls in:
- `worker/src/services/llm/cerebras.ts`
- `worker/src/services/llm/groq.ts`
- `worker/src/services/llm/baseten.ts`
- `worker/src/services/llm/openai.ts`
- `worker/src/services/llm/openrouter.ts`

```typescript
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(opts.cacheTtl && { 'cf-aig-cache-ttl': String(opts.cacheTtl) }),
  },
  body: JSON.stringify(body),
  signal: controller.signal,
});
```

### Step 5: Wire Through WebSocket Handler

Update `worker/src/handlers/ws.ts`:

```typescript
// Line ~854 (dictation LLM)
const llmRes = await chatCompleteByProvider(provider, {
  apiKey: apiKeyForProvider,
  model,
  systemPrompt: buildLLMSystemPrompt({ ... }),
  userContent: finalText,
  cacheTtl: runtime.llm.cacheTtl, // ← Add this
  // ... rest of options
});

// Line ~731 (edit LLM)
const editRes = await chatCompleteByProvider(provider, {
  apiKey: apiKeyForProvider,
  model,
  systemPrompt: buildEditSystemPrompt({ sttPrompt }),
  userContent: editPlan.prompt,
  cacheTtl: runtime.edit.cacheTtl, // ← Add this
  // ... rest of options
});
```

### Step 6: Add Cache Monitoring

Track cache performance in provider files:

```typescript
const headersAt = Date.now();
const cacheStatus = res.headers.get('cf-cache-status'); // 'HIT', 'MISS', 'EXPIRED'

span.setAttribute('cache.status', cacheStatus || 'UNKNOWN');
span.setAttribute('cache.hit', cacheStatus === 'HIT');

if (cacheStatus === 'HIT') {
  console.log(JSON.stringify({
    event: 'llm.cache_hit',
    provider,
    model,
    ttfb_ms: headersAt - startAt,
  }));
}
```

## Cache Key Behavior

Gateway automatically creates cache keys from:
- **Endpoint** (e.g., `/cerebras/chat/completions`)
- **Model** (e.g., `llama-3.3-70b`)
- **Messages** (system + user content)
- **Parameters** (temperature, top_p, etc.)

**Important**: Identical requests = cache hit. Even 1 character difference = cache miss.

## Trade-offs

### Pros
- ✅ Dramatic latency reduction for repeated patterns
- ✅ Lower costs (cached requests don't hit provider)
- ✅ Better UX for power users
- ✅ Zero code complexity (just headers)
- ✅ Already enabled via dashboard (testing in progress)

### Cons
- ⚠️ Stale responses if models update (mitigated by TTL)
- ⚠️ Privacy: cache stored on Cloudflare edge (already using gateway)
- ⚠️ Initial requests still slow (cache warmup)
- ⚠️ Low hit rate for unique dictation content

## Testing & Tuning

1. **Monitor cache hit rates** via Sentry spans and console logs
2. **Start conservative**: 5min dictation, 1hr edit
3. **Tune TTL** based on observed hit rates
4. **Track metrics**:
   - Cache hit percentage
   - Latency reduction on hits
   - Cost savings

## Alternative: Dashboard-Only Configuration

**Current Status**: Enabled via Cloudflare AI Gateway dashboard.

**Limitations**:
- No per-request control
- No mode-specific TTLs (dictation vs edit)
- Limited observability
- Uniform TTL across all requests

**Advantages**:
- Zero code changes
- Immediate testing
- Easy to enable/disable

## Recommended Next Steps

1. **Test current dashboard configuration** - Monitor performance for 1-2 weeks
2. **Measure baseline cache hit rates** - Check AI Gateway analytics
3. **If hit rates >15%**: Implement code-level headers for granular control
4. **If hit rates <10%**: May not be worth code complexity

## Provider-Specific Notes

### Cerebras (Current Default)
- Endpoint: `https://gateway.ai.cloudflare.com/.../cerebras/chat/completions`
- Models: `llama-3.3-70b` (dictation), `qwen-3-235b-a22b-instruct-2507` (edit)
- Already behind gateway ✓

### Groq
- Endpoint: `https://gateway.ai.cloudflare.com/.../groq/chat/completions`
- Naturally fast (~100ms TTFB), caching less impactful
- Already behind gateway ✓

### Baseten
- Endpoint: `https://gateway.ai.cloudflare.com/.../baseten/v1/chat/completions`
- Slower baseline, caching more impactful
- Already behind gateway ✓

### OpenAI
- Endpoint: `https://api.openai.com/v1/chat/completions`
- **NOT behind gateway** - direct connection
- Would need gateway URL to enable caching

### OpenRouter
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- **NOT behind gateway** - direct connection
- Would need gateway URL to enable caching

## References & Sources

- [Cloudflare AI Gateway Overview](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway Features Documentation](https://developers.cloudflare.com/ai-gateway/features/)
- [AI Gateway Caching Documentation](https://developers.cloudflare.com/ai-gateway/features/)
- [Cerebras API Documentation](https://inference-docs.cerebras.ai/api-reference/chat-completions)
- [Cerebras via Cloudflare Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/cerebras/)
- [AI Gateway August 2025 Refresh](https://blog.cloudflare.com/ai-gateway-aug-2025-refresh/)
- [Cloudflare Workers Pricing](https://www.cloudflare.com/developer-platform/products/ai-gateway/)

---

**Document Status**: Planning phase
**Dashboard Caching**: Enabled (testing in progress)
**Code Implementation**: Not yet implemented
**Last Updated**: December 2025
