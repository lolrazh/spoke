# Payments Blueprint — Dodo Payments + Supabase + Next.js + Cloudflare Worker

Status: design-approved; ready to implement  
Owners: Payments/Infra  
Last updated: 2025-11-21

Contents
- Scope
- High-level architecture
- Data model (Supabase SQL + RLS)
- Server API surface (Next.js on Vercel)
- Entitlement token design (JWT/JWE)
- Cloudflare Worker gating
- Webhook processing (Dodo)
- End-to-end flows
- UI notes (Pricing & Upgrade)
- Security & compliance
- Sandbox testing plan
- Production rollout checklist
- Configuration matrix
- Future extensions
- References

---

Scope
- Goal: Gate transcription behind paid subscriptions using Dodo Payments; two fixed plans (Monthly, Yearly) with a 7-day trial.
- Auth model: Supabase auth (Google sign-in supported) required before checkout (app and website).
- Flow: Hosted Checkout Sessions by Dodo; webhook-driven entitlements; zero-DB hot path for the Worker via short-lived entitlement tokens.

High-level architecture
- Client App (desktop) → opens website pricing → Next.js server creates Dodo Checkout Session → Dodo hosted checkout (trial=7 days) → return_url → webhook posts subscription status → server updates subscriptions and profiles.entitlement_ver (for revocation) → server issues short-lived entitlement token → Worker validates token per request/connection (no DB call).
- Primary components:
  - Next.js API routes (server-only) to: create checkout, issue entitlement tokens, expose billing status, and process Dodo webhooks.
  - Supabase Postgres for billing state (subscriptions) and profiles fields; service role only writes.
  - Cloudflare Worker enforces Authorization: Bearer entitlement token.

Suggested file layout (clickable references per path conventions)
- Next.js API routes
  - [route.ts](apps/web/src/app/api/billing/checkout/route.ts:1) — Create Checkout Session
  - [route.ts](apps/web/src/app/api/dodo/webhook/route.ts:1) — Webhook receiver
  - [route.ts](apps/web/src/app/api/billing/status/route.ts:1) — Read entitlement status
  - [route.ts](apps/web/src/app/api/billing/entitlement-token/route.ts:1) — Issue entitlement token
- Worker (Cloudflare)
  - [ws.ts](worker/src/handlers/ws.ts:1) — WS entry; gate by Authorization: Bearer
  - [entitlement.ts](worker/src/auth/entitlement.ts:1) — Token verification helpers
  - [runtime.ts](worker/src/config/runtime.ts:1) — Secrets/JWK loading

Data model (Supabase SQL + RLS)
- Important: enable RLS and restrict writes to service-role only (Next.js server + webhook). Client never writes these tables directly.

[sql.supabase_schema()](plans/PAYMENTS_BLUEPRINT.md:1)
```sql
-- Extend profiles for Dodo linkage + fast entitlement revocation
alter table public.profiles
  add column if not exists dodo_customer_id text unique,
  add column if not exists entitlement_ver integer not null default 1;

-- Subscriptions (mirror Dodo; denormalize interval and periods)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dodo_subscription_id text unique,
  plan_id text not null,              -- 'monthly' | 'yearly' (app-facing)
  product_id text,                    -- Dodo product_id for the chosen plan
  status text not null,               -- 'active' | 'canceled' | 'past_due' | 'on_hold' | 'expired'
  plan_interval text,                 -- 'month' | 'year' (denormalized)
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Webhook events (idempotency + audit)
create table if not exists public.webhook_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  raw jsonb not null
);

-- RLS: restrict public; service-role writes via server/webhook only
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;

-- READ: allow users to read their own subscription records
create policy if not exists "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- WRITE: no public writes; service role bypasses RLS.
```

Server API surface (Next.js on Vercel)
- POST /api/billing/checkout → create Dodo Checkout Session with trial=7 days
  - Input: product_id (monthly|yearly)
  - Behavior:
    - Ensure profiles.dodo_customer_id is set (reuse by email or attach_existing)
    - Dodo create_checkout_sessions:
      - product_cart: [{ product_id, quantity: 1 }]
      - subscription_data: { trial_period_days: 7 }
      - customer: { email } OR attach_existing by dodo_customer_id
      - return_url: https://yourdomain.com/billing/return
      - show_saved_payment_methods: true
      - allowed_payment_method_types: ['credit','debit', wallets as desired]
      - feature_flags.always_create_new_customer = false
    - Return: { checkout_url, session_id }
- POST /api/dodo/webhook → process events (signature-verified; idempotent)
  - Updates subscriptions; bumps profiles.entitlement_ver on cancel/on_hold/failed for fast token revocation
- GET /api/billing/status → read entitlement for logged-in user (from subscriptions)
- POST /api/billing/entitlement-token → mint short-lived entitlement token (JWT/JWE)

Entitlement token design (JWT/JWE)
- Claims:
  - sub: user_id (uuid)
  - is_active: boolean
  - plan: 'free' | 'pro_monthly' | 'pro_yearly'
  - trial: boolean
  - ver: integer (copied from profiles.entitlement_ver)
  - iat, exp: timestamp; exp = 30 minutes
- Signing:
  - Server signs with HS256 (shared secret) or ES256/EdDSA (preferred with JWK)
  - Store secrets in Vercel project env; Worker loads verification key via CF secrets
- Revocation:
  - On critical events (cancel/on_hold/failed), bump profiles.entitlement_ver and mint new tokens; Worker rejects tokens with stale ver.

Cloudflare Worker gating (zero-DB hot path)
- Client sets Authorization: Bearer <entitlement-token> when connecting/using WS.
- Worker validates:
  - Signature (JWK or secret)
  - exp & iat
  - ver (optional: compare against embedded policy value if you push ver to Worker via config; practical approach: rely on short exp, and bump ver for rapid rotation)
  - is_active === true
- If invalid/inactive → close with 401/402 and message prompting refresh or upgrade.
- Grace period: 120 seconds if exp lapses mid-stream; Worker allows request but notifies client to refresh token immediately.

Webhook processing (Dodo)
- Endpoint: [route.ts](apps/web/src/app/api/dodo/webhook/route.ts:1)
- Verify signature with Dodo webhook secret (reject if invalid); log and return 2xx only when processed.
- Idempotency: INSERT INTO webhook_events(event_id); if conflict → skip processing.
- Event handling (minimum):
  - subscription.active:
    - subscriptions: upsert status=active; set trial_end/current_period_start/end/plan_interval/product_id (and plan_id mapping as needed)
    - profiles: leave entitlement_ver unchanged
  - subscription.renewed:
    - subscriptions: update current_period_*; status remains active
  - subscription.on_hold / subscription.failed:
    - subscriptions: update status accordingly
    - profiles: entitlement_ver = entitlement_ver + 1 (revoke existing tokens)
  - subscription.cancelled / subscription.expired:
    - subscriptions: update status and set cancelled_at if provided
    - profiles: entitlement_ver = entitlement_ver + 1 (revoke existing tokens)
  - subscription.plan_changed:
    - subscriptions: update product_id/plan_interval/plan_id as appropriate
  - payment.succeeded/failed (optional analytics)
- Return 200 quickly; store raw payload for audit.

End-to-end flows

Desktop App → API Authentication
- Desktop app holds Supabase session (access_token JWT from Google OAuth)
- To call Next.js API routes, app includes: Authorization: Bearer <supabase_access_token>
- Next.js API route verifies Supabase JWT using supabase.auth.getUser() with service role
- If valid, route proceeds; user_id extracted from JWT claims
- Entitlement token is then minted and returned to app
- App stores entitlement token in electron-store (short-lived, refreshable, not highly sensitive)
- App refreshes token proactively at 20-minute mark (before 30-min expiry)

Token refresh flow:
1. App checks token exp on startup and before each dictation
2. If exp < 10 minutes remaining → call POST /api/billing/entitlement-token
3. If refresh fails (offline, expired session) → show "Re-authenticate" prompt
4. On Supabase session refresh → also refresh entitlement token

A) App → Pricing → Checkout (auth-first, recommended)
- Desktop app Upgrade opens https://yourdomain.com/pricing?source=app
- If not signed-in → Supabase sign-in → back to pricing
- User selects plan → POST /api/billing/checkout → redirect to checkout_url
- Dodo hosted checkout completes → return_url (/billing/return)
- UI shows setup-in-progress, polls GET /api/billing/status until entitlement active
- App then calls POST /api/billing/entitlement-token and caches the token; refresh proactively

B) Website direct → Pricing → Checkout
- Identical to (A); enforce auth before creating checkout

C) Checkout without auth (not recommended here; for completeness)
- Create checkout session without Supabase session (Dodo collects email)
- On return_url, prompt sign-in; map dodo_customer_id to user_id via email
- Risks: email mismatches, orphaned customers, delayed entitlement

UI notes (Pricing & Upgrade)
- Use BillingSDK + shadcn components for plan UI; keep server logic in API routes
- “Manage subscription”: if using Dodo customer portal session, expose a server endpoint to create portal session and redirect (optional feature)

Security & compliance
- Secrets:
  - DODO_API_KEY (server-only, Vercel)
  - DODO_BASE_URL (test: https://test.dodopayments.com, live: https://live.dodopayments.com)
  - DODO_WEBHOOK_SECRET (server-only, used only by webhook route)
  - ENTITLEMENT_SIGNING_KEY / JWK (server; verification key in Worker secrets)
  - SUPABASE_SERVICE_ROLE_KEY (server-only; never in client/Worker)
- Webhook signature verification mandatory; implement retry-safe idempotency
- No PANs handled; PCI DSS scope limited to hosted checkout (MoR)
- Amounts in smallest currency units (e.g., USD cents)
- 3DS: let Dodo defaults apply; override via session if needed
- Logs: structured logs of session_id, subscription_id, user_id mappings (avoid secrets)

Sandbox testing plan
- Configure staging Vercel + CF Worker to Dodo Test Mode (base URL: https://test.dodopayments.com)
- Create test Monthly/Yearly products mirroring live
- E2E tests:
  - Successful checkout → subscription.active → entitlement is_active=true
  - Renewal → subscription.renewed → extends entitlement.expires_at
  - Cancel at period end → remains active until current_period_end
  - Immediate cancel/on_hold/failed → entitlement false (respect grace if enabled)
- Webhook idempotency: replay same event_id, verify no duplicate effects
- Token path:
  - Entitlement token minted, exp = 30m; Worker accepts; app refreshes at 20m mark
  - Ver bump revokes old tokens on next check
  - Grace period (120s) allows completion of in-progress dictations
- Sentry/observability: alert on webhook non-2xx, Worker 401/402 spikes

Production rollout checklist
- [ ] Switch to live base URL (https://live.dodopayments.com) and live API key
- [ ] Set DODO_WEBHOOK_SECRET (live) and rotate test secrets
- [ ] Verify pricing maps to correct live product_ids
- [ ] Enable feature flag for entitlement enforcement; ramp to 10% / 50% / 100%
- [ ] Alerts:
  - Webhook failures (>=1 in 10 min)
  - Worker 401/402 rate increase
  - Token minting errors
- [ ] Post-deploy verification: new checkout, renewal, cancel, dunning

Configuration matrix (env vars)
- Next.js (Vercel)
  - DODO_API_KEY
  - DODO_BASE_URL (= https://test.dodopayments.com in staging; https://live.dodopayments.com in prod)
  - DODO_WEBHOOK_SECRET
  - ENTITLEMENT_SIGNING_KEY or ENTITLEMENT_JWK (private)
  - SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_URL
  - RETURN_URL (e.g., https://yourdomain.com/billing/return)
- Cloudflare Worker
  - ENTITLEMENT_VERIFY_KEY or ENTITLEMENT_JWK_PUBLIC
  - SENTRY_DSN (optional)

Future extensions
- Usage-based billing: add Dodo Meters + Usage Events and blend with fixed fee (see Ingestion Blueprints); entitlement may carry remaining units or fallback to server check per session.
- Customer portal: expose server endpoint to create Dodo customer portal session for plan changes and payment method updates.
- Dunning grace: configurable grace for failed renewals (e.g., 12–48 hours) before revocation.

Implementation steps (sequenced)
1) Supabase: create tables and enable RLS (apply SQL above)
2) Next.js:
   - Implement [route.ts](apps/web/src/app/api/billing/checkout/route.ts:1) using Dodo SDK/REST (include trial_period_days=7; pass return_url)
   - Implement [route.ts](apps/web/src/app/api/dodo/webhook/route.ts:1) with signature verification + idempotency + status mapping
   - Implement [route.ts](apps/web/src/app/api/billing/status/route.ts:1) deriving entitlement from subscriptions
   - Implement [route.ts](apps/web/src/app/api/billing/entitlement-token/route.ts:1) minting short-lived token
3) Pricing page: call /api/billing/checkout; redirect to checkout_url
4) Desktop app: open pricing; on success, fetch entitlement token and refresh periodically
5) Worker: enforce Authorization: Bearer, validate token, and gate transcription
6) Staging tests in Dodo Test Mode; verify end-to-end and idempotency
7) Go live: configure live keys/URLs; gradual rollout with monitoring

References (verified via Context7 MCP)
- Checkout Sessions with trials
  - https://docs.dodopayments.com/developer-resources/checkout-session
  - Example shows subscription_data.trial_period_days and return_url behavior
- Webhooks
  - https://docs.dodopayments.com/webhooks
  - Event taxonomy: subscription.* (active, renewed, on_hold, cancelled, failed, expired), payment.*
- Base URLs and currency units
  - Test: https://test.dodopayments.com
  - Live: https://live.dodopayments.com
  - Amounts in smallest currency unit (e.g., USD cents)