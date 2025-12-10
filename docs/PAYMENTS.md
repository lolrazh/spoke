# Spoke App - Payments Architecture - docs/PAYMENTS.md

This file provides comprehensive documentation for Spoke's payments and subscription system, including Dodo Payments integration, JWT-based entitlement gating, and free tier quota tracking.

## Overview

Spoke uses a **server-authoritative payment system** that combines Dodo Payments for billing, Supabase Custom Access Token Hooks for entitlement distribution, and Cloudflare Worker-side gating for secure transcription access.

### Key Features
- **Dodo Payments Integration** - Subscription billing with INR/USD support
- **JWT-Based Entitlements** - Subscription status embedded in signed tokens
- **Zero-Query Gating** - Worker validates access without database queries
- **Free Tier Quota** - 2000 words/month limit with server-side tracking
- **Instant Post-Payment Access** - JWT refresh on app startup enables immediate access

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User clicks   │    │   Dodo Payments  │    │   Webhook       │
│   "Upgrade"     │───▶│   Checkout Page  │───▶│   Handler       │
│   in app/web    │    │   (Hosted)       │    │   (Website)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   App uses      │◀───│   JWT contains   │◀───│   Supabase DB   │
│   dictation     │    │   subscription   │    │   updated with  │
│   (if entitled) │    │   claims         │    │   active status │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Component Interaction

- **Website** (`api-spoke-site`) - Dodo checkout flow, OAuth integration, webhook handling
- **Supabase Database** - Stores subscriptions, profiles, quota tracking
- **Custom Access Token Hook** - Embeds subscription/quota claims in JWT
- **Cloudflare Worker** - Validates JWT claims, gates transcription access
- **Electron App** - Refreshes JWT on startup, displays tier-appropriate UI

---

## Payment Flow

### Complete Checkout Flow

```
1. User clicks "Upgrade" on pricing page or Settings Panel
2. User authenticates with Google OAuth (if not signed in)
3. Website creates Dodo checkout session with user email
4. User redirected to Dodo's hosted payment page
5. User completes payment (card, UPI, etc.)
6. Dodo redirects to /checkout/success with subscription_id
7. Dodo fires subscription.active webhook to website
8. Webhook handler updates subscriptions table in Supabase
9. User restarts app → JWT refresh → subscription_active: true
10. Dictation now works without restriction
```

### Direct Checkout Architecture

Instead of a separate checkout page, authentication directly leads to Dodo:

```typescript
// In auth callback (src/app/api/auth/callback/route.ts)
// 1. Exchange code for session
const { error } = await supabase.auth.exchangeCodeForSession(code);

// 2. Create Dodo session immediately
const dodo = new DodoPayments({ ... });
const session = await dodo.checkoutSessions.create({ ... });

// 3. Redirect to Dodo
return NextResponse.redirect(session.checkout_url);
```

**Benefits:**
- Fewer clicks (Sign In → Payment, no intermediate step)
- UX optimization (users expect immediate checkout after sign-in)
- Simpler code (no intermediate checkout page needed)

### Webhook Processing

The website handles Dodo webhook events at `/api/webhooks/dodo`:

```typescript
// Webhook handler pattern (lazy initialization)
function getWebhookHandler() {
  if (!webhookHandler) {
    webhookHandler = Webhooks({
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,
      onSubscriptionActive: async (payload) => { /* ... */ },
      onSubscriptionCancelled: async (payload) => { /* ... */ },
      // ... other handlers
    });
  }
  return webhookHandler;
}
```

**Events Handled:**
| Event | Action |
|-------|--------|
| `subscription.active` | Create/update subscription in DB, set dodo_customer_id |
| `subscription.renewed` | Update billing period dates |
| `subscription.on_hold` | Mark as on_hold (payment failed) |
| `subscription.cancelled` | Set canceled_at timestamp and status |
| `subscription.expired` | Mark subscription as expired |
| `subscription.failed` | Log failed subscription creation |
| `subscription.plan_changed` | Update plan_id and billing interval |

---

## JWT-Based Entitlement System

### The Optimization Problem (Solved)

**Before (Database Query Per Dictation):**
```
User dictates → Worker queries subscriptions table → 50ms latency
At 10k users × 20 dictations/day = 200,000 queries/day
```

**After (JWT Claims):**
```
User dictates → Worker reads JWT claim → 1ms latency
At 10k users = ~2,000 queries/day (only on token refresh)
```

**Result:** 50x speedup, 99% reduction in database queries.

### Custom Access Token Hook

The magic happens in a Postgres function that runs during JWT generation:

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
volatile  -- CRITICAL: Must be VOLATILE because it performs UPDATE
security definer
as $$
  declare
    claims jsonb;
    has_subscription boolean;
    words_used integer;
    reset_date timestamptz;
  begin
    -- Check if user has active subscription
    select exists(
      select 1 from public.subscriptions
      where user_id = (event->>'user_id')::uuid
      and status = 'active'
    ) into has_subscription;

    claims := event->'claims';
    claims := jsonb_set(claims, '{subscription_active}', to_jsonb(has_subscription));

    -- For free tier users, add quota claims
    if has_subscription = false then
      select words_used_this_month, quota_reset_date
      into words_used, reset_date
      from public.profiles
      where id = (event->>'user_id')::uuid;

      -- Lazy monthly reset
      if reset_date is null or reset_date < now() then
        update public.profiles
        set words_used_this_month = 0,
            quota_reset_date = date_trunc('month', now() + interval '1 month')
        where id = (event->>'user_id')::uuid;
        words_used := 0;
      end if;

      claims := jsonb_set(claims, '{words_used_this_month}', to_jsonb(coalesce(words_used, 0)));
      claims := jsonb_set(claims, '{quota_limit}', to_jsonb(2000));
    end if;

    event := jsonb_set(event, '{claims}', claims);
    return event;
  end;
$$;
```

**Critical Bug Fixed (2025-12-04):** Function must be `VOLATILE`, not `STABLE`, because it performs UPDATE operations. Postgres silently blocks writes in STABLE functions.

### JWT Claims Structure

```typescript
// Pro user JWT payload
{
  sub: "user-uuid",
  email: "user@example.com",
  subscription_active: true,
  // No quota fields for Pro users
}

// Free tier user JWT payload
{
  sub: "user-uuid",
  email: "user@example.com",
  subscription_active: false,
  words_used_this_month: 342,
  quota_limit: 2000,
  quota_reset_date: "2025-01-01T00:00:00Z"
}
```

---

## Worker-Side Authentication

### WebSocket Protocol

```
Client: [connect to WebSocket]
Client: { type: "auth", token: "<supabase_access_token>" }
Server: { type: "auth_ok" }
       OR
Server: [close connection with code 4010/4020/4021]
Client: { type: "start", ... }
Client: [binary audio frames]
...
```

### Close Codes

| Code | Name | Meaning |
|------|------|---------|
| `4010` | UNAUTHORIZED | Invalid, expired, or malformed JWT |
| `4011` | AUTH_TIMEOUT | No auth message within 10 seconds |
| `4020` | PAYMENT_REQUIRED | Valid user, no active subscription |
| `4021` | QUOTA_EXCEEDED | Free tier monthly limit reached |

### JWT Verification Flow

```typescript
// worker/src/auth/supabaseJwt.ts
export async function verifySupabaseJwt(
  token: string,
  supabaseUrl: string
): Promise<JwtVerifyResult> {
  const JWKS = getJWKS(supabaseUrl);  // Cached JWKS fetcher

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated',
  });

  const subscriptionActive = payload.subscription_active === true;
  const wordsUsedThisMonth = payload.words_used_this_month;
  const quotaLimit = payload.quota_limit;

  return {
    valid: true,
    userId: payload.sub,
    email: payload.email,
    subscriptionActive,
    wordsUsedThisMonth,
    quotaLimit,
    payload,
  };
}
```

### Auth Gating in WebSocket Handler

```typescript
// worker/src/handlers/ws.ts
const jwtResult = await verifySupabaseJwt(token, env.SUPABASE_URL);

if (!jwtResult.valid) {
  ws.close(WS_CLOSE_CODES.UNAUTHORIZED);
  return;
}

// Pro users bypass quota check
if (!jwtResult.subscriptionActive) {
  const wordsUsed = jwtResult.wordsUsedThisMonth ?? 0;
  const quotaLimit = jwtResult.quotaLimit ?? 2000;

  if (wordsUsed >= quotaLimit) {
    ws.close(WS_CLOSE_CODES.QUOTA_EXCEEDED);
    return;
  }
}

// Auth passed - send confirmation
ws.send(JSON.stringify({ type: 'auth_ok' }));
```

---

## Free Tier Quota System

### Architecture: Server-Authoritative

The quota system is designed to be tamper-proof:

| Component | Reads | Writes | Trusted? | Purpose |
|-----------|-------|--------|----------|---------|
| **Worker** | JWT claims | DB (increment) | ✅ YES | Source of truth |
| **Database** | Custom Hook | Worker only | ✅ YES | Persistent storage |
| **App localStorage** | Progress bar | Local only | ❌ NO | UI display |

**Security Model:**
- User can edit localStorage → Shows fake progress bar ❌
- But JWT still has real quota from DB ✅
- Worker reads JWT → Blocks based on server truth ✅
- **Result:** Tampered UI, still gated correctly ✅

### Word Counting Logic

```typescript
// Count STT output (spoken words), NOT LLM output
const finalText = sttResult.text;  // What user actually said
const wordCount = finalText
  .split(/\s+/)
  .filter(w => w.length > 0)
  .length;

// Fire-and-forget increment (zero latency)
executionCtx.waitUntil(
  incrementQuota(userId, wordCount)
);
```

**Why STT output, not LLM output?**
- Normal mode: User says "hello world" → 2 words counted ✅
- Edit mode: User says "make it shorter" → 3 words counted
  - Even though LLM generates 70 words of edited text
  - Fair pricing: charge for spoken input, not generated output

### Fire-and-Forget Pattern

```typescript
// ❌ BAD: Blocks response on DB write
await incrementQuota(userId, wordCount);
server.send(finalResponse);  // User waits 50-200ms

// ✅ GOOD: Sends response immediately
server.send(finalResponse);  // User gets response instantly
executionCtx.waitUntil(
  incrementQuota(userId, wordCount)  // Happens in background
);
```

Cloudflare Workers guarantees `waitUntil()` tasks complete even after response is sent.

### Lazy Monthly Reset

Instead of cron jobs, reset happens on-demand in the auth hook:

```sql
-- In custom_access_token_hook()
if reset_date is null or reset_date < now() then
  update public.profiles
  set words_used_this_month = 0,
      quota_reset_date = date_trunc('month', now() + interval '1 month')
  where id = (event->>'user_id')::uuid;
end if;
```

**Benefits:**
- No scheduled tasks to manage
- Resets only for active users
- Automatic on next JWT refresh after month boundary

---

## Post-Payment Access

### The Problem

After payment, the user's JWT still contains `subscription_active: false` until it refreshes (up to 1 hour by default).

### The Solution: App Startup Refresh

```typescript
// src/components/App.tsx
if (!skipAuth) {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.auth.refreshSession();
    console.log('[App] Session refreshed - JWT claims updated');
  }
}
```

**User Flow:**
1. Pay for subscription
2. Database updated immediately
3. User restarts app (natural action when something doesn't work)
4. `refreshSession()` gets fresh JWT with `subscription_active: true`
5. Dictation works immediately

### Propagation Delay Philosophy

| Scenario | Delay Acceptable? | Reason |
|----------|-------------------|--------|
| After payment | ❌ NO | Users expect immediate access after paying |
| After cancellation | ✅ YES | Industry standard, service until billing period ends |

The startup refresh solves the payment case. Cancellation delay is a feature, not a bug.

---

## UI Implementation

### Pro User Features

- **PRO badge** on avatar in Settings Panel
- **Shimmer effect** on hover for account card
- **"Manage" button** linking to Dodo customer portal
- **No quota display** (unlimited dictation)

### Free User Features

- **Usage progress bar** showing words used / 2000
- **"Resets monthly" hint** under progress bar
- **"Upgrade" button** with shimmer effect
- **Quota-based notifications** when limit reached

### Conditional Rendering

```typescript
// src/components/SettingsPanel.tsx
const { wordsUsed, quotaLimit, isPro } = useQuotaState();

return (
  <div className={`account-card ${isPro ? 'shimmer' : ''}`}>
    {isPro && <ProBadge />}
    {!isPro && <UsageProgressBar used={wordsUsed} limit={quotaLimit} />}
    {isPro ? <ManageButton /> : <UpgradeButton />}
  </div>
);
```

### State Management

```typescript
// src/state/quotaCache.ts
interface QuotaState {
  wordsUsed: number;
  quotaLimit: number;
  resetDate: string | null;
  isPro: boolean;
}

// Synced from JWT on startup
export function updateQuotaFromServer(wordsUsed, quotaLimit, resetDate, isPro);

// Updated locally for instant UI (from worker wordCount)
export function incrementQuotaLocal(wordCount);
```

---

## Error Handling

### App-Side Error Messages

All auth failures normalized to user-friendly messages:

| Error Code | Message |
|------------|---------|
| No token | "Sign in to start dictating." |
| 4010 (expired) | "Session expired. Please sign in again." |
| 4020 (no subscription) | "Upgrade to Pro for unlimited dictation." |
| 4021 (quota) | "You've used your free words this month. Upgrade for unlimited." |

### Notification Reliability

**Problem:** Notifications sometimes didn't show due to state machine timing.

**Solution:** 
1. Clear `authError` at start of each dictation attempt
2. Send notification directly via `window.notifications.send()`
3. Make pill state machine interrupt LISTENING for error notifications

```typescript
// In start() flow
setAuthError(null);  // Clear to ensure useEffect fires on re-set
// ... auth check ...
if (quotaExceeded) {
  setAuthError("payment_required");
  window.notifications?.send?.(errorMessage);  // Direct notification
  return;
}
```

---

## Configuration

### Environment Variables

**Website (`api-spoke-site/.env`):**
```bash
# Dodo Payments
DODO_PAYMENTS_API_KEY=sk_...
DODO_PAYMENTS_WEBHOOK_KEY=whsec_...
DODO_PAYMENTS_ENVIRONMENT=test_mode  # or live_mode

# Product IDs
DODO_PRODUCT_MONTHLY=prd_...
DODO_PRODUCT_ANNUAL=prd_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# URLs
NEXT_PUBLIC_SITE_URL=https://www.spoke.so
```

**Worker (`worker/.dev.vars` / Cloudflare Secrets):**
```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SKIP_AUTH=1  # Development only - bypasses auth
```

### Supabase Dashboard Configuration

1. **Authentication → Hooks (Beta):**
   - Enable "Custom Access Token Hook"
   - Select function: `public.custom_access_token_hook`

2. **Authentication → URL Configuration:**
   - Add redirect URLs for OAuth callbacks

3. **Database → Functions:**
   - Ensure `custom_access_token_hook` is VOLATILE, SECURITY DEFINER
   - Ensure `increment_quota_simple` exists for quota tracking

### Dodo Dashboard Configuration

1. **Products:**
   - Monthly subscription (e.g., $9.99/month)
   - Annual subscription (e.g., $99/year)

2. **Webhooks:**
   - Endpoint: `https://www.spoke.so/api/webhooks/dodo`
   - Events: All subscription.* events

3. **Test Cards:**
   - US Visa: `4242 4242 4242 4242`
   - India Visa: Different number (check Dodo docs)

---

## Customer Portal

Pro users can manage their subscription (update payment method, cancel, view invoices) via the Dodo customer portal.

### Architecture

```
┌─────────────┐     ┌─────────────────────────────────┐     ┌──────────────┐
│ Electron    │     │ Website                         │     │ Dodo Portal  │
│ App         │     │                                 │     │              │
└─────────────┘     └─────────────────────────────────┘     └──────────────┘
      │                           │                                │
      │ openExternal(url#token)   │                                │
      │──────────────────────────►│                                │
      │                           │ /billing/portal page:          │
      │                           │ 1. Read token from hash        │
      │                           │ 2. Call /api/billing/portal    │
      │                           │ 3. Redirect to Dodo            │
      │                           │───────────────────────────────►│
```

**Why this pattern?** Opening the browser immediately makes the app feel instant. The 1-2 second API latency happens in the browser where users expect pages to load.

### App Implementation

```typescript
// src/components/SettingsPanel.tsx
const handleManageSubscription = async () => {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  
  // Open browser immediately - website handles the redirect
  // Token in hash fragment (not sent to server logs)
  const portalUrl = `https://www.spoke.so/billing/portal#token=${session.access_token}`;
  window.electron?.openExternal(portalUrl);
};
```

### Website Redirect Page

The `/billing/portal` page:
1. Shows loading state ("Opening billing portal...")
2. Reads token from `window.location.hash`
3. Calls `POST /api/billing/portal` with Bearer auth
4. Redirects to returned Dodo portal URL

### Endpoint Responses

| Status | Response | Meaning |
|--------|----------|---------|
| 200 | `{ url: "..." }` | Success - redirect to this URL |
| 401 | `{ error: "..." }` | Missing/invalid JWT |
| 400 | `{ error: "...", code: "NO_CUSTOMER_ID" }` | User has no Dodo customer ID |
| 500 | `{ error: "..." }` | Dodo API or server error |

---


## File Organization

```
Website (api-spoke-site):
├── src/app/api/
│   ├── auth/callback/route.ts    # OAuth + direct Dodo checkout
│   ├── billing/portal/route.ts   # Customer portal session creation
│   └── webhooks/dodo/route.ts    # Subscription webhook handler
├── src/app/checkout/
│   └── success/page.tsx          # Post-payment success page
└── src/app/pricing/
    └── page.tsx                  # Pricing + auth modal

Worker:
├── worker/src/auth/
│   ├── index.ts                  # Close codes, exports
│   └── supabaseJwt.ts            # JWT verification with JWKS
└── worker/src/handlers/
    └── ws.ts                     # WebSocket auth + quota gating

App:
├── src/state/
│   └── quotaCache.ts             # Local quota state for UI
├── src/hooks/
│   └── useTranscription.ts       # Auth flow, error handling
└── src/components/
    ├── App.tsx                   # JWT refresh on startup
    └── SettingsPanel.tsx         # Pro/free tier UI, billing portal
```

---

## Related Documentation

- `docs/AUTH.md` - OAuth flow and JWT refresh patterns
- `docs/DATABASE.md` - Schema, functions, Custom Access Token Hook details
- `docs/TRANSCRIPTION.md` - Worker transcription pipeline

---

## Development & Testing

### Local Development

```bash
# Worker: Skip auth for testing
echo "SKIP_AUTH=1" >> worker/.dev.vars
npm run dev:worker

# App: Normal development
npm run dev:local
```

### Testing Payment Flow

1. Use Dodo test mode (`DODO_PAYMENTS_ENVIRONMENT=test_mode`)
2. Use appropriate test cards (region-specific!)
3. Verify webhook delivery in Dodo dashboard
4. Check subscriptions table in Supabase
5. Force JWT refresh: `supabase.auth.refreshSession()`

### Common Issues

| Issue | Solution |
|-------|----------|
| Payment stuck in "pending" | Check Dodo dashboard for errors, verify test card |
| Webhook not firing | Verify events selected in Dodo webhook config |
| JWT claims not updating | Ensure auth hook is VOLATILE, call refreshSession() |
| Quota showing 0 | Check database has words_used_this_month value |
| Billing portal fails | Check user has dodo_customer_id in profiles table |

---

## Changelog

### 2025-11-29: Initial Payment Integration
- Dodo Payments integration for website checkout
- Webhook handler for subscription lifecycle
- Success page with confetti celebration

### 2025-12-02: Worker Authentication
- JWT verification with JWKS
- Subscription status check from JWT claims
- Custom Access Token Hook for subscription_active claim
- Pre-connect pattern for zero-latency first dictation

### 2025-12-03: Post-Payment UX
- JWT refresh on app startup
- Instant access after payment with app restart

### 2025-12-04: Free Tier Quota
- Server-authoritative quota tracking
- Fire-and-forget DB writes with waitUntil()
- Lazy monthly reset in auth hook
- Local quota display with progress bar
- Fixed VOLATILE bug in auth hook

### 2025-12-05: Customer Portal
- Website endpoint for billing portal session creation
- App-side "Manage" button calls endpoint with JWT auth
- Opens Dodo customer portal in system browser
