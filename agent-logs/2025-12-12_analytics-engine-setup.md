# 📊 CloudFlare Analytics Engine Setup & Usage

**Date:** 2025-12-12  
**Purpose:** Track performance metrics to identify bottlenecks (JWKS cold starts, slow DB calls, auth latency)

---

## 🎯 What We're Tracking

### **Event 1: `auth.jwt_verify`** 
**Tracks:** JWT verification timing (including JWKS fetch on cold start)

**Key Metrics:**
- `durationMs` - How long JWT verification took
- `coldStart` (0/1) - If > 500ms, likely JWKS fetch happened
- `success` (0/1) - Did verification succeed?
- `userId` - User ID (if successful)

**Why:** Identifies first-dictation latency caused by JWKS fetch from Supabase

---

### **Event 2: `db.quota_increment`**
**Tracks:** Database call to increment free tier quota

**Key Metrics:**
- `durationMs` - How long the DB call took
- `success` (0/1) - Did it succeed?
- `wordCount` - How many words were added to quota
- `error` - HTTP status or error message

**Why:** Shows how long worker stays alive after transcription (waitUntil keeps worker alive)

---

## 📖 How to Query Analytics

### **Access the Dashboard:**
```
Cloudflare Dashboard → Analytics & Logs → Workers Analytics Engine
```

### **Query 1: JWT Verification Performance**
```sql
SELECT
  blob1 AS user_id,
  AVG(double1) AS avg_duration_ms,
  QUANTILE(double1, 0.95) AS p95_duration_ms,
  SUM(double4) AS cold_starts,
  COUNT(*) AS total_verifications
FROM dictation_events
WHERE index1 = 'auth.jwt_verify'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY blob1
ORDER BY avg_duration_ms DESC
LIMIT 100;
```

**What it shows:**
- Average JWT verification time per user
- P95 latency (95th percentile - worst case)
- How many cold starts happened
- Total verifications

**Look for:**
- `avg_duration_ms > 500` → Frequent cold starts
- `p95_duration_ms > 1000` → JWKS fetch is slow

---

### **Query 2: Quota Increment Performance**
```sql
SELECT
  AVG(double1) AS avg_duration_ms,
  QUANTILE(double1, 0.95) AS p95_duration_ms,
  QUANTILE(double1, 0.99) AS p99_duration_ms,
  MAX(double1) AS max_duration_ms,
  COUNT(*) AS total_calls,
  SUM(CASE WHEN index3 = 'failure' THEN 1 ELSE 0 END) AS failures
FROM dictation_events
WHERE index1 = 'db.quota_increment'
  AND timestamp > NOW() - INTERVAL '24' HOUR;
```

**What it shows:**
- Average database call time
- P95/P99 latency (worst cases)
- Maximum time (identifies outliers)
- Failure rate

**Look for:**
- `avg_duration_ms > 200` → Supabase is slow
- `p95_duration_ms > 1000` → Some calls taking 1+ seconds (keeps worker alive!)
- `max_duration_ms > 5000` → Timeouts or very slow DB

---

### **Query 3: Identify Slow Operations (Top 10)**
```sql
SELECT
  index1 AS event_type,
  blob1 AS trace_id,
  double1 AS duration_ms,
  index3 AS status,
  blob2 AS error,
  timestamp
FROM dictation_events
WHERE timestamp > NOW() - INTERVAL '1' HOUR
  AND double1 > 1000  -- Operations taking > 1 second
ORDER BY double1 DESC
LIMIT 10;
```

**What it shows:**
- Slowest operations in the last hour
- What event type was slow (JWT or quota)
- Trace ID for correlation with other logs
- Error details

---

### **Query 4: Cold Start Analysis**
```sql
SELECT
  DATE_TRUNC('hour', timestamp) AS hour,
  COUNT(*) AS total_jwt_verifications,
  SUM(double4) AS cold_starts,
  ROUND(SUM(double4) * 100.0 / COUNT(*), 2) AS cold_start_pct,
  AVG(CASE WHEN double4 = 1 THEN double1 END) AS avg_cold_start_ms,
  AVG(CASE WHEN double4 = 0 THEN double1 END) AS avg_warm_start_ms
FROM dictation_events
WHERE index1 = 'auth.jwt_verify'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY hour
ORDER BY hour DESC;
```

**What it shows:**
- Cold start rate by hour
- Average cold start time vs warm start time
- Trends over time

**Look for:**
- High cold start percentage → Workers getting killed frequently
- `avg_cold_start_ms > 1000` → JWKS fetch is very slow

---

## 🚨 **Where Your Logs Actually Are**

### **Local Development:**
```bash
cd worker
npx wrangler dev

# Logs show in terminal ✅
# Analytics Engine writes are NO-OPS locally (won't actually write)
```

### **Production:**
```bash
# Real-time tail (last 5 minutes):
npx wrangler tail

# Or with filtering:
npx wrangler tail --format json | jq 'select(.outcome == "ok")'
```

**Production logs are NOT in the terminal** - they're in Cloudflare:

1. **Logpush (Advanced):**
   - `Cloudflare Dashboard → Analytics & Logs → Logpush`
   - Can send to S3, GCS, BigQuery, etc.
   - Costs money for high volume

2. **Real-time Logs (Built-in):**
   - Click "Logs" tab in Workers dashboard
   - Shows last 100K logs (free)
   - Searchable but not as powerful as Analytics Engine

3. **Analytics Engine (THIS IS NEW):**
   - `Cloudflare Dashboard → Analytics & Logs → Workers Analytics Engine`
   - Query with SQL
   - **Free tier:** 10M events/month, 90 days retention
   - **Perfect for metrics/timing data**

---

## 🔍 **Debugging Workflow**

### **Scenario 1: User Reports Slow First Dictation**

1. Query Analytics Engine for their user ID:
```sql
SELECT
  blob1 AS trace_id,
  double1 AS jwt_duration_ms,
  double4 AS was_cold_start,
  timestamp
FROM dictation_events
WHERE index1 = 'auth.jwt_verify'
  AND index2 = 'USER_ID_HERE'
  AND timestamp > NOW() - INTERVAL '7' DAY
ORDER BY timestamp DESC
LIMIT 20;
```

2. Look for:
   - `was_cold_start = 1` → JWKS fetch happened
   - `jwt_duration_ms > 1000` → JWKS was slow
   - Multiple cold starts → Workers dying frequently

3. Correlate with quota increment timing (same trace_id):
```sql
SELECT
  blob1 AS trace_id,
  double1 AS quota_duration_ms,
  index3 AS status,
  blob2 AS error
FROM dictation_events
WHERE index1 = 'db.quota_increment'
  AND blob1 IN (
    SELECT blob1 FROM dictation_events
    WHERE index2 = 'USER_ID_HERE'
      AND index1 = 'auth.jwt_verify'
    LIMIT 5
  );
```

---

### **Scenario 2: Worker Wall Time Still High**

1. Check if quota increments are slow:
```sql
SELECT
  QUANTILE(double1, 0.50) AS p50_ms,
  QUANTILE(double1, 0.95) AS p95_ms,
  QUANTILE(double1, 0.99) AS p99_ms
FROM dictation_events
WHERE index1 = 'db.quota_increment'
  AND timestamp > NOW() - INTERVAL '1' HOUR;
```

2. If `p95_ms > 1000`:
   - Supabase is slow
   - Consider webhook alternative (discussed below)

---

## 🌐 **Webhook Alternative for Quota Increment**

### **Why Webhook Might Be Better:**

**Current (waitUntil):**
```
1. User dictates
2. Worker sends 'final' message ✅
3. Worker calls increment_quota
4. Worker WAITS for Supabase response (200-5000ms) ⏱️
5. Worker dies

Total time alive: STT + LLM + waitUntil = 3-6 seconds
```

**With Webhook:**
```
1. User dictates
2. Worker sends 'final' message ✅
3. Worker sends webhook to external service
4. Worker dies IMMEDIATELY 💀

Webhook service (separate):
5. Calls Supabase increment_quota
6. Retries if fails
7. No worker kept alive!

Total time alive: STT + LLM + send webhook = 1.5 seconds
```

### **Webhook Implementation (Future):**

```typescript
// Instead of waitUntil:
await fetch('https://spoke-webhooks.your-domain.com/quota', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: authenticatedUserId,
    wordCount,
    traceId: session.traceId,
  }),
});

// Worker dies immediately after - doesn't wait for response
```

**Webhook service** (separate Cloudflare Worker or serverless function):
- Receives webhook
- Calls Supabase with retry logic
- Logs failures separately
- Worker isn't kept alive

**Pros:**
- ✅ Worker dies immediately (saves money)
- ✅ Better retry logic (webhook service can retry 3x)
- ✅ Failures don't affect user experience

**Cons:**
- ⚠️ Slightly less reliable (webhook could get lost)
- ⚠️ More infrastructure (need webhook service)

**Recommendation:** Monitor `db.quota_increment` analytics first. If P95 > 1s consistently, switch to webhook.

---

## 📈 **What Success Looks Like**

After deploying Analytics Engine, you should see:

### **JWT Verification:**
- `avg_duration_ms`: 50-150ms (warm start) ✅
- `avg_duration_ms`: 500-800ms (cold start) ✅
- `p95_duration_ms < 1000ms` ✅

### **Quota Increment:**
- `avg_duration_ms`: 100-300ms ✅
- `p95_duration_ms < 500ms` ✅
- `failure_rate < 1%` ✅

### **If You See:**
- JWT `p95 > 2000ms` → JWKS fetch is WAY too slow, consider caching
- Quota `p95 > 1000ms` → Supabase is slow, consider webhook
- High failure rates → Network issues or Supabase down

---

## 🚀 **Next Steps**

1. **Deploy to production** (already done!)
2. **Wait 24 hours** for data to accumulate
3. **Run the queries above** to see cold start rates and DB call timing
4. **Decide:**
   - If JWKS is slow → Add explicit timeout/caching
   - If quota increment is slow → Switch to webhook

**Analytics Engine will show you EXACTLY where the bottlenecks are!** 📊
