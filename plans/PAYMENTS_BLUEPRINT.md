# Payments Blueprint — Dodo Payments + Supabase + Next.js + Cloudflare Worker

**Status**: Website stack live (Auth + Checkout + Webhooks); Entitlement token minter + Worker gating + App integration pending  
**Owners**: Payments/Infra  
**Last updated**: 2025-12-02

---

## Contents

1. [Implementation Status](#implementation-status)
2. [Scope](#scope)
3. [Architecture Overview](#architecture-overview)
4. [Data Model](#data-model)
5. [Implementation Phases](#implementation-phases)
   - Phase 1: Entitlement Token Minter (Website)
   - Phase 2: Worker Gating (Cloudflare)
   - Phase 3: App Integration (Electron)
   - Phase 4: Upgrade Flow from App
6. [JWT Entitlement Design](#jwt-entitlement-design)
7. [Testing Strategy](#testing-strategy)
8. [Configuration Matrix](#configuration-matrix)
9. [Future: Free Tier with Usage Limits](#future-free-tier-with-usage-limits)
10. [References](#references)

---

## Implementation Status

### ✅ Completed (Website - Next.js on Vercel)

| Component | Location | Status |
|-----------|----------|--------|
| Supabase SSR Auth | `src/lib/supabase/` | ✅ Live |
| Google OAuth + AuthModal | `src/components/ui/AuthModal.tsx` | ✅ Live |
| Direct checkout redirect | `src/app/api/auth/callback/route.ts` | ✅ Live |
| Dodo webhook handler | `src/app/api/webhooks/dodo/route.ts` | ✅ Live |
| Checkout success page | `src/app/checkout/success/page.tsx` | ✅ Live |
| Database schema | Supabase (profiles, subscriptions, webhook_events) | ✅ Live |

### 🔜 Pending

| Component | Location | Priority |
|-----------|----------|----------|
| **Entitlement token minter** | `site: src/app/api/billing/entitlement-token/route.ts` | P0 - Next |
| **Worker JWT gating** | `app: worker/src/auth/entitlement.ts` | P0 |
| **App token management** | `app: src/services/entitlement.ts` | P0 |
| **App upgrade flow** | `app: src/components/UpgradePrompt.tsx` | P1 |
| Billing status endpoint | `site: src/app/api/billing/status/route.ts` | P1 |
| Webhook → increment_entitlement_ver | `site: webhook handler` | P1 (missing) |
| Free tier usage limits | Worker + App | P2 (deferred) |

---

## Scope

### Current Focus: Paid Tier Only

- **Goal**: Gate transcription behind paid subscriptions. Users must have an active Dodo subscription to use the app.
- **Plans**: Monthly and Yearly (configured in Dodo dashboard)
- **Auth model**: Supabase Auth (Google OAuth) shared between website and desktop app
- **Enforcement**: Worker validates JWT entitlement token on every WebSocket connection

### Deferred: Free Tier

- Free tier with usage limits (e.g., 2000 words/month) is planned but **not in initial scope**
- Will require Worker-side usage tracking via `dictation_logs.word_count`
- Calendar month reset (simpler than rolling window)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PAID USER FLOW                                  │
│                                                                              │
│  1. User signs in to app (Supabase Google OAuth)                            │
│                                                                              │
│  2. App calls website API to get entitlement token:                         │
│     POST https://sonicflow.app/api/billing/entitlement-token                │
│     Authorization: Bearer <supabase_access_token>                           │
│     Response: { token: "jwt...", expires_at, plan, is_active }              │
│                                                                              │
│  3. App stores token in electron-store, refreshes every 20 min              │
│                                                                              │
│  4. On each dictation, app opens WebSocket with:                            │
│     Authorization: Bearer <entitlement_token>                               │
│                                                                              │
│  5. Worker validates JWT (signature + expiry + is_active)                   │
│     - ✅ Valid → Process transcription                                       │
│     - ❌ Invalid/expired → Close with 4010 (unauthorized)                   │
│     - ❌ Inactive subscription → Close with 4020 (payment required)         │
│                                                                              │
│  6. App handles errors, prompts upgrade if needed                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            UPGRADE FLOW FROM APP                             │
│                                                                              │
│  1. User clicks "Upgrade" in app settings                                   │
│                                                                              │
│  2. App opens: https://sonicflow.app/pricing?source=app                     │
│                                                                              │
│  3. User signs in (or already signed in) → Dodo checkout                    │
│                                                                              │
│  4. Payment completes → Dodo webhook fires → DB updated                     │
│                                                                              │
│  5. App polls /api/billing/status OR detects via deep link callback         │
│                                                                              │
│  6. App fetches new entitlement token → User can transcribe!                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Database Schema (Supabase - Already Deployed)

See `docs/DATABASE.md` for full schema. Key tables:

**profiles** (extended for payments):
```sql
dodo_customer_id text UNIQUE     -- Links to Dodo customer
entitlement_ver integer DEFAULT 1 -- Bumped on subscription changes for fast revocation
```

**subscriptions**:
```sql
id uuid PRIMARY KEY
user_id uuid REFERENCES auth.users(id)
subscription_id text UNIQUE      -- Dodo subscription ID
plan_id text                     -- 'prd_xxx' (Dodo product ID)
product_id text
status text                      -- 'active' | 'cancelled' | 'on_hold' | 'expired'
plan_interval text               -- 'month' | 'year'
current_period_start timestamptz
current_period_end timestamptz
cancel_at_period_end boolean
canceled_at timestamptz
created_at, updated_at timestamptz
```

**webhook_events** (audit log):
```sql
event_id text PRIMARY KEY        -- Dodo event ID (idempotency)
type text                        -- Event type
raw jsonb                        -- Full payload
received_at timestamptz
```

### Database Functions

```sql
-- Fast revocation: bump version to invalidate cached tokens
CREATE FUNCTION increment_entitlement_ver(user_uuid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
  UPDATE profiles
  SET entitlement_ver = entitlement_ver + 1, updated_at = now()
  WHERE id = user_uuid;
$$;
```

**Note**: Webhook handler should call this on `subscription.cancelled`, `subscription.on_hold`, `subscription.expired` events.

---

## Implementation Phases

### Phase 1: Entitlement Token Minter (Website)

**File**: `site/src/app/api/billing/entitlement-token/route.ts`

**Endpoint**: `POST /api/billing/entitlement-token`

**Request**:
```
Headers:
  Authorization: Bearer <supabase_access_token>
```

**Response** (success):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1701532800,
  "plan": "pro_monthly",
  "is_active": true,
  "ver": 3
}
```

**Response** (no active subscription):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1701532800,
  "plan": "free",
  "is_active": false,
  "ver": 1
}
```

**Implementation**:
```typescript
// Pseudocode
1. Extract Bearer token from Authorization header
2. Verify Supabase access token: supabase.auth.getUser(token)
3. Query active subscription:
   SELECT * FROM subscriptions 
   WHERE user_id = $1 AND status = 'active'
   ORDER BY created_at DESC LIMIT 1
4. Query entitlement version:
   SELECT entitlement_ver FROM profiles WHERE id = $1
5. Determine plan:
   - If active subscription: map product_id → 'pro_monthly' | 'pro_yearly'
   - If no subscription: 'free'
6. Mint JWT with jose:
   {
     sub: user_id,
     is_active: boolean,
     plan: string,
     ver: number,
     iat: now,
     exp: now + 30 minutes
   }
7. Sign with ENTITLEMENT_SIGNING_KEY (HS256)
8. Return { token, expires_at, plan, is_active, ver }
```

**Environment Variables** (Vercel):
- `ENTITLEMENT_SIGNING_KEY` - Shared secret for JWT signing (min 32 chars)

**Testing**:
```bash
# Get a Supabase access token (from browser devtools or supabase.auth.getSession())
ACCESS_TOKEN="eyJ..."

# Call the endpoint
curl -X POST https://sonicflow.app/api/billing/entitlement-token \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"

# Decode the JWT to verify claims
echo "TOKEN" | cut -d'.' -f2 | base64 -d | jq
```

---

### Phase 2: Worker JWT Gating (Cloudflare)

**Files**:
- `worker/src/auth/entitlement.ts` - JWT verification logic
- `worker/src/handlers/ws.ts` - Add auth check at connection start

**entitlement.ts**:
```typescript
// Pseudocode
export interface EntitlementClaims {
  sub: string;      // user_id
  is_active: boolean;
  plan: 'free' | 'pro_monthly' | 'pro_yearly';
  ver: number;
  iat: number;
  exp: number;
}

export async function verifyEntitlementToken(
  token: string,
  secret: string
): Promise<{ valid: true; claims: EntitlementClaims } | { valid: false; error: string }> {
  // 1. Decode and verify JWT signature (use jose or manual HMAC)
  // 2. Check exp > now
  // 3. Check is_active === true
  // 4. Return claims or error
}
```

**ws.ts modifications**:
```typescript
// At the start of wsRoute():
1. Extract Authorization header from upgrade request
2. If missing → close with 4010 "Authorization required"
3. Extract Bearer token
4. Call verifyEntitlementToken(token, env.ENTITLEMENT_VERIFY_KEY)
5. If invalid → close with 4010 "Invalid token" 
6. If !is_active → close with 4020 "Subscription required"
7. If valid → proceed with transcription
8. Attach user_id (from claims.sub) to session for telemetry
```

**WebSocket Close Codes**:
- `4010` - Unauthorized (invalid/expired token)
- `4020` - Payment Required (no active subscription)
- `1000` - Normal closure

**Environment Variables** (Cloudflare):
- `ENTITLEMENT_VERIFY_KEY` - Same as ENTITLEMENT_SIGNING_KEY (for HS256)

**Testing**:
```bash
# Test without token (should fail)
wscat -c "wss://api.sonicflow.app/ws"
# Expected: Connection closed with 4010

# Test with invalid token
wscat -c "wss://api.sonicflow.app/ws" -H "Authorization: Bearer invalid"
# Expected: Connection closed with 4010

# Test with valid token (get from /api/billing/entitlement-token)
wscat -c "wss://api.sonicflow.app/ws" -H "Authorization: Bearer eyJ..."
# Expected: Connection established
```

---

### Phase 3: App Token Management (Electron)

**Files**:
- `src/services/entitlement.ts` - Token fetch, cache, refresh
- `src/hooks/useEntitlement.ts` - React hook for entitlement state
- `src/hooks/useTranscription.ts` - Add Authorization header
- `src/lib/supabaseClient.ts` - Add getAccessToken helper

**entitlement.ts**:
```typescript
// Key functions:

// Fetch token from website API
export async function fetchEntitlementToken(): Promise<EntitlementToken | null>

// Get cached token, refresh if needed
export async function getValidEntitlementToken(): Promise<string | null>

// Store token in electron-store
function cacheToken(token: EntitlementToken): void

// Check if token needs refresh (< 5 min remaining)
function shouldRefresh(expiresAt: number): boolean

// Clear cached token (on sign out)
export function clearEntitlementToken(): void
```

**useTranscription.ts modifications**:
```typescript
// Before opening WebSocket:
const token = await getValidEntitlementToken();
if (!token) {
  // Show sign-in prompt
  return;
}

// Open WebSocket with Authorization header
const ws = new WebSocket(url);
// Note: WebSocket API doesn't support headers directly
// Options:
// A) Pass token in URL: wss://api.sonicflow.app/ws?token=xxx (less secure)
// B) Pass token in first message after connection (custom protocol)
// C) Use subprotocol: new WebSocket(url, [`bearer.${token}`])

// Recommended: Option B - send token in "auth" message before "start"
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token }));
};
```

**Worker protocol update** (Phase 2 adjustment):
```typescript
// Instead of checking header (WebSocket limitation), check first message:
server.addEventListener('message', async (evt) => {
  const msg = parseMessage(evt.data);
  
  if (!authenticated) {
    if (msg.type === 'auth') {
      const result = verifyEntitlementToken(msg.token, secret);
      if (!result.valid) {
        safeClose(server, 4010, result.error);
        return;
      }
      if (!result.claims.is_active) {
        safeClose(server, 4020, 'Subscription required');
        return;
      }
      authenticated = true;
      session.userId = result.claims.sub;
      return;
    } else {
      safeClose(server, 4010, 'Auth required');
      return;
    }
  }
  
  // ... rest of message handling
});
```

**Testing**:
1. Sign in to app with Google OAuth
2. Check electron-store for cached token
3. Dictate something → verify it works
4. Wait for token to approach expiry → verify refresh happens
5. Sign out → verify token cleared

---

### Phase 4: Upgrade Flow from App

**Files**:
- `src/components/UpgradePrompt.tsx` - Modal shown when 4020 received
- `src/components/SettingsPanel.tsx` - Add "Upgrade" button
- `src/main.ts` - Handle deep link callback (optional)

**Flow**:
1. User clicks "Upgrade" in settings OR app receives 4020 error
2. Open external URL: `https://sonicflow.app/pricing?source=app`
3. User completes checkout on website
4. User returns to app (either manually or via deep link)
5. App fetches new entitlement token
6. Success! User can now transcribe

**Deep Link (optional, nice-to-have)**:
```
sonicflow://checkout/success?status=active
```
- Website checkout success page could include "Return to App" button
- App registers custom protocol handler
- On receiving deep link, app refreshes entitlement token

**Simple Version (MVP)**:
- Just poll `/api/billing/status` on a timer while upgrade modal is open
- When status becomes active, refresh token and dismiss modal

**Testing**:
1. Open app without subscription → should see upgrade prompt
2. Click upgrade → website opens
3. Complete test payment
4. Return to app → should be able to transcribe

---

## JWT Entitlement Design

### Claims

```json
{
  "sub": "uuid-user-id",
  "is_active": true,
  "plan": "pro_monthly",
  "ver": 3,
  "iat": 1701532800,
  "exp": 1701534600
}
```

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | string | User ID (UUID) |
| `is_active` | boolean | Has active subscription |
| `plan` | string | 'free' \| 'pro_monthly' \| 'pro_yearly' |
| `ver` | number | Entitlement version (for fast revocation) |
| `iat` | number | Issued at timestamp |
| `exp` | number | Expiry timestamp (iat + 30 min) |

### Signing

- **Algorithm**: HS256 (HMAC-SHA256 with shared secret)
- **Secret**: 32+ character random string, stored in:
  - Vercel: `ENTITLEMENT_SIGNING_KEY`
  - Cloudflare: `ENTITLEMENT_VERIFY_KEY` (same value)

### Token Lifecycle

```
1. App signs in → calls /api/billing/entitlement-token
2. Token valid for 30 minutes
3. App refreshes at 20-minute mark (proactive)
4. On subscription cancel:
   - Webhook bumps entitlement_ver
   - Old tokens still work until expiry (max 30 min grace)
   - New tokens minted with updated ver
5. On sign out: app clears cached token
```

### Fast Revocation (Future Enhancement)

For instant revocation (e.g., chargeback), Worker could:
1. Periodically fetch latest `ver` values for active users
2. Compare token `ver` with fetched value
3. Reject if stale

Not needed for MVP since 30-min expiry is acceptable grace period.

---

## Testing Strategy

### Phase 1: Token Minter

| Test | Expected |
|------|----------|
| Call with valid Supabase token + active sub | Return JWT with is_active=true, plan=pro_* |
| Call with valid token + no sub | Return JWT with is_active=false, plan=free |
| Call with invalid token | Return 401 |
| Call without Authorization header | Return 401 |
| Decode returned JWT | Claims match expected values |

### Phase 2: Worker Gating

| Test | Expected |
|------|----------|
| Connect without auth message | Close 4010 |
| Send auth with invalid token | Close 4010 |
| Send auth with expired token | Close 4010 |
| Send auth with is_active=false | Close 4020 |
| Send auth with valid token | Connection proceeds |
| Send start before auth | Close 4010 |

### Phase 3: App Token Management

| Test | Expected |
|------|----------|
| Sign in → token fetched | Token in electron-store |
| Token near expiry → auto-refresh | New token fetched |
| Sign out → token cleared | electron-store empty |
| Offline → use cached token | Works until expiry |
| Token expired + offline | Prompt re-auth |

### Phase 4: Upgrade Flow

| Test | Expected |
|------|----------|
| Click upgrade → website opens | Browser opens pricing page |
| Complete payment → return | App detects active sub |
| Cancel mid-checkout | App handles gracefully |

### E2E: Full Paid Flow

1. Fresh user signs up on website
2. Completes payment
3. Opens app, signs in with same Google account
4. App fetches entitlement token (is_active=true)
5. User dictates successfully
6. User cancels subscription on website
7. Webhook fires, entitlement_ver bumps
8. Within 30 min: old token still works
9. After 30 min: new token has is_active=false
10. App prompts to re-subscribe

---

## Configuration Matrix

### Website (Vercel)

| Variable | Purpose | Example |
|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | https://xxx.supabase.co |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | eyJ... |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access for webhooks | eyJ... |
| `DODO_PAYMENTS_API_KEY` | Dodo API key | sk_test_xxx |
| `DODO_PAYMENTS_ENVIRONMENT` | test_mode \| live_mode | test_mode |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Webhook signature key | whk_xxx |
| `NEXT_PUBLIC_PRODUCT_ID_MONTHLY` | Dodo product ID | prd_xxx |
| `NEXT_PUBLIC_PRODUCT_ID_ANNUAL` | Dodo product ID | prd_xxx |
| `ENTITLEMENT_SIGNING_KEY` | JWT signing secret | random-32-char-string |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL | https://www.sonicflow.app |

### Cloudflare Worker

| Variable | Purpose | Example |
|----------|---------|---------|
| `SUPABASE_URL` | For telemetry logging | https://xxx.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | For telemetry logging | eyJ... |
| `ENTITLEMENT_VERIFY_KEY` | JWT verification secret | (same as SIGNING_KEY) |
| `GROQ_API_KEY` | STT/LLM provider | gsk_xxx |
| ... (existing) | ... | ... |

### Electron App

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | https://xxx.supabase.co |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | eyJ... |
| `VITE_TRANSCRIBE_WS_URL` | Worker WebSocket URL | wss://api.sonicflow.app/ws |
| `VITE_SITE_URL` | Website URL for upgrade | https://www.sonicflow.app |

---

## Future: Free Tier with Usage Limits

**Deferred** from initial implementation. Design notes for later:

### Quota Model

- **Free tier**: 2000 words per calendar month
- **Paid tier**: Unlimited

### Implementation

1. **Worker queries usage** before processing (free users only):
   ```sql
   SELECT COALESCE(SUM(word_count), 0) as monthly_words
   FROM dictation_logs
   WHERE user_id = $1
   AND created_at >= DATE_TRUNC('month', NOW())
   ```

2. **JWT includes usage info**:
   ```json
   {
     "sub": "...",
     "is_active": true,
     "plan": "free",
     "usage": { "words": 847, "limit": 2000, "period": "2025-12" }
   }
   ```

3. **Worker enforces**:
   - If free + usage >= limit → Close 4021 (quota exceeded)
   - If paid → Skip usage check

4. **App shows usage**:
   - Settings panel shows "847 / 2000 words this month"
   - Warning when approaching limit

### Why Calendar Month?

- Simpler query (DATE_TRUNC vs rolling window)
- More predictable for users ("resets on the 1st")
- Easier to explain in UI

---

## References

### Agent Logs (Chronological)

- `agent-logs/2025-11-29_1501_payments-auth-integration.md` - Supabase SSR + AuthModal
- `agent-logs/2025-11-29_1638_payments-checkout-direct.md` - Direct checkout redirect
- `agent-logs/2025-11-29_2030_payments-webhook-debugging.md` - Webhook handler
- `agent-logs/2025-11-29_2230_payments-webhook-success.md` - INR/USD payment testing
- `agent-logs/2025-11-29_2307_checkout-success-redesign.md` - Success page polish

### Documentation

- `docs/DATABASE.md` - Schema, RLS, functions
- `docs/TRANSCRIPTION.md` - Audio pipeline architecture
- `docs/AUTH.md` - Supabase OAuth setup (if exists)

### External

- [Dodo Payments Docs](https://docs.dodopayments.com/)
- [Supabase SSR Guide](https://supabase.com/docs/guides/auth/server-side-rendering)
- [jose JWT Library](https://github.com/panva/jose)

---

**Last Updated**: 2025-12-02  
**Next Action**: Phase 1 - Build entitlement token minter on website
