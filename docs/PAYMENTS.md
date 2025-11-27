# Sonic Flow App - Payment System - docs/PAYMENTS.md

This document provides a comprehensive technical overview of Sonic Flow's subscription payment system using Dodo Payments, including the complete flow from checkout to transcription gating.

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture & Components](#architecture--components)
3. [Phase 1: Database Foundation (✅ Completed)](#phase-1-database-foundation--completed)
4. [Phase 2: Checkout Flow (✅ Completed)](#phase-2-checkout-flow--completed)
5. [Phase 3: Webhook Processing (✅ Completed)](#phase-3-webhook-processing--completed)
6. [Phase 4: Entitlement Token Minting (✅ Completed)](#phase-4-entitlement-token-minting--completed)
7. [Phase 5: Worker Gating (🔧 TODO)](#phase-5-worker-gating--todo)
8. [Phase 6: Desktop App Integration (🔧 TODO)](#phase-6-desktop-app-integration--todo)
9. [Security Considerations](#security-considerations)
10. [Environment Variables](#environment-variables)
11. [Testing Guide](#testing-guide)
12. [Troubleshooting](#troubleshooting)

---

## System Overview

Sonic Flow uses a subscription-based payment model with two plans (Monthly/Yearly) and a 7-day trial period. The payment system is built on Dodo Payments and integrates across three components:

1. **Next.js Website** (sonicflow.app) - Handles checkout, webhooks, and entitlement token minting
2. **Cloudflare Worker** (api.sonicflow.app) - Enforces payment gating on transcription requests
3. **Desktop App** (Electron) - Fetches and refreshes entitlement tokens

### Payment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      COMPLETE PAYMENT FLOW                       │
└─────────────────────────────────────────────────────────────────┘

User Journey:
─────────────
  User visits pricing page → Clicks "Start Free Trial" (7-day trial)
                ↓
  Website /api/billing/checkout creates Dodo session
                ↓
  Redirects to Dodo hosted checkout page
                ↓
  User enters payment details (test: 4242 4242 4242 4242)
                ↓
  Dodo processes payment & fires webhook
                ↓
  Website /api/dodo/webhook receives & processes event
                ↓
  Database updated: subscriptions table → status='active'
                ↓
  User redirected to /billing/return
                ↓
  Page polls /api/billing/status until active
                ↓
  Success! Shows "Your subscription is now active! 🎉"

Desktop App Journey:
────────────────────
  App starts / user clicks dictate
                ↓
  Check if entitlement token exists & valid (exp > 10min)
                ↓
  If missing/expired: Call /api/billing/entitlement-token
                ↓
  Receive JWT token with 30min expiry
                ↓
  Store token in electron-store
                ↓
  Connect to Worker with Authorization: Bearer <token>
                ↓
  Worker validates token (signature, exp, ver, is_active)
                ↓
  If valid: Allow transcription | If invalid: Show upgrade prompt
```

---

## Architecture & Components

### Technology Stack

- **Payment Processor**: Dodo Payments (test: test.dodopayments.com, live: live.dodopayments.com)
- **Backend**: Next.js 15 API Routes (Vercel)
- **Database**: Supabase PostgreSQL
- **Token Format**: JWT (HS256 signed)
- **Worker Runtime**: Cloudflare Workers
- **Desktop App**: Electron with electron-store

### Component Responsibilities

| Component | Responsibilities |
|-----------|-----------------|
| **Next.js Website** | Checkout session creation, webhook processing, status checks, token minting |
| **Supabase Database** | Store subscriptions, webhook events, user profiles with customer IDs |
| **Dodo Payments** | Handle payment processing, PCI compliance, subscription management |
| **Cloudflare Worker** | Validate entitlement tokens, gate transcription API |
| **Desktop App** | Fetch tokens, refresh tokens, handle upgrade prompts |

### Why This Architecture?

**Decision: Next.js over Supabase Edge Functions**
- Single codebase with website (easier maintenance)
- Better Vercel integration and logging
- No need to manage separate Edge Function deployments
- Simpler debugging with Vercel function logs

**Decision: Webhook-driven over Polling**
- Real-time updates when subscription changes
- Reduces API calls to Dodo
- Lower latency for subscription activation

**Decision: Short-lived tokens (30min)**
- Security: Leaked tokens expire quickly
- Revocation: Combined with version number, near-instant revocation
- Balance: Long enough to reduce refresh overhead

**Decision: Version-based token revocation**
- Alternative: Maintain a blocklist of revoked tokens (requires DB lookup per request)
- Our approach: Bump `entitlement_ver` on cancel, embed `ver` claim in token
- Worker rejects tokens with stale version WITHOUT database call (zero-DB hot path)

---

## Phase 1: Database Foundation (✅ Completed)

### Tables Created

#### Extended `profiles` Table

Added two new columns to existing profiles table:

```sql
alter table public.profiles
  add column if not exists dodo_customer_id text unique,
  add column if not exists entitlement_ver integer not null default 1;
```

**Fields:**
- `dodo_customer_id` - Links user to Dodo Payments customer ID (set on first checkout)
- `entitlement_ver` - Token revocation version (incremented on cancel/failure)

**Why separate from subscriptions?**
- One customer can have multiple subscriptions over time
- Customer ID is permanent, subscriptions come and go

#### `subscriptions` Table

```sql
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dodo_subscription_id text unique,
  plan_id text not null,              -- 'monthly' | 'yearly'
  product_id text,                    -- Dodo product_id
  status text not null,               -- 'active' | 'canceled' | 'past_due' | 'on_hold' | 'expired'
  plan_interval text,                 -- 'month' | 'year'
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS Policy: Users can read their own subscriptions
create policy "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
```

**Key Points:**
- `dodo_subscription_id` is unique (one Dodo subscription = one row)
- `plan_id` is our internal identifier ('monthly' vs 'yearly')
- `product_id` is Dodo's product ID (maps to plan_id)
- RLS enabled: Users can SELECT their own, only service role can INSERT/UPDATE

#### `webhook_events` Table

```sql
create table if not exists public.webhook_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  raw jsonb not null
);

alter table public.webhook_events enable row level security;
```

**Purpose:**
- Idempotency: Prevent duplicate webhook processing
- Audit trail: Debug webhook issues
- No public access: Only service role writes

### Database Functions

#### `increment_entitlement_ver()`

```sql
create or replace function increment_entitlement_ver(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles
  set entitlement_ver = entitlement_ver + 1
  where id = target_user_id;
end;
$$;
```

**Why `security definer`?**
- Runs with function owner's privileges (bypasses RLS)
- Allows service role to increment version safely
- Called from webhook processing (server-side only)

### Files Modified

- Migration: `add_payment_fields_to_profiles` (via Supabase MCP)
- Migration: `create_subscriptions_table` (via Supabase MCP)
- Migration: `create_webhook_events_table` (via Supabase MCP)
- Migration: `add_increment_entitlement_ver_function` (via Supabase MCP)

---

## Phase 2: Checkout Flow (✅ Completed)

### API Routes Created

#### POST `/api/billing/checkout`

**Purpose:** Create Dodo checkout session and redirect user to payment page

**Authentication:** Requires Supabase access token in `Authorization: Bearer <token>` header

**Request Body:**
```typescript
{
  plan_id: "monthly" | "yearly"
}
```

**Response:**
```typescript
{
  checkout_url: string,    // Redirect user here
  session_id: string       // Dodo checkout session ID
}
```

**Implementation Details:**

```typescript
// Location: sonic-flow-site/src/app/api/billing/checkout/route.ts

export async function POST(req: Request) {
  // 1. Verify Supabase JWT from Authorization header
  const token = authHeader.substring(7);
  const { data: { user } } = await supabase.auth.getUser(token);

  // 2. Get plan_id from body, map to product_id
  const { plan_id } = await req.json();
  const productIdMap = {
    monthly: process.env.NEXT_PUBLIC_PRODUCT_ID_MONTHLY!,
    yearly: process.env.NEXT_PUBLIC_PRODUCT_ID_ANNUAL!,
  };
  const product_id = productIdMap[plan_id];

  // 3. Get user's profile to check for existing dodo_customer_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("dodo_customer_id")
    .eq("id", user.id)
    .single();

  // 4. Create Dodo checkout session
  const checkoutPayload = {
    product_cart: [{ product_id, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    return_url: `${SITE_URL}/billing/return`,
    show_saved_payment_methods: true,
    allowed_payment_method_types: ["credit", "debit"],
    // Attach existing customer OR create new one
    ...(profile?.dodo_customer_id
      ? { attach_existing_customer_by_id: profile.dodo_customer_id }
      : { customer: { email: user.email } }
    )
  };

  const response = await fetch(`${DODO_BASE_URL}/checkout-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DODO_API_KEY}`,
    },
    body: JSON.stringify(checkoutPayload),
  });

  const checkoutData = await response.json();

  // 5. Store dodo_customer_id if new customer
  if (checkoutData.customer?.customer_id && !profile?.dodo_customer_id) {
    await supabase
      .from("profiles")
      .update({ dodo_customer_id: checkoutData.customer.customer_id })
      .eq("id", user.id);
  }

  return NextResponse.json({
    checkout_url: checkoutData.url,
    session_id: checkoutData.checkout_session_id,
  });
}
```

**Error Handling:**
- 401: Invalid or missing Supabase JWT
- 400: Invalid plan_id
- 500: Dodo API error or database error

#### GET `/api/billing/status`

**Purpose:** Check user's subscription status and entitlement

**Authentication:** Requires Supabase access token

**Response:**
```typescript
{
  is_active: boolean,
  plan: "free" | "monthly" | "yearly",
  trial: boolean,
  subscription: {
    status: string,
    plan_id: string,
    plan_interval: string,
    current_period_end: string,
    trial_end: string | null,
    cancel_at_period_end: boolean
  } | null
}
```

**Implementation:**

```typescript
// Location: sonic-flow-site/src/app/api/billing/status/route.ts

export async function GET(req: Request) {
  // 1. Verify authentication
  const { data: { user } } = await supabase.auth.getUser(token);

  // 2. Get user's subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. Determine if active
  const now = new Date();
  const isActive = subscription
    && subscription.status === "active"
    && (!subscription.current_period_end
      || new Date(subscription.current_period_end) > now);

  const inTrial = subscription?.trial_end
    && new Date(subscription.trial_end) > now;

  return NextResponse.json({
    is_active: !!isActive,
    plan: isActive ? subscription.plan_id : "free",
    trial: !!inTrial,
    subscription: subscription ? { /* ... */ } : null,
  });
}
```

**Used By:**
- `/billing/return` page (polling for activation)
- Desktop app (checking entitlement before minting token)
- Website UI (showing current plan)

### Frontend Pages

#### `/billing/return` Page

**Purpose:** Landing page after Dodo checkout completion

**Location:** `sonic-flow-site/src/app/billing/return/page.tsx`

**Flow:**
1. User redirected here from Dodo checkout
2. Page checks authentication (Supabase session)
3. Polls `/api/billing/status` every 2 seconds
4. Shows spinner: "Setting up your subscription..."
5. Once `is_active: true`, shows success message
6. Auto-redirects to home after 2 seconds

**Polling Logic:**

```typescript
useEffect(() => {
  const checkSubscription = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const response = await fetch("/api/billing/status", {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await response.json();

    if (data.is_active) {
      setStatus("active");
      clearInterval(pollInterval);
      setTimeout(() => router.push("/"), 2000);
    }
  };

  checkSubscription();
  const pollInterval = setInterval(checkSubscription, 2000);

  // Timeout after 30 seconds (15 attempts)
  setTimeout(() => {
    clearInterval(pollInterval);
    setStatus("failed");
  }, 30000);

  return () => clearInterval(pollInterval);
}, []);
```

**Why Polling?**
- Webhook processing might take 1-5 seconds
- User lands on return page immediately after Dodo redirect
- Polling provides smooth UX transition from "processing" to "active"

#### Updated Pricing Page

**Location:** `sonic-flow-site/src/app/pricing/page-client.tsx`

**Changes:**
- Added `handleCheckout()` function
- Changed button text: "Join Waitlist" → "Start Free Trial"
- Added loading state during checkout creation
- Added error handling display

```typescript
const handleCheckout = async (planId: "monthly" | "yearly") => {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    alert("Please sign in to continue with checkout");
    return;
  }

  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ plan_id: planId }),
  });

  const { checkout_url } = await response.json();
  window.location.href = checkout_url;
};
```

### Files Modified

- Created: `sonic-flow-site/src/app/api/billing/checkout/route.ts`
- Created: `sonic-flow-site/src/app/api/billing/status/route.ts`
- Created: `sonic-flow-site/src/app/billing/return/page.tsx`
- Modified: `sonic-flow-site/src/app/pricing/page-client.tsx`

---

## Phase 3: Webhook Processing (✅ Completed)

### API Route: POST `/api/dodo/webhook`

**Purpose:** Receive and process webhook events from Dodo Payments

**Authentication:** HMAC SHA256 signature verification

**Headers Required:**
- `webhook-id` - Unique event identifier
- `webhook-timestamp` - Event timestamp
- `webhook-signature` - HMAC signature (format: `v1,{base64_signature}`)

**Location:** `sonic-flow-site/src/app/api/dodo/webhook/route.ts`

### Signature Verification

**Standard Webhooks Spec:**

```typescript
function verifySignature(
  payload: string,
  signature: string,
  webhookId: string,
  timestamp: string,
): boolean {
  // Build signed message
  const signedMessage = `${webhookId}.${timestamp}.${payload}`;

  // Compute HMAC SHA256
  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(signedMessage)
    .digest("base64");

  // Extract signature (handle both "v1,sig" and "sig" formats)
  const providedSignature = signature.includes(",")
    ? signature.split(",")[1]
    : signature;

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(providedSignature),
  );
}
```

**Why Timing-Safe Comparison?**
- Standard equality (`===`) can leak timing information
- Attackers could brute-force signatures by measuring response time
- `crypto.timingSafeEqual()` takes constant time regardless of match position

### Idempotency Handling

```typescript
// Check if event already processed
const { data: existingEvent } = await supabase
  .from("webhook_events")
  .select("event_id")
  .eq("event_id", eventId)
  .maybeSingle();

if (existingEvent) {
  console.log(`Event ${eventId} already processed, skipping`);
  return NextResponse.json({ received: true, duplicate: true });
}

// Store event for future idempotency checks
await supabase.from("webhook_events").insert({
  event_id: eventId,
  type: eventType,
  raw: event,
});
```

**Why This Matters:**
- Dodo retries failed webhooks (non-2xx responses)
- Network issues can cause duplicate delivery
- Database constraint (`event_id PRIMARY KEY`) prevents duplicate inserts
- Processing logic runs only once per unique event

### Event Handlers

#### `subscription.active`

**When:** Subscription becomes active (after trial start or payment)

**Actions:**
1. Map Dodo `product_id` to internal `plan_id`
2. Determine `plan_interval` from billing period
3. Upsert subscription record (creates if new, updates if exists)
4. Do NOT bump `entitlement_ver` (subscription is activating, not revoking)

```typescript
async function handleSubscriptionActive(userId: string, data: WebhookEventData) {
  const productId = data.product_id || "";
  const planIdMap = {
    [process.env.NEXT_PUBLIC_PRODUCT_ID_MONTHLY!]: "monthly",
    [process.env.NEXT_PUBLIC_PRODUCT_ID_ANNUAL!]: "yearly",
  };
  const planId = planIdMap[productId] || "monthly";
  const planInterval = data.billing_period?.unit || (planId === "yearly" ? "year" : "month");

  await supabase.from("subscriptions").upsert({
    user_id: userId,
    dodo_subscription_id: data.subscription_id,
    plan_id: planId,
    product_id: productId,
    status: "active",
    plan_interval: planInterval,
    current_period_start: data.current_period_start,
    current_period_end: data.current_period_end,
    trial_end: data.trial_end,
    cancel_at_period_end: data.cancel_at_period_end || false,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "dodo_subscription_id",
  });
}
```

#### `subscription.renewed`

**When:** Subscription renews for next billing period

**Actions:**
1. Update `current_period_start` and `current_period_end`
2. Ensure `status = 'active'`
3. Do NOT bump `entitlement_ver` (renewal is not a revocation event)

```typescript
async function handleSubscriptionRenewed(userId: string, data: WebhookEventData) {
  await supabase
    .from("subscriptions")
    .update({
      current_period_start: data.current_period_start,
      current_period_end: data.current_period_end,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("dodo_subscription_id", data.subscription_id);
}
```

#### `subscription.on_hold` / `subscription.failed`

**When:** Payment failed but subscription not yet expired

**Actions:**
1. Update `status` to 'on_hold' or 'failed'
2. **Bump `entitlement_ver`** to revoke existing tokens
3. User loses access immediately

```typescript
async function handleSubscriptionFailed(userId: string, data: WebhookEventData) {
  await supabase
    .from("subscriptions")
    .update({
      status: data.status, // 'on_hold' or 'failed'
      updated_at: new Date().toISOString(),
    })
    .eq("dodo_subscription_id", data.subscription_id);

  // Revoke tokens by incrementing version
  await supabase.rpc("increment_entitlement_ver", { target_user_id: userId });
}
```

#### `subscription.cancelled` / `subscription.expired`

**When:** User cancels or subscription expires

**Actions:**
1. Update `status` to 'canceled' or 'expired'
2. **Bump `entitlement_ver`** to revoke existing tokens
3. Set `cancel_at_period_end` if provided

```typescript
async function handleSubscriptionCancelled(userId: string, data: WebhookEventData) {
  await supabase
    .from("subscriptions")
    .update({
      status: data.status,
      cancel_at_period_end: data.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
    })
    .eq("dodo_subscription_id", data.subscription_id);

  await supabase.rpc("increment_entitlement_ver", { target_user_id: userId });
}
```

#### `subscription.plan_changed`

**When:** User switches from monthly to yearly (or vice versa)

**Actions:**
1. Update `product_id`, `plan_id`, and `plan_interval`
2. Do NOT bump `entitlement_ver` (still active, just different plan)

```typescript
async function handleSubscriptionPlanChanged(userId: string, data: WebhookEventData) {
  const productId = data.product_id || "";
  const planIdMap = {
    [process.env.NEXT_PUBLIC_PRODUCT_ID_MONTHLY!]: "monthly",
    [process.env.NEXT_PUBLIC_PRODUCT_ID_ANNUAL!]: "yearly",
  };
  const planId = planIdMap[productId] || "monthly";
  const planInterval = data.billing_period?.unit || (planId === "yearly" ? "year" : "month");

  await supabase
    .from("subscriptions")
    .update({
      product_id: productId,
      plan_id: planId,
      plan_interval: planInterval,
      updated_at: new Date().toISOString(),
    })
    .eq("dodo_subscription_id", data.subscription_id);
}
```

### Events Subscribed To

In Dodo Dashboard → Webhooks → Edit Endpoint, subscribe to:

- ✅ `subscription.active`
- ✅ `subscription.renewed`
- ✅ `subscription.on_hold`
- ✅ `subscription.failed`
- ✅ `subscription.cancelled`
- ✅ `subscription.expired`
- ✅ `subscription.plan_changed`

Optional (analytics):
- ⚪ `payment.succeeded`
- ⚪ `payment.failed`

### Test Endpoint: GET `/api/dodo/webhook-test`

**Purpose:** Verify webhook endpoint is reachable and configured

**Response:**
```json
{
  "status": "ok",
  "message": "Webhook endpoint is reachable",
  "timestamp": "2025-11-27T16:30:00.000Z",
  "env_check": {
    "has_webhook_secret": true,
    "has_supabase_url": true,
    "has_service_key": true
  }
}
```

**Use Case:**
- Quick health check before testing full checkout
- Verify environment variables are set
- Debug Dodo webhook delivery issues

### Files Created

- Created: `sonic-flow-site/src/app/api/dodo/webhook/route.ts`
- Created: `sonic-flow-site/src/app/api/dodo/webhook-test/route.ts`

---

## Phase 4: Entitlement Token Minting (✅ Completed)

### Overview

Phase 4 creates the "ticket" system that allows the desktop app to prove payment to the Cloudflare Worker. Tokens are short-lived JWTs with embedded entitlement information.

### Understanding Two Different JWTs

**IMPORTANT:** This system uses TWO different JWTs for different purposes:

#### 1. Supabase JWT (Authentication - "Who are you?")

**Created by:** Supabase Auth Service
**Signed with:** Supabase's secret
**Purpose:** Proves user identity
**Lifetime:** 1 hour
**Contains:**
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",
  "aud": "authenticated"
}
```

**Used for:**
- Calling Next.js API routes
- Supabase database queries (RLS)
- Proving "I'm logged in as this user"

#### 2. Entitlement JWT (Authorization - "Did you pay?")

**Created by:** Your Next.js API
**Signed with:** YOUR secret (`ENTITLEMENT_SIGNING_SECRET`)
**Purpose:** Proves payment status
**Lifetime:** 30 minutes
**Contains:**
```json
{
  "sub": "user-uuid",
  "is_active": true,
  "plan": "monthly",
  "trial": false,
  "ver": 1
}
```

**Used for:**
- Proving to Worker "I have an active subscription"
- Fast authorization check (no DB lookup)
- Revocation via version number

#### Why We Need Both

```
Desktop App Flow:
─────────────────
1. App calls Next.js API: "Give me entitlement token"
   Authorization: Bearer <SUPABASE_JWT>  ← Proves identity

2. Next.js verifies Supabase JWT
   ✅ "This is user ABC, they're authenticated"

3. Next.js checks subscription in database
   ✅ "User ABC has active subscription"

4. Next.js creates ENTITLEMENT JWT
   Signs with YOUR secret

5. Returns entitlement token to app

6. App connects to Worker
   ?token=<ENTITLEMENT_JWT>  ← Proves payment

7. Worker verifies entitlement JWT
   ✅ "This token says is_active=true, allow transcription"
```

**Why Not Just Use Supabase JWT for Everything?**

❌ **Problem 1:** Supabase doesn't know about subscriptions
- Supabase JWT has no `is_active` or `plan` claims
- Would need database check on EVERY request (slow!)

❌ **Problem 2:** Worker can't verify Supabase JWTs easily
- Supabase JWTs are signed with Supabase's secret
- Worker would need to call Supabase to verify

❌ **Problem 3:** No revocation mechanism
- Supabase JWTs live for 1 hour
- If user cancels, they'd still have access for 1 hour
- Our `ver` claim allows instant revocation

✅ **Our Approach:** Custom JWT with payment-specific claims
- Fast Worker checks (< 1ms, no DB query)
- Revocation via version number
- Security: Only your Worker can verify (has your secret)

#### Why Client-Side Checks Aren't Enough

**You might think:** "Why not just check subscription client-side, and if they don't have one, don't connect to Worker?"

**The Problem:** Client code can be bypassed!

```typescript
// ❌ Client-only check (easily bypassed)
if (!hasSubscription) {
  showUpgradePrompt();
  return; // User can edit this in DevTools!
}
ws.connect(workerUrl);
```

**A malicious user can:**
- Open DevTools → Edit client code to skip the check
- Call your Worker directly with `curl` or Postman
- Get free transcription forever!

**✅ The Right Approach: Defense in Depth**

We do **BOTH**:

1. **Client-Side Check (UX Layer)** - Fast feedback, good UX
2. **Worker-Side Check (Security Layer)** - Cannot be bypassed

**Worker MUST be the final enforcer because:**
- ❌ Client code runs on user's machine (they control it)
- ✅ Worker code runs on Cloudflare (you control it)

### Why `jose` Library?

**We use `jose` for JWT operations because:**

1. **Complex crypto operations**
   - base64url encoding (different from regular base64)
   - HMAC-SHA256 signature generation
   - Proper JWT structure (header.payload.signature)

2. **Security-critical**
   - Easy to mess up crypto yourself
   - Battle-tested library prevents mistakes

3. **Works everywhere**
   - Next.js API routes (Node.js)
   - Cloudflare Workers (Edge runtime)
   - Modern, well-maintained

**Could we do this without `jose`?**
- Technically yes, but you'd have to implement HMAC-SHA256, base64url encoding, timing-safe comparison, etc.
- High risk of security mistakes!

### Performance: JWT vs Database Lookup

**❌ Slow approach (50-100ms per request):**
```typescript
// Query Supabase on EVERY connection
const { data: subscription } = await supabase
  .from('subscriptions')
  .select('status')
  .eq('user_id', userId)
  .single();
```

**✅ Fast approach (< 1ms):**
```typescript
// Verify JWT locally (no network call!)
const { payload } = await jwtVerify(token, secret);
```

**Benefits:**
- ⚡ 50-100x faster
- 📉 Reduces Supabase API calls
- 💰 Lower costs
- 🎯 Still secure (signed by you)

### API Route: POST `/api/billing/entitlement-token`

**Purpose:** Mint a short-lived JWT entitlement token for authenticated users

**Location:** `sonic-flow-site/src/app/api/billing/entitlement-token/route.ts`

**Authentication:** Requires Supabase access token in `Authorization: Bearer <token>` header

**Response:**
```typescript
{
  token: string,  // JWT with 30min expiry
  expires_at: string,  // ISO timestamp
}
```

### Token Structure (JWT)

**Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload (Claims):**
```json
{
  "sub": "uuid-user-id",
  "is_active": true,
  "plan": "monthly" | "yearly" | "free",
  "trial": false,
  "ver": 1,
  "iat": 1701234567,
  "exp": 1701236367
}
```

**Claim Definitions:**
- `sub` - Subject: User's UUID from Supabase auth
- `is_active` - Boolean: Whether user has active subscription
- `plan` - String: Current plan ('free', 'monthly', 'yearly')
- `trial` - Boolean: Whether user is in trial period
- `ver` - Integer: Entitlement version from profiles table (for revocation)
- `iat` - Issued At: Unix timestamp
- `exp` - Expiry: Unix timestamp (iat + 30 minutes)

### Implementation

```typescript
// Location: sonic-flow-site/src/app/api/billing/entitlement-token/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";  // Library: jose (installed via: bun add jose)

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SIGNING_SECRET = process.env.ENTITLEMENT_SIGNING_SECRET!;
const TOKEN_EXPIRY_SECONDS = 30 * 60; // 30 minutes

export async function POST(req: Request) {
  try {
    // 1. Verify authentication - get user from Supabase JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2. Get user's subscription status
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Get user's entitlement_ver (for revocation)
    const { data: profile } = await supabase
      .from("profiles")
      .select("entitlement_ver")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "profile-not-found" },
        { status: 404 },
      );
    }

    // 4. Determine entitlement
    const now = new Date();
    const isActive =
      subscription &&
      subscription.status === "active" &&
      (!subscription.current_period_end ||
        new Date(subscription.current_period_end) > now);

    const inTrial =
      subscription?.trial_end && new Date(subscription.trial_end) > now;

    const plan = isActive ? subscription.plan_id : "free";

    // 5. Create JWT using jose
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + TOKEN_EXPIRY_SECONDS;

    const secret = new TextEncoder().encode(SIGNING_SECRET);

    const entitlementToken = await new SignJWT({
      sub: user.id,
      is_active: !!isActive,
      plan: plan,
      trial: !!inTrial,
      ver: profile.entitlement_ver,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(secret);

    // 6. Return token
    return NextResponse.json({
      token: entitlementToken,
      expires_at: new Date(exp * 1000).toISOString(),
    });
  } catch (error) {
    console.error("[Entitlement Token] Error:", error);
    return NextResponse.json(
      { error: "server-error", message: String(error) },
      { status: 500 },
    );
  }
}
```

**Key Implementation Details:**

- **Library:** Uses `jose` instead of `jsonwebtoken` (more modern, works in Edge/Workers)
- **Secret encoding:** `new TextEncoder().encode(SIGNING_SECRET)` required by jose
- **JWT builder:** `SignJWT` class with method chaining for claims
- **Error handling:** Try-catch with detailed error logging

### Security Considerations

**Secret Management:**
- `ENTITLEMENT_SIGNING_SECRET` stored in Vercel environment variables
- Same secret used by Cloudflare Worker for verification
- Generated via: `openssl rand -base64 32`
- Current secret: `LXSJWyQxNb2hd1ylmUHURMpfS5CQN4ide415seMlLB0=`

**Token Expiry:**
- 30 minutes balances security and UX
- Desktop app refreshes at 20-minute mark (proactive)
- If app crashes/restarts, token still valid if < 30min old

**Version-Based Revocation:**
- When user cancels, webhook bumps `entitlement_ver` from 1 → 2
- Old tokens still have `ver: 1` embedded
- Worker checks: token.ver === current_ver in database?
- If mismatch → reject token immediately (even if not expired)

**Why Not Database Lookup Per Request?**
- Worker would need to query Supabase on every transcription request
- Adds latency (50-100ms per request)
- Increases database load
- Version check is embedded in token (zero-DB hot path)

### Debug Endpoint: GET `/api/billing/verify-token`

**Purpose:** Decode and verify entitlement tokens for debugging

**Location:** `sonic-flow-site/src/app/api/billing/verify-token/route.ts`

**Usage:**
```bash
curl "https://sonicflow.app/api/billing/verify-token?token=<jwt>"
```

**Response:**
```json
{
  "valid": true,
  "expired": false,
  "time_until_expiry_seconds": 1794,
  "claims": {
    "sub": "user-uuid",
    "is_active": true,
    "plan": "monthly",
    "trial": false,
    "ver": 1,
    "iat": 1701234567,
    "exp": 1701236367,
    "issued_at": "2025-11-27T16:00:00.000Z",
    "expires_at": "2025-11-27T16:30:00.000Z"
  }
}
```

### Files Created

- ✅ `sonic-flow-site/src/app/api/billing/entitlement-token/route.ts` - Token minting endpoint
- ✅ `sonic-flow-site/src/app/api/billing/verify-token/route.ts` - Token verification debug endpoint
- ✅ Installed dependency: `jose@6.1.2` (via `bun add jose`)

### Testing

```bash
# 1. Get Supabase access token (from desktop app or website)
SUPABASE_TOKEN="eyJhbGc..."

# 2. Call entitlement token endpoint
curl -X POST https://sonicflow.app/api/billing/entitlement-token \
  -H "Authorization: Bearer $SUPABASE_TOKEN" \
  -H "Content-Type: application/json"

# Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2025-11-27T17:00:00.000Z"
}

# 3. Decode token (for debugging)
# Visit https://jwt.io and paste token
# Should see claims: sub, is_active, plan, trial, ver, iat, exp
```

---

## Phase 5: Worker Gating (🔧 TODO)

### Overview

Phase 5 adds token verification to the Cloudflare Worker to actually enforce the paywall. Currently, the Worker allows all transcription requests. After this phase, only users with valid entitlement tokens can transcribe.

### Worker Changes

**Location:** `sonic-flow-app/worker/src/handlers/ws.ts`

**Current Flow:**
1. Client connects to WebSocket
2. Worker accepts connection
3. Client sends audio frames
4. Worker transcribes and returns text

**New Flow:**
1. Client connects with `Authorization: Bearer <entitlement_token>` header
2. Worker validates token (signature, expiry, version, is_active)
3. If valid → Accept connection and transcribe
4. If invalid → Close connection with 401/402 and error message

### Token Validation Logic

**File to Create:** `sonic-flow-app/worker/src/auth/entitlement.ts`

```typescript
import jwt from '@tsndr/cloudflare-worker-jwt';  // Cloudflare-compatible JWT library

interface EntitlementClaims {
  sub: string;
  is_active: boolean;
  plan: string;
  trial: boolean;
  ver: number;
  iat: number;
  exp: number;
}

export interface TokenValidationResult {
  valid: boolean;
  claims?: EntitlementClaims;
  error?: string;
}

export async function validateEntitlementToken(
  token: string,
  secret: string,
): Promise<TokenValidationResult> {
  try {
    // 1. Verify signature and decode
    const isValid = await jwt.verify(token, secret, { algorithm: 'HS256' });

    if (!isValid) {
      return { valid: false, error: 'invalid-signature' };
    }

    const decoded = jwt.decode(token);
    const claims = decoded.payload as EntitlementClaims;

    // 2. Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      return { valid: false, error: 'token-expired' };
    }

    // 3. Check is_active claim
    if (!claims.is_active) {
      return { valid: false, error: 'subscription-inactive' };
    }

    // 4. Return valid with claims
    return { valid: true, claims };
  } catch (error) {
    console.error('[Auth] Token validation error:', error);
    return { valid: false, error: 'validation-error' };
  }
}

export function getAuthorizationToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
```

### WebSocket Handler Integration

**File to Modify:** `sonic-flow-app/worker/src/handlers/ws.ts`

```typescript
import { validateEntitlementToken, getAuthorizationToken } from '../auth/entitlement';

export async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  // 1. Extract token from Authorization header
  const token = getAuthorizationToken(request);

  if (!token) {
    return new Response('Missing authorization token', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 2. Validate token
  const validation = await validateEntitlementToken(token, env.ENTITLEMENT_VERIFY_SECRET);

  if (!validation.valid) {
    // Map errors to HTTP status codes
    const statusMap: Record<string, number> = {
      'token-expired': 401,
      'subscription-inactive': 402,
      'invalid-signature': 401,
      'validation-error': 401,
    };

    const status = statusMap[validation.error || 'validation-error'] || 401;
    const message = validation.error === 'subscription-inactive'
      ? 'Payment required. Please upgrade your subscription.'
      : 'Invalid or expired token. Please refresh your session.';

    return new Response(message, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 3. Token valid - proceed with WebSocket upgrade
  const { claims } = validation;
  console.log(`[Auth] Valid token for user ${claims!.sub}, plan: ${claims!.plan}, trial: ${claims!.trial}`);

  // Continue with existing WebSocket logic...
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  await handleWebSocketSession(server, env, claims!.sub);

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

### Grace Period (Optional Enhancement)

**Use Case:** User's token expires mid-transcription

**Implementation:**

```typescript
// In WebSocket session handler
let tokenExpiryWarned = false;

async function checkTokenDuringSession(claims: EntitlementClaims) {
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = claims.exp - now;

  // Warn client when < 2 minutes remaining
  if (timeUntilExpiry < 120 && !tokenExpiryWarned) {
    tokenExpiryWarned = true;

    // Send special message to client
    server.send(JSON.stringify({
      type: 'token-expiring',
      message: 'Your session will expire in 2 minutes. Please refresh.',
      seconds_remaining: timeUntilExpiry,
    }));
  }

  // Grace period: Allow completion if already processing
  if (timeUntilExpiry < 0 && timeUntilExpiry > -120) {
    // Token expired less than 2 minutes ago
    // Allow current request to complete, but warn
    console.warn(`[Auth] Token expired ${-timeUntilExpiry}s ago, grace period active`);
    return true;
  }

  // Hard cutoff after grace period
  if (timeUntilExpiry < -120) {
    server.close(1008, 'Token expired');
    return false;
  }

  return true;
}
```

### Environment Variables

**Add to Cloudflare Worker secrets:**

```bash
# Same secret as used for signing (from Next.js)
ENTITLEMENT_VERIFY_SECRET=LXSJWyQxNb2hd1ylmUHURMpfS5CQN4ide415seMlLB0=

# Set via Wrangler CLI:
wrangler secret put ENTITLEMENT_VERIFY_SECRET
# Then paste the secret when prompted
```

### Files to Create/Modify

- Create: `sonic-flow-app/worker/src/auth/entitlement.ts`
- Modify: `sonic-flow-app/worker/src/handlers/ws.ts`
- Install: `npm install @tsndr/cloudflare-worker-jwt` (in worker directory)

### Testing

**Test 1: Valid Token**
```typescript
// Desktop app code
const ws = new WebSocket('wss://api.sonicflow.app/ws', {
  headers: {
    Authorization: `Bearer ${entitlementToken}`
  }
});

// Expected: Connection accepted, transcription works
```

**Test 2: Missing Token**
```typescript
const ws = new WebSocket('wss://api.sonicflow.app/ws');

// Expected: Connection refused with 401
// Message: "Missing authorization token"
```

**Test 3: Expired Token**
```typescript
// Use token that's > 30 minutes old
const ws = new WebSocket('wss://api.sonicflow.app/ws', {
  headers: { Authorization: `Bearer ${expiredToken}` }
});

// Expected: Connection refused with 401
// Message: "Invalid or expired token. Please refresh your session."
```

**Test 4: Cancelled Subscription**
```typescript
// User with cancelled subscription (entitlement_ver bumped)
// Token has old ver: 1, database has ver: 2

const ws = new WebSocket('wss://api.sonicflow.app/ws', {
  headers: { Authorization: `Bearer ${tokenWithOldVersion}` }
});

// Expected: Connection refused with 402
// Message: "Payment required. Please upgrade your subscription."
```

---

## Phase 6: Desktop App Integration (🔧 TODO)

### Overview

Phase 6 makes the desktop app aware of subscriptions. The app needs to:
1. Check for valid entitlement token before dictation
2. Fetch token from API if missing/expired
3. Refresh token proactively (at 20-minute mark)
4. Handle upgrade prompts when subscription is inactive
5. Show subscription status in UI

### Token Storage

**Library:** `electron-store` (already installed)

**Storage Schema:**

```typescript
// Location: sonic-flow-app/src/utils/entitlementStore.ts

import Store from 'electron-store';

interface EntitlementData {
  token: string;
  expires_at: string; // ISO timestamp
  last_fetched: string; // ISO timestamp
}

const entitlementStore = new Store<{
  entitlement?: EntitlementData;
}>({
  name: 'entitlement',
  clearInvalidConfig: true,
});

export function getEntitlementToken(): string | null {
  const data = entitlementStore.get('entitlement');
  if (!data) return null;

  // Check if expired
  const expiresAt = new Date(data.expires_at);
  if (expiresAt < new Date()) {
    entitlementStore.delete('entitlement');
    return null;
  }

  return data.token;
}

export function setEntitlementToken(token: string, expiresAt: string) {
  entitlementStore.set('entitlement', {
    token,
    expires_at: expiresAt,
    last_fetched: new Date().toISOString(),
  });
}

export function clearEntitlementToken() {
  entitlementStore.delete('entitlement');
}

export function getTimeUntilExpiry(): number | null {
  const data = entitlementStore.get('entitlement');
  if (!data) return null;

  const expiresAt = new Date(data.expires_at);
  const now = new Date();
  return Math.floor((expiresAt.getTime() - now.getTime()) / 1000); // seconds
}
```

### Token Fetching Hook

**Location:** `sonic-flow-app/src/hooks/useEntitlementToken.ts`

```typescript
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  getEntitlementToken,
  setEntitlementToken,
  clearEntitlementToken,
  getTimeUntilExpiry
} from '../utils/entitlementStore';

export function useEntitlementToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchToken = async () => {
    try {
      // Get Supabase session
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Not authenticated');
      }

      // Call entitlement token API
      const response = await fetch(
        `${import.meta.env.VITE_SITE_URL}/api/billing/entitlement-token`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch token');
      }

      const { token: newToken, expires_at } = await response.json();

      // Store in electron-store
      setEntitlementToken(newToken, expires_at);
      setToken(newToken);
      setError(null);

      return newToken;
    } catch (err) {
      console.error('[Entitlement] Failed to fetch token:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      clearEntitlementToken();
      setToken(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Check and refresh on mount
  useEffect(() => {
    const checkToken = async () => {
      // Try to get from store
      const storedToken = getEntitlementToken();

      if (storedToken) {
        const timeUntilExpiry = getTimeUntilExpiry();

        // If > 10 minutes remaining, use stored token
        if (timeUntilExpiry && timeUntilExpiry > 600) {
          setToken(storedToken);
          setLoading(false);
          return;
        }
      }

      // Otherwise fetch new token
      await fetchToken();
    };

    checkToken();

    // Set up refresh interval (check every 5 minutes)
    const interval = setInterval(async () => {
      const timeUntilExpiry = getTimeUntilExpiry();

      // Refresh if < 10 minutes remaining
      if (timeUntilExpiry && timeUntilExpiry < 600) {
        console.log('[Entitlement] Token expiring soon, refreshing...');
        await fetchToken();
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, []);

  return { token, loading, error, refetch: fetchToken };
}
```

### Integration with Transcription Hook

**Location:** `sonic-flow-app/src/hooks/useTranscription.ts`

**Current WebSocket Connection:**
```typescript
const ws = new WebSocket(transcribeWsUrl);
```

**Updated WebSocket Connection:**
```typescript
const { token: entitlementToken, error: tokenError } = useEntitlementToken();

// Before connecting
if (!entitlementToken) {
  console.error('[Transcription] No valid entitlement token');
  // Show upgrade prompt (see UI section below)
  return;
}

// Include token in connection
const ws = new WebSocket(transcribeWsUrl);

// Send token in first message (or via query param if Worker supports)
ws.addEventListener('open', () => {
  // Option 1: Send as first message
  ws.send(JSON.stringify({
    type: 'auth',
    token: entitlementToken,
  }));

  // Option 2: Include in URL (requires Worker changes)
  // const ws = new WebSocket(`${transcribeWsUrl}?token=${entitlementToken}`);
});
```

**Note:** WebSocket constructor doesn't support custom headers in browsers/Electron. Options:
1. Send token as first WebSocket message (requires Worker to buffer and wait)
2. Include token as query parameter (less secure, visible in logs)
3. Use HTTP Upgrade with custom headers (most secure, requires Worker changes)

**Recommended:** Use query parameter for simplicity:

```typescript
const ws = new WebSocket(`${transcribeWsUrl}?token=${entitlementToken}`);
```

**Worker Update (ws.ts):**
```typescript
export async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  // Extract token from URL query parameter
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing authorization token', { status: 401 });
  }

  // Continue with validation...
}
```

### Upgrade Prompt UI

**Location:** `sonic-flow-app/src/components/UpgradePrompt.tsx` *(to be created)*

```typescript
import React from 'react';
import { openExternal } from '../utils/shell';

interface UpgradePromptProps {
  isOpen: boolean;
  onClose: () => void;
  reason: 'no-subscription' | 'expired' | 'failed';
}

export function UpgradePrompt({ isOpen, onClose, reason }: UpgradePromptProps) {
  if (!isOpen) return null;

  const messages = {
    'no-subscription': {
      title: 'Upgrade to Pro',
      description: 'Start your 7-day free trial to unlock unlimited transcription.',
      cta: 'Start Free Trial',
    },
    'expired': {
      title: 'Subscription Expired',
      description: 'Your subscription has expired. Renew to continue using Sonic Flow.',
      cta: 'Renew Subscription',
    },
    'failed': {
      title: 'Payment Failed',
      description: 'We couldn\'t process your payment. Please update your payment method.',
      cta: 'Update Payment',
    },
  };

  const { title, description, cta } = messages[reason];

  const handleUpgrade = () => {
    openExternal('https://sonicflow.app/pricing?source=app');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
        <h2 className="text-2xl font-serif mb-2">{title}</h2>
        <p className="text-gray-600 mb-6">{description}</p>

        <div className="flex gap-3">
          <button
            onClick={handleUpgrade}
            className="flex-1 bg-black text-white py-2 px-4 rounded-lg hover:bg-gray-800 transition"
          >
            {cta}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Handle WebSocket Errors

**In useTranscription.ts:**

```typescript
ws.addEventListener('error', (event) => {
  console.error('[Transcription] WebSocket error:', event);
});

ws.addEventListener('close', (event) => {
  console.log('[Transcription] WebSocket closed:', event.code, event.reason);

  // Handle payment-related closures
  if (event.code === 401 || event.code === 402) {
    // Show upgrade prompt
    setShowUpgradePrompt(true);
    setUpgradeReason(event.code === 402 ? 'no-subscription' : 'expired');
  }
});

// Listen for token-expiring messages from Worker
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'token-expiring') {
    console.warn('[Transcription] Token expiring, refreshing...');
    // Trigger token refresh
    refetchToken();
  }
});
```

### Subscription Status in UI

**Location:** Add to settings/profile page

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function SubscriptionStatus() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SITE_URL}/api/billing/status`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const data = await response.json();
      setStatus(data);
    };

    fetchStatus();
  }, []);

  if (!status) return <div>Loading...</div>;

  return (
    <div className="bg-gray-100 rounded-lg p-4">
      <h3 className="font-semibold mb-2">Subscription</h3>

      {status.is_active ? (
        <>
          <p className="text-green-600 font-medium">Active</p>
          <p className="text-sm text-gray-600">
            Plan: {status.plan === 'monthly' ? 'Pro Monthly' : 'Pro Yearly'}
          </p>
          {status.trial && (
            <p className="text-sm text-gray-600">
              Trial ends: {new Date(status.subscription.trial_end).toLocaleDateString()}
            </p>
          )}
          {status.subscription?.current_period_end && (
            <p className="text-sm text-gray-600">
              Renews: {new Date(status.subscription.current_period_end).toLocaleDateString()}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-gray-600 font-medium">Free</p>
          <button
            onClick={() => openExternal('https://sonicflow.app/pricing')}
            className="mt-2 bg-black text-white text-sm py-1 px-3 rounded hover:bg-gray-800"
          >
            Upgrade to Pro
          </button>
        </>
      )}
    </div>
  );
}
```

### Environment Variables

**Add to app .env:**

```bash
# Website URL for API calls
VITE_SITE_URL=https://sonicflow.app

# Already exists:
# VITE_TRANSCRIBE_WS_URL=wss://api.sonicflow.app/ws
```

### Files to Create/Modify

- Create: `sonic-flow-app/src/utils/entitlementStore.ts`
- Create: `sonic-flow-app/src/hooks/useEntitlementToken.ts`
- Create: `sonic-flow-app/src/components/UpgradePrompt.tsx`
- Modify: `sonic-flow-app/src/hooks/useTranscription.ts`
- Modify: Settings/Profile page to show subscription status
- Modify: `sonic-flow-app/worker/src/handlers/ws.ts` (accept token via query param)

### Testing Checklist

- [ ] App fetches token on startup (if authenticated)
- [ ] Token stored in electron-store
- [ ] Token refreshed at 20-minute mark
- [ ] WebSocket includes token in connection
- [ ] Worker accepts valid token
- [ ] Worker rejects expired token (shows upgrade prompt)
- [ ] Worker rejects cancelled subscription (shows upgrade prompt)
- [ ] Upgrade prompt opens pricing page in browser
- [ ] Settings page shows current subscription status
- [ ] Free users see "Upgrade" button
- [ ] Pro users see plan details and renewal date

---

## Security Considerations

### Secrets Management

**Never Commit:**
- `DODO_API_KEY`
- `DODO_WEBHOOK_SECRET`
- `ENTITLEMENT_SIGNING_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

**Storage:**
- Vercel: Environment Variables dashboard
- Cloudflare Worker: Wrangler secrets (`wrangler secret put`)
- Local development: `.env.local` (gitignored)

**Secret Rotation:**
- If secrets leak, rotate immediately:
  1. Generate new secret
  2. Update Vercel env vars
  3. Update Worker secrets
  4. Deploy changes
  5. Revoke old secret in Dodo dashboard

### Token Security

**JWT Signing:**
- Use HS256 (HMAC with SHA-256)
- 256-bit secret (32 bytes base64 encoded)
- Never expose signing secret to client

**Token Transmission:**
- Always use HTTPS/WSS (encrypted transport)
- Never log tokens in production
- Don't include tokens in URLs (unless necessary for WebSocket)

**Token Storage (Desktop App):**
- electron-store encrypts data at rest on macOS
- Tokens are short-lived (30min) reducing risk
- Clear tokens on logout

### RLS Policies

**Critical:**
- Users can only SELECT their own subscriptions
- Only service role can INSERT/UPDATE subscriptions (via webhooks)
- webhook_events table has no public policies (service role only)

**Verify:**
```sql
-- Test as authenticated user
SELECT * FROM subscriptions WHERE user_id != auth.uid();
-- Should return 0 rows

-- Test insert (should fail)
INSERT INTO subscriptions (user_id, plan_id, status)
VALUES (auth.uid(), 'monthly', 'active');
-- Should error: "new row violates row-level security policy"
```

### Webhook Signature Verification

**Must-Have:**
- Always verify HMAC signature before processing
- Use timing-safe comparison (`crypto.timingSafeEqual`)
- Reject webhooks with missing/invalid signatures

**Never:**
- Process webhooks without verification (spoofing risk)
- Use string equality (`===`) for signature comparison (timing attack risk)
- Trust webhook payload without checking signature

### PCI Compliance

**Good News:**
- Dodo Payments is the Merchant of Record (MoR)
- All card data handled by Dodo (PCI DSS Level 1)
- We never touch or store card numbers

**Our Responsibility:**
- Use HTTPS for all API calls
- Don't log payment details
- Secure webhook secret properly

---

## Environment Variables

### Next.js Website (Vercel)

```bash
# Dodo Payments
DODO_API_KEY=<test_mode_key_or_live_key>
DODO_BASE_URL=https://test.dodopayments.com  # or https://live.dodopayments.com
DODO_WEBHOOK_SECRET=<from_dodo_dashboard>

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>

# Product IDs
NEXT_PUBLIC_PRODUCT_ID_MONTHLY=pdt_AOEzqDX9GHYY5355DmjZK  # test mode
NEXT_PUBLIC_PRODUCT_ID_ANNUAL=pdt_0VV9C2FOJQA6dTVOJb1Ey   # test mode
# When live:
# NEXT_PUBLIC_PRODUCT_ID_MONTHLY=pdt_TlBP6WQRtGtmuzhapmJPI
# NEXT_PUBLIC_PRODUCT_ID_ANNUAL=pdt_fBoNBmi6fYbV3EGfPu3tB

# URLs
NEXT_PUBLIC_SITE_URL=https://sonicflow.app

# Entitlement Tokens
ENTITLEMENT_SIGNING_SECRET=LXSJWyQxNb2hd1ylmUHURMpfS5CQN4ide415seMlLB0=
```

### Cloudflare Worker

```bash
# Entitlement Verification
ENTITLEMENT_VERIFY_SECRET=LXSJWyQxNb2hd1ylmUHURMpfS5CQN4ide415seMlLB0=

# Set via: wrangler secret put ENTITLEMENT_VERIFY_SECRET
```

### Desktop App (.env)

```bash
# Website URL
VITE_SITE_URL=https://sonicflow.app

# Supabase (client-side)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>

# WebSocket (already exists)
VITE_TRANSCRIBE_WS_URL=wss://api.sonicflow.app/ws
```

---

## Testing Guide

### Phase 1-3 Testing (Completed)

**1. Database Tables**
```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('subscriptions', 'webhook_events');

-- Check profiles columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('dodo_customer_id', 'entitlement_ver');

-- Test increment function
SELECT increment_entitlement_ver('<test_user_id>');
SELECT entitlement_ver FROM profiles WHERE id = '<test_user_id>';
-- Should see ver incremented by 1
```

**2. Checkout Flow**
1. Visit `https://sonicflow.app/pricing`
2. Sign in (if not already)
3. Click "Start Free Trial"
4. Should redirect to Dodo checkout
5. Use test card: `4242 4242 4242 4242`, exp `12/25`, CVV `123`
6. Complete checkout
7. Should redirect to `/billing/return`
8. Page polls for 2-30 seconds
9. Should show "Your subscription is now active! 🎉"

**3. Webhook Processing**
```bash
# Check webhook was received
SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 1;
# Should see subscription.active event

# Check subscription was created
SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 1;
# Should see status='active', trial_end set, plan_id='monthly' or 'yearly'

# Check Vercel function logs
# Visit Vercel → Project → Functions → /api/dodo/webhook
# Should see: "[Webhook] ✅ Subscription activated for user ..."
```

**4. Status API**
```bash
# Get Supabase token (from app or website localStorage)
TOKEN="eyJhbGc..."

curl -H "Authorization: Bearer $TOKEN" \
  https://sonicflow.app/api/billing/status

# Should return:
{
  "is_active": true,
  "plan": "monthly",
  "trial": true,
  "subscription": { ... }
}
```

### Phase 4 Testing (TODO)

**1. Token Minting**
```bash
curl -X POST https://sonicflow.app/api/billing/entitlement-token \
  -H "Authorization: Bearer $SUPABASE_TOKEN" \
  -H "Content-Type: application/json"

# Should return:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2025-11-27T17:30:00.000Z"
}
```

**2. Token Decoding**
```bash
# Visit https://jwt.io
# Paste token
# Verify signature with ENTITLEMENT_SIGNING_SECRET
# Check claims: sub, is_active, plan, trial, ver, iat, exp
```

**3. Token Expiry**
```bash
# Wait 31 minutes
# Try using expired token
# Should be rejected by Worker
```

### Phase 5 Testing (TODO)

**1. Valid Token**
```bash
# From desktop app
const ws = new WebSocket('wss://api.sonicflow.app/ws?token=eyJhbGc...');
# Should connect successfully
```

**2. Invalid Token**
```bash
const ws = new WebSocket('wss://api.sonicflow.app/ws?token=invalid');
# Should close with code 401
# Reason: "Invalid or expired token"
```

**3. Cancelled Subscription**
```bash
# Cancel subscription in Dodo dashboard
# Wait for webhook to process (bumps entitlement_ver)
# Try using old token (has old ver)
# Should close with code 402
# Reason: "Payment required. Please upgrade your subscription."
```

### Phase 6 Testing (TODO)

**1. Token Fetching**
- Open desktop app
- Check electron-store: `~/Library/Application Support/sonic-flow/entitlement.json`
- Should see token and expires_at

**2. Token Refresh**
- Wait 20 minutes
- App should auto-refresh token
- Check logs for "[Entitlement] Token expiring soon, refreshing..."

**3. Upgrade Prompt**
- Cancel subscription
- Try to dictate
- Should show "Upgrade to Pro" modal

**4. Subscription Status UI**
- Open settings
- Should see current plan and renewal date

---

## Troubleshooting

### Issue: Webhook not processing

**Symptoms:**
- Return page keeps showing "Setting up..."
- No rows in `webhook_events` table
- Vercel logs don't show webhook received

**Fixes:**
1. Check Dodo webhook URL is correct: `https://sonicflow.app/api/dodo/webhook`
2. Verify `DODO_WEBHOOK_SECRET` matches Dodo dashboard
3. Check Dodo webhook logs (Dashboard → Webhooks → View Logs)
4. Test webhook endpoint: `curl https://sonicflow.app/api/dodo/webhook-test`

### Issue: Invalid signature error

**Symptoms:**
- Vercel logs show "Invalid webhook signature"
- Webhook event not inserted into database

**Fixes:**
1. Copy webhook secret from Dodo dashboard again
2. Update `DODO_WEBHOOK_SECRET` in Vercel
3. Redeploy Next.js app
4. Test with new checkout

### Issue: Token expired immediately

**Symptoms:**
- Desktop app says token expired right after fetching

**Fixes:**
1. Check system clock is correct (NTP sync)
2. Verify token `exp` claim: `jwt.io`
3. Check if `iat` and `exp` are reasonable (30min apart)
4. Ensure using Unix timestamps (seconds, not milliseconds)

### Issue: Worker rejects valid token

**Symptoms:**
- Token validates on jwt.io but Worker returns 401

**Fixes:**
1. Verify `ENTITLEMENT_VERIFY_SECRET` matches `ENTITLEMENT_SIGNING_SECRET`
2. Check Worker logs for validation errors
3. Ensure same algorithm (HS256) on both sides
4. Test token signature: `jwt.verify(token, secret)`

### Issue: No subscription after checkout

**Symptoms:**
- Checkout succeeds but no subscription in database
- No webhook event logged

**Fixes:**
1. Check if user's profile has `dodo_customer_id`
   ```sql
   SELECT dodo_customer_id FROM profiles WHERE id = '<user_id>';
   ```
2. If null, manually set it from Dodo dashboard customer ID
3. Trigger webhook manually from Dodo (Dashboard → Webhooks → Resend Event)

### Issue: Duplicate subscriptions

**Symptoms:**
- Multiple rows for same user in subscriptions table

**Fixes:**
1. This shouldn't happen due to `dodo_subscription_id` unique constraint
2. If it does, check webhook idempotency logic
3. Verify `event_id` is being stored correctly
4. Clean up duplicates:
   ```sql
   DELETE FROM subscriptions
   WHERE id NOT IN (
     SELECT MAX(id) FROM subscriptions GROUP BY user_id
   );
   ```

---

## Blueprint Reference

This implementation is based on: `sonic-flow-app/plans/PAYMENTS_BLUEPRINT.md`

**Key differences from blueprint:**
- Using query parameter for WebSocket token (not Authorization header, due to browser limitations)
- Storing tokens in electron-store (blueprint mentioned but didn't specify library)
- Added `/api/dodo/webhook-test` endpoint for easier debugging
- TypeScript interfaces for webhook event data (not in blueprint)

**Future Enhancements (from blueprint):**
- Usage-based billing (Dodo Meters)
- Customer portal for plan changes
- Dunning grace periods (12-48 hours)
- Subscription analytics dashboard
