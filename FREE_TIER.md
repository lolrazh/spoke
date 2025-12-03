# Free Tier Quota Implementation Plan

## Overview

Two systems, two purposes:
- **Postgres (profiles table)** — Quota enforcement (must be accurate)
- **Analytics Engine** — Dev insights (aggregate metrics, free)

---

## Phase 1: Quota Enforcement

### Schema

You already have `words_used_this_month` and `quota_reset_date` from the earlier migration. If not, run:

```sql
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS words_used_this_month INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS quota_reset_date TIMESTAMPTZ;
```

### Atomic Quota Function

Single function that checks quota AND increments in one call. Prevents race conditions.

```sql
CREATE OR REPLACE FUNCTION check_and_increment_quota(
  p_user_id UUID,
  p_word_count INTEGER,
  p_limit INTEGER DEFAULT 2000
)
RETURNS TABLE(allowed BOOLEAN, words_after INTEGER) AS $$
DECLARE
  v_reset_date TIMESTAMPTZ;
  v_current INTEGER;
BEGIN
  -- Lock row to prevent concurrent updates
  SELECT words_used_this_month, quota_reset_date
  INTO v_current, v_reset_date
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Lazy reset if new month
  IF v_reset_date IS NULL OR v_reset_date < NOW() THEN
    v_current := 0;
    v_reset_date := DATE_TRUNC('month', NOW() + INTERVAL '1 month');
  END IF;
  
  -- Deny if already over limit
  IF v_current >= p_limit THEN
    RETURN QUERY SELECT FALSE, v_current;
    RETURN;
  END IF;
  
  -- Increment
  UPDATE profiles SET
    words_used_this_month = v_current + p_word_count,
    quota_reset_date = v_reset_date
  WHERE id = p_user_id;
  
  RETURN QUERY SELECT TRUE, v_current + p_word_count;
END;
$$ LANGUAGE plpgsql;
```

### Worker Integration

In `ws.ts`, after transcription completes:

```typescript
// Count words in final text
const wordCount = (finalText || '').split(/\s+/).filter(Boolean).length;

// For free users, check and increment quota
if (!jwtResult.subscriptionActive) {
  const { data, error } = await supabase.rpc('check_and_increment_quota', {
    p_user_id: jwtResult.userId,
    p_word_count: wordCount,
    p_limit: 2000
  });
  
  if (error || !data?.[0]?.allowed) {
    // Close with quota exceeded code
    ws.close(4021, 'Monthly quota exceeded');
    return;
  }
}

// Pro users: just increment without checking (for usage stats)
// Or skip entirely if you don't care about Pro user word counts
```

### New Close Code

Add to `auth/index.ts`:

```typescript
export const WS_CLOSE_CODES = {
  UNAUTHORIZED: 4010,      // Invalid/expired JWT
  PAYMENT_REQUIRED: 4020,  // No subscription
  QUOTA_EXCEEDED: 4021,    // Free tier limit hit
  AUTH_TIMEOUT: 4011,      // No auth message in time
} as const;
```

### App Error Handling

In `useTranscription.ts`, handle 4021:

```typescript
if (closeCode === 4021) {
  setAuthError("quota_exceeded");
  setError("Monthly limit reached. Upgrade for unlimited dictation.");
}
```

---

## Phase 2: Analytics Engine

### Enable (Cloudflare Dashboard)

1. Workers & Pages → Your worker → Settings
2. Find "Analytics Engine" section
3. Add binding name: `ANALYTICS`

### Add to wrangler.toml

```toml
[analytics_engine_datasets]
ANALYTICS = "sonic_flow_events"
```

### Write Events (in ws.ts after successful transcription)

```typescript
try {
  c.env.ANALYTICS?.writeDataPoint({
    blobs: [
      session.traceId,
      pipeline,           // 'stt', 'stt+llm', 'edit'
      sttProvider,        // 'groq', 'deepgram', 'fireworks'
      llmModel || 'none',
    ],
    doubles: [
      wordCount,
      e2eMs || 0,
      sttMs || 0,
      llmMs || 0,
    ],
    indexes: [jwtResult.userId],
  });
} catch {
  // Silent fail - analytics shouldn't break transcription
}
```

### Query (GraphQL API or Dashboard)

Cloudflare dashboard gives you automatic visualizations. For custom queries:

```graphql
{
  viewer {
    accounts(filter: { accountTag: "your-account-id" }) {
      sonic_flow_events(limit: 10000) {
        dimensions { blob2 }  # pipeline
        quantiles { double2P95 }  # P95 e2e latency
        count
      }
    }
  }
}
```

---

## What You're NOT Doing

- **dictation_logs table** — Skip for now. Analytics Engine covers dev needs. Add later only if you want user-facing session history.
- **Vanity metrics** (`total_words_transcribed`, `dictation_count`, `last_dictation_at`) — Skip. Add later if you want "You've transcribed 50k words!" features.
- **Sentry/PostHog** — Separate decision. Not related to quota or analytics architecture.

---

## Cost

- Supabase Pro: $25/month (you're probably already on this)
- Analytics Engine: Free (included with Workers paid plan)

---

## Order of Operations

1. Run SQL migration (if columns don't exist)
2. Create `check_and_increment_quota` function
3. Update Worker to call it after transcription
4. Add 4021 close code and app error handling
5. Enable Analytics Engine binding
6. Add `writeDataPoint` call to Worker
7. Deploy and test