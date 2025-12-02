# Payments Blueprint — Dodo Payments + Supabase + Cloudflare Worker

**Status**: Website stack live; Worker gating + App auth **IMPLEMENTED** (PR #172); Optimization planned
**Owners**: Payments/Infra
**Last updated**: 2025-12-03

> **⚡️ Performance Optimization Available**: Current implementation works but queries DB on every dictation (~50ms overhead). See [`PAYMENTS_AUTH_OPTIMIZATION.md`](./PAYMENTS_AUTH_OPTIMIZATION.md) for a 15-minute change that gives 50x speedup by using Supabase Custom Access Token Hooks to bake subscription status into JWT. This is the production-standard approach used by Auth0, Clerk, and all major SaaS.

---

## Contents

1. [ELI5: How This All Works](#eli5-how-this-all-works)
2. [Implementation Status](#implementation-status)
3. [Architecture Overview](#architecture-overview)
4. [The Key Insight: Use Supabase JWT Directly](#the-key-insight-use-supabase-jwt-directly)
5. [Implementation Phases](#implementation-phases)
6. [Technical Deep Dive: JWT Verification](#technical-deep-dive-jwt-verification)
7. [Testing Strategy](#testing-strategy)
8. [Configuration Matrix](#configuration-matrix)
9. [Future: Free Tier with Usage Limits](#future-free-tier-with-usage-limits)
10. [References](#references)

---

## ELI5: How This All Works

### The Concert Analogy 🎸

Imagine you're running a concert venue (Sonic Flow). Here's how payments and access work:

**The Box Office (Website + Dodo Payments)**
- User walks up to buy a ticket
- They pay money (Dodo handles the payment)
- They get a receipt stored in our ledger (Supabase `subscriptions` table)

**The Wristband (Supabase JWT)**
- When someone signs in (Google OAuth), Supabase gives them a wristband (JWT token)
- This wristband has their name (user ID) written on it
- It expires after 1 hour, but Supabase automatically gives them a new one
- **Current implementation**: Wristband only has name, bouncer looks up payment status
- **Optimized approach**: Wristband has "PAID" stamp on it (no ledger lookup needed)

**The Bouncer (Cloudflare Worker)**
- Person shows their wristband at the door
- Bouncer checks: "Is this wristband real?" (verify JWT signature)
- Bouncer checks: "Is this wristband expired?" (check `exp` claim)
- **Current**: Bouncer looks up in the ledger: "Did this person pay?" (~50ms)
- **Optimized**: Bouncer reads "PAID" stamp on wristband (~1ms)
- If all good → let them in to transcribe
- If not → "Sorry, you need to buy a ticket"

**Why This Works**
- Wristband verification is FAST (cryptography, no network call needed)
- Reading stamps on wristband is instant (no need to check ledger every time)
- We only check the ledger ONCE per session (not per audio frame)
- Supabase manages wristband issuance — we don't have to build anything

---

### The Original Plan vs. The Better Plan

**Original Plan (More Complex)**:
```
Website mints custom "entitlement JWT" with subscription info baked in
→ App fetches this custom token
→ Worker verifies custom token
→ Multiple new endpoints, new secrets, more code
```

**Better Plan (What We're Doing)**:
```
Supabase already gives users a JWT when they sign in
→ App already has this token
→ Worker verifies Supabase JWT (proves identity)
→ Worker queries DB once: "Is this user paid?"
→ No new endpoints, no new secrets, way less code
```

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

### ✅ Completed (Worker + App - PR #172)

| Component | Location | Status |
|-----------|----------|--------|
| **Worker: JWT verification** | `worker/src/auth/supabaseJwt.ts` | ✅ Done |
| **Worker: Subscription check** | `worker/src/auth/subscription.ts` | ✅ Done |
| **Worker: Auth flow in WS** | `worker/src/handlers/ws.ts` | ✅ Done |
| **App: Send token in WS** | `src/hooks/useTranscription.ts` | ✅ Done |
| **App: Handle auth errors** | `src/hooks/useTranscription.ts` | ✅ Done |

### 🔜 Pending

| Component | Location | Priority |
|-----------|----------|----------|
| **Performance: Custom JWT claims** | See `PAYMENTS_AUTH_OPTIMIZATION.md` | **P0** (15 min, 50x speedup) |
| App: Upgrade flow UI | `src/components/` | P1 |
| Webhook: Call increment_entitlement_ver | `site: webhook handler` | P2 (optional with custom claims) |

---

## Architecture Overview

### Current State (No Auth)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TODAY (NO GATING)                                  │
│                                                                              │
│  Electron App ────[WebSocket]────> Cloudflare Worker ────> STT/LLM          │
│                                                                              │
│  Anyone can connect. No identity check. No payment check.                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Target State (With Auth)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TARGET STATE (GATED)                                 │
│                                                                              │
│  1. User signs in to app (Google OAuth via Supabase)                        │
│     └─> Supabase returns access_token (JWT)                                 │
│         This token contains: { sub: "user-uuid", email, role, exp }         │
│                                                                              │
│  2. User presses PTT to dictate                                              │
│     └─> App opens WebSocket to Worker                                        │
│     └─> First message: { type: "auth", token: "<supabase_access_token>" }   │
│                                                                              │
│  3. Worker receives auth message                                             │
│     └─> Verify JWT signature using Supabase JWKS (public key)               │
│     └─> Extract user_id from "sub" claim                                    │
│     └─> Query Supabase: "Does user X have active subscription?"             │
│                                                                              │
│  4. Decision                                                                 │
│     └─> ✅ Valid token + active subscription → Process audio                │
│     └─> ❌ Invalid/expired token → Close with 4010                          │
│     └─> ❌ No active subscription → Close with 4020                         │
│                                                                              │
│  5. App handles response                                                     │
│     └─> 4010 → "Please sign in again"                                       │
│     └─> 4020 → "Upgrade to Pro to continue"                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Key Insight: Use Supabase JWT Directly

### Why Not Mint Our Own Token?

The original blueprint proposed creating a custom "entitlement JWT" with subscription info baked in. This would require:
- ❌ New API endpoint on website (`/api/billing/entitlement-token`)
- ❌ New secret to manage (`ENTITLEMENT_SIGNING_KEY`)
- ❌ Custom refresh logic in the app
- ❌ More code to maintain

### The Supabase JWT Already Exists!

When a user signs in with Google OAuth, Supabase automatically issues them an access token (JWT). This token:
- ✅ Is already in the app (we get it from `supabase.auth.getSession()`)
- ✅ Is automatically refreshed by Supabase
- ✅ Can be verified without any shared secret (using public JWKS)
- ✅ Contains the user's ID (`sub` claim)

### The Trade-off

| Approach | Pros | Cons |
|----------|------|------|
| **Custom entitlement JWT** | Subscription info in token (no DB query) | New endpoint, new secret, more code |
| **Supabase JWT + DB query** | No new endpoint, no new secret, less code | One DB query per session |

**Winner: Supabase JWT + DB query** because:
- One DB query per dictation session is negligible (~5-20ms)
- Way simpler architecture
- Supabase handles token refresh automatically
- No new secrets to manage or rotate

---

## Implementation Phases

### Phase 1: Worker — JWT Verification + Subscription Check

This is the core of the gating logic. Three new files in the worker.

#### File 1: `worker/src/auth/supabaseJwt.ts`

**What it does**: Verifies that a Supabase JWT is authentic and not expired.

**How it works**:
1. Supabase exposes public keys at: `https://YOUR_PROJECT.supabase.co/auth/v1/.well-known/jwks.json`
2. The `jose` library fetches these keys and caches them
3. We use the public key to verify the JWT signature
4. If valid, we extract the user ID from the `sub` claim

**Key concepts**:

```
JWT Structure: <header>.<payload>.<signature>

Header: { "alg": "RS256", "kid": "key-id" }
Payload: { "sub": "user-uuid", "email": "...", "role": "authenticated", "exp": 1234567890 }
Signature: Cryptographic signature using Supabase's private key

Verification:
1. Decode header to find which key was used (kid)
2. Fetch public key from JWKS endpoint
3. Use public key to verify signature
4. Check exp > now (not expired)
5. Check iss matches your Supabase project (issuer)
```

**Why JWKS is secure**:
- Supabase signs JWTs with a **private key** (only Supabase has this)
- Supabase publishes the **public key** at the JWKS endpoint
- Public key can verify signatures but cannot create them
- If someone tries to forge a JWT, the signature won't match
- This is called "asymmetric cryptography" — same idea as HTTPS

```typescript
// Pseudocode for worker/src/auth/supabaseJwt.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

// This URL is your Supabase project's public key endpoint
// Replace with actual project URL from env
const getJWKS = (supabaseUrl: string) => 
  createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

export async function verifySupabaseJwt(
  token: string, 
  supabaseUrl: string
): Promise<{ valid: true; userId: string; email: string } | { valid: false; error: string }> {
  try {
    const JWKS = getJWKS(supabaseUrl);
    
    const { payload } = await jwtVerify(token, JWKS, {
      // Verify the token was issued by YOUR Supabase project
      issuer: `${supabaseUrl}/auth/v1`,
      // Verify the token is for authenticated users
      audience: 'authenticated',
    });
    
    return {
      valid: true,
      userId: payload.sub as string,
      email: payload.email as string,
    };
  } catch (error) {
    // Token is invalid, expired, or tampered with
    return { valid: false, error: String(error) };
  }
}
```

#### File 2: `worker/src/auth/subscription.ts`

**What it does**: Checks if a user has an active subscription.

**How it works**:
1. Query the `subscriptions` table with the user's ID
2. Check if any row has `status = 'active'`
3. Return true/false

```typescript
// Pseudocode for worker/src/auth/subscription.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function hasActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle(); // Returns null if no rows, doesn't throw
  
  if (error) {
    console.error('[Auth] Subscription check failed:', error);
    return false; // Fail closed — if we can't check, deny access
  }
  
  return data !== null;
}
```

#### File 3: Modify `worker/src/handlers/ws.ts`

**What changes**:
1. After WebSocket connection is accepted, wait for `auth` message
2. Verify the token
3. Check subscription
4. Only then accept `start` and process audio

**New WebSocket Protocol**:

```
BEFORE (current):
  Client: [connect]
  Client: { type: "start", ... }
  Client: [binary audio frames]
  Client: { type: "end" }
  Server: { type: "final", text: "..." }

AFTER (with auth):
  Client: [connect]
  Client: { type: "auth", token: "eyJ..." }        ← NEW
  Server: { type: "auth_ok" } or close(4010/4020)  ← NEW
  Client: { type: "start", ... }
  Client: [binary audio frames]
  Client: { type: "end" }
  Server: { type: "final", text: "..." }
```

**WebSocket Close Codes**:
- `4010` — Unauthorized (invalid token, expired, malformed)
- `4020` — Payment Required (valid user but no active subscription)
- `1000` — Normal closure

---

### Phase 2: App — Send Token in WebSocket

**What changes in `src/hooks/useTranscription.ts`**:

1. Get the Supabase access token before connecting
2. Send `auth` message immediately after WebSocket opens
3. Wait for `auth_ok` before sending `start`
4. Handle `4010` and `4020` close codes

```typescript
// Pseudocode changes to useTranscription.ts

// Get token from Supabase
const { data: { session } } = await supabase.auth.getSession();
if (!session?.access_token) {
  // User not signed in — show sign-in prompt
  return;
}

// Open WebSocket
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  // First message MUST be auth
  ws.send(JSON.stringify({ 
    type: 'auth', 
    token: session.access_token 
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'auth_ok') {
    // Now we can start dictation
    ws.send(JSON.stringify({ type: 'start', ... }));
  }
  // ... rest of message handling
};

ws.onclose = (event) => {
  if (event.code === 4010) {
    // Token invalid — user needs to sign in again
    showToast('Please sign in to continue');
  } else if (event.code === 4020) {
    // No subscription — user needs to upgrade
    showUpgradePrompt();
  }
};
```

---

### Phase 3: App — Upgrade Flow

When user gets a `4020` (payment required), show them how to upgrade:

1. Display modal: "Upgrade to Pro to continue transcribing"
2. Button: "Upgrade Now" → opens `https://sonicflow.app/pricing?source=app`
3. User completes checkout on website
4. User returns to app, tries to dictate again
5. This time subscription check passes!

**Optional enhancement**: Deep link callback so app knows immediately when checkout completes.

---

## Technical Deep Dive: JWT Verification

### What's Inside a Supabase JWT?

When you decode a Supabase access token, you see:

```json
{
  "aud": "authenticated",
  "exp": 1733184000,
  "iat": 1733180400,
  "iss": "https://xxxx.supabase.co/auth/v1",
  "sub": "12345678-1234-1234-1234-123456789012",
  "email": "user@example.com",
  "phone": "",
  "app_metadata": {
    "provider": "google",
    "providers": ["google"]
  },
  "user_metadata": {
    "avatar_url": "https://...",
    "email": "user@example.com",
    "full_name": "John Doe",
    "name": "John Doe"
  },
  "role": "authenticated",
  "aal": "aal1",
  "amr": [{ "method": "oauth", "timestamp": 1733180400 }],
  "session_id": "..."
}
```

**Important claims**:
- `sub` — User's unique ID (UUID) — this is what we use to look up subscription
- `exp` — Expiration timestamp (usually 1 hour from issuance)
- `iss` — Issuer (your Supabase project URL) — we verify this matches
- `aud` — Audience (should be "authenticated") — we verify this matches
- `email` — User's email (useful for logging)

### JWKS Verification Flow

```
1. Client sends JWT: "eyJhbGciOiJSUzI1NiIs..."
                            │
                            ▼
2. Worker decodes header:   { "alg": "RS256", "kid": "abc123" }
                            │
                            ▼
3. Worker fetches JWKS:     GET https://xxx.supabase.co/auth/v1/.well-known/jwks.json
                            │
                            ▼
4. JWKS response:           { "keys": [{ "kid": "abc123", "kty": "RSA", "n": "...", "e": "..." }] }
                            │
                            ▼
5. Worker finds key:        The key with "kid": "abc123"
                            │
                            ▼
6. Worker verifies:         Use public key to verify signature
                            │
                            ▼
7. If signature valid:      Check exp > now, iss matches, aud matches
                            │
                            ▼
8. Return claims:           { sub: "user-uuid", email: "...", ... }
```

### JWKS Caching

The `jose` library's `createRemoteJWKSet` automatically:
- Fetches JWKS on first use
- Caches keys in memory
- Refetches when a JWT uses an unknown `kid` (key rotation)

Supabase also caches at their edge for 10 minutes.

**For Cloudflare Workers**: Each Worker instance is ephemeral, but:
- Workers don't have "cold starts" like Lambda
- JWKS fetch happens once per Worker instance
- In practice, this is fast and not a bottleneck

### HS256 vs RS256 (Legacy vs Modern)

**HS256 (Legacy — Shared Secret)**:
- Same secret used to sign AND verify
- If someone gets the secret, they can forge tokens
- Supabase calls this the "JWT secret"

**RS256 (Modern — Asymmetric)**:
- Private key signs, public key verifies
- Even if you have the public key, you can't forge tokens
- This is what Supabase recommends and what we're using

**How to know which your project uses**:
- New projects (after May 2025): RS256 by default
- Older projects: May still use HS256
- Check: Go to Supabase Dashboard → Settings → API → JWT Settings

**If your project uses HS256**: You can still verify JWTs, but you'd use the JWT secret instead of JWKS. However, Supabase recommends migrating to RS256.

---

## Testing Strategy

### Phase 1: Worker Auth

| Test | Command | Expected |
|------|---------|----------|
| No auth message | `wscat -c wss://api.sonicflow.app/ws` then send `{"type":"start"}` | Close 4010 |
| Invalid token | Send `{"type":"auth","token":"garbage"}` | Close 4010 |
| Expired token | Send auth with old token | Close 4010 |
| Valid token, no subscription | Sign in, don't pay, try to dictate | Close 4020 |
| Valid token, active subscription | Sign in, pay, try to dictate | Works! |

### Phase 2: App Integration

| Test | Action | Expected |
|------|--------|----------|
| Not signed in | Press PTT | "Please sign in" prompt |
| Signed in, no sub | Press PTT | 4020 → Upgrade prompt |
| Signed in, active sub | Press PTT | Transcription works |
| Token about to expire | Wait ~55 min, press PTT | Supabase auto-refreshes, still works |

### E2E Flow

1. Fresh user opens app
2. Signs in with Google
3. Tries to dictate → "Upgrade to Pro" prompt
4. Clicks upgrade → website opens
5. Completes test payment
6. Returns to app
7. Tries to dictate → Works!

---

## Configuration Matrix

### Cloudflare Worker (Existing + New)

| Variable | Purpose | Already Have? |
|----------|---------|---------------|
| `SUPABASE_URL` | Project URL for JWKS + DB | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access for subscription query | ✅ Yes |
| `GROQ_API_KEY` | STT provider | ✅ Yes |
| ... (other existing) | ... | ✅ Yes |

**No new secrets needed!** We already have everything.

### Electron App (Existing)

| Variable | Purpose | Already Have? |
|----------|---------|---------------|
| `VITE_SUPABASE_URL` | Supabase project | ✅ Yes |
| `VITE_SUPABASE_ANON_KEY` | Client-side auth | ✅ Yes |
| `VITE_TRANSCRIBE_WS_URL` | Worker WebSocket | ✅ Yes |

**No new env vars needed!**

---

## FAQ: Is One DB Query Per Session Sustainable?

**Yes.** This is the standard pattern used by every SaaS.

### The Numbers

| Metric | Value |
|--------|-------|
| Query time | ~5-20ms |
| STT processing time | ~500-2000ms |
| Query as % of total | ~1% |
| Supabase free tier | Millions of queries/month |
| Your usage (1000 users, 100 dictations/day) | 100K queries/day = 3M/month |

### Why This Pattern Is Standard

1. **Always fresh**: If user cancels subscription, next dictation is blocked immediately
2. **Simple**: No cache invalidation bugs, no stale data
3. **Indexed**: Query hits `user_id` index, returns 1 row, lightning fast
4. **You're already doing it**: `dictation_logs` INSERT happens every session anyway

### Future Optimization (Not Needed Yet)

If you ever need to reduce DB load (10,000+ active users):
- Cache subscription status for 5 minutes per user in Worker
- Use Supabase Realtime to push subscription changes
- Add Redis/KV cache layer

**Bottom line**: Don't optimize prematurely. This pattern scales to millions of users.

---

## Future: Free Tier with Usage Limits

**Deferred** from initial scope. When we implement:

### Quota Model
- **Free tier**: 2000 words per calendar month
- **Paid tier**: Unlimited

### Implementation Sketch

1. After verifying JWT and confirming NO active subscription:
2. Query monthly usage:
   ```sql
   SELECT COALESCE(SUM(word_count), 0) as words_used
   FROM dictation_logs
   WHERE user_id = $1
   AND created_at >= DATE_TRUNC('month', NOW())
   ```
3. If `words_used >= 2000` → Close with 4021 (quota exceeded)
4. If `words_used < 2000` → Allow transcription

### Why Calendar Month?

```sql
-- Calendar month (simpler)
WHERE created_at >= DATE_TRUNC('month', NOW())
-- Means: "since the 1st of this month"

-- Rolling 7 days (more complex)
WHERE created_at > NOW() - INTERVAL '7 days'
-- Means: "in the last 168 hours"
```

Calendar month is:
- Easier for users to understand ("resets on the 1st")
- Simpler SQL
- No "when does my quota reset?" confusion

---

## References

### Supabase JWT Documentation

- [JSON Web Token Overview](https://supabase.com/docs/guides/auth/jwts) — How JWTs work in Supabase
- [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) — HS256 vs RS256, key rotation
- [JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-claims) — What's in a Supabase JWT
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) — Add custom claims to JWTs (recommended approach)
- [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) — Production patterns for custom claims

### Libraries

- [jose](https://github.com/panva/jose) — JWT library for JavaScript/TypeScript, works in Cloudflare Workers
- [@supabase/supabase-js](https://github.com/supabase/supabase-js) — Supabase client

### Agent Logs

- `agent-logs/2025-11-29_1501_payments-auth-integration.md` — Supabase SSR setup
- `agent-logs/2025-11-29_1638_payments-checkout-direct.md` — Direct checkout
- `agent-logs/2025-11-29_2030_payments-webhook-debugging.md` — Webhook handler
- `agent-logs/2025-11-29_2230_payments-webhook-success.md` — Payment testing
- `agent-logs/2025-11-29_2307_checkout-success-redesign.md` — Success page
- `agent-logs/2025-12-02_1430_payments-worker-app-auth.md` — Worker + App auth implementation (PR #172)

### Internal Docs

- `plans/PAYMENTS_AUTH_OPTIMIZATION.md` — **Recommended optimization: Custom JWT claims (15 min, 50x speedup)**
- `docs/DATABASE.md` — Schema, RLS, functions
- `docs/TRANSCRIPTION.md` — Audio pipeline

---

## Quick Reference: New WebSocket Protocol

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATED WEBSOCKET FLOW                          │
│                                                                              │
│  Client                                Server (Worker)                       │
│    │                                        │                                │
│    │──────[WebSocket Connect]──────────────>│                                │
│    │                                        │                                │
│    │  { type: "auth", token: "eyJ..." }     │                                │
│    │───────────────────────────────────────>│                                │
│    │                                        │ 1. Verify JWT (JWKS)           │
│    │                                        │ 2. Extract user_id             │
│    │                                        │ 3. Query subscriptions         │
│    │                                        │                                │
│    │         { type: "auth_ok" }            │ ← If valid + subscribed       │
│    │<───────────────────────────────────────│                                │
│    │                                        │                                │
│    │  { type: "start", ... }                │                                │
│    │───────────────────────────────────────>│                                │
│    │                                        │                                │
│    │  [binary audio frames]                 │                                │
│    │───────────────────────────────────────>│                                │
│    │                                        │                                │
│    │  { type: "end" }                       │                                │
│    │───────────────────────────────────────>│                                │
│    │                                        │                                │
│    │         { type: "final", ... }         │                                │
│    │<───────────────────────────────────────│                                │
│    │                                        │                                │
│                                                                              │
│  ERROR CASES:                                                                │
│    • Invalid/expired token → Server closes with code 4010                   │
│    • No active subscription → Server closes with code 4020                  │
│    • Timeout waiting for auth → Server closes with code 4010               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

**Last Updated**: 2025-12-02  
**Next Action**: Implement Phase 1 — Worker JWT verification + subscription check
