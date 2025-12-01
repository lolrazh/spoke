# Payments Blueprint — Dodo Payments + Supabase + Next.js + Cloudflare Worker

Status: Website stack live (Phases 1-4); App + Worker gating pending  
Owners: Payments/Infra  
Last updated: 2025-11-29

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

Implementation snapshot (2025-11-29)
- ✅ Website (Next.js 15) handles Supabase SSR auth, plan selection, Google OAuth redirect, and creates Dodo checkout sessions directly inside `src/app/api/auth/callback/route.ts` (see agent logs `2025-11-29_1501` and `2025-11-29_1638`).
- ✅ Hosted checkout returns to `/checkout/success` with refined UI, Suspense boundaries, and confetti celebration; supports `?test=success|pending|error` for previews (logs `2025-11-29_2230`, `2025-11-29_2307`).
- ✅ Webhook stack lives at `src/app/api/webhooks/dodo/route.ts` with Supabase service-role access, audit logging, and verified USD/INR payment methods (logs `2025-11-29_2030`, `2025-11-29_2230`).
- ✅ Entitlement token minting + `/api/billing/status` already exist (Phase 4, log `2025-11-27_1630`); database schema matches `docs/DATABASE.md`.
- 🔜 Cloudflare Worker gating (Phase 5) and Electron app integration (Phase 6) still need to consume those tokens, refresh them, and gate transcription sessions.

Scope
- Goal: Gate transcription behind paid subscriptions using Dodo Payments; two fixed plans (Monthly, Yearly) with an optional 7-day trial configured in Dodo.
- Auth model: Supabase Auth (Google OAuth via SSR helpers) handled by the website; desktop app launches the same pricing/auth surface via deep link and then consumes the resulting entitlements.
- Current split: Website covers authentication, checkout, and webhook sync; desktop app + Cloudflare Worker must enforce entitlements using the minted tokens.
- Flow: Pricing page (AuthModal) → Supabase OAuth (`redirectTo` preserves `plan` + `checkout_test`) → `/api/auth/callback` exchanges the code and immediately creates a Dodo hosted checkout session → Dodo redirects back to `/checkout/success` → webhook posts subscription status → Next.js updates `subscriptions` + bumps `profiles.entitlement_ver` → `/api/billing/entitlement-token` issues short-lived tokens → Worker validates the token on each microphone session (zero-DB hot path).

High-level architecture
- Client App (desktop) → opens `https://sonicflow.app/pricing` → Next.js server handles Supabase auth via SSR helpers → OAuth callback instantly creates Dodo Checkout Session (no intermediate checkout page) → Dodo hosted checkout (trial optional) → `/checkout/success` → webhook posts subscription status → server updates Supabase + entitlement_ver (for revocation) → `/api/billing/entitlement-token` issues short-lived entitlement token → Worker validates token per request/connection (no DB call).
- Primary components:
  - Next.js API routes (server-only) to: handle auth callback + checkout creation, issue entitlement tokens, expose billing status, and process Dodo webhooks.
  - Supabase Postgres for billing state (subscriptions) and profiles fields; service role only writes.
  - Cloudflare Worker enforces Authorization: Bearer entitlement token once Phase 5 lands.

Suggested file layout (site repo)
- Next.js API routes
  - [route.ts](src/app/api/auth/callback/route.ts) — Supabase OAuth exchange + Dodo Checkout Session creation
  - [route.ts](src/app/api/webhooks/dodo/route.ts) — Webhook receiver (service-role Supabase client, audit logging)
  - [route.ts](src/app/api/billing/status/route.ts) — Read entitlement status
  - [route.ts](src/app/api/billing/entitlement-token/route.ts) — Issue entitlement token (jose)
- Next.js UI
  - [page.tsx](src/app/pricing/page.tsx) + [page-client.tsx](src/app/pricing/page-client.tsx) — Pricing grid + AuthModal trigger
  - [AuthModal.tsx](src/components/ui/AuthModal.tsx) — Google OAuth modal (SSR-safe)
  - [page.tsx](src/app/checkout/success/page.tsx) — Success/pending/error confirmation (confetti support)
- Worker (Cloudflare)
  - [ws.ts](worker/src/handlers/ws.ts:1) — WS entry; gate by Authorization: Bearer (Phase 5)
  - [entitlement.ts](worker/src/auth/entitlement.ts:1) — Token verification helpers (Phase 5)
  - [runtime.ts](worker/src/config/runtime.ts:1) — Secrets/JWK loading

Data model (Supabase SQL + RLS)
- Mirrors `docs/DATABASE.md` (2025-11-30). Enable RLS everywhere; only the service-role clients (Next.js + Worker) perform writes.

```sql
-- Extend profiles for Dodo linkage + fast entitlement revocation
alter table public.profiles
  add column if not exists dodo_customer_id text unique,
  add column if not exists entitlement_ver integer not null default 1;

-- Subscriptions (mirror Dodo; denormalize interval and periods)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id text unique,
  plan_id text not null,              -- 'monthly' | 'yearly' (app-facing)
  product_id text,
  status text not null,               -- 'active' | 'canceled' | 'past_due' | 'on_hold' | 'expired'
  plan_interval text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean default false,
  canceled_at timestamptz,
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

-- Fast revocation helper (Phase 3)
create or replace function public.increment_entitlement_ver(user_uuid uuid)
returns void
language plpgsql
security definer
as $$
  update public.profiles
     set entitlement_ver = entitlement_ver + 1,
         updated_at = now()
   where id = user_uuid;
$$;

-- RLS: restrict public; service-role writes via server/webhook only
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;

create policy if not exists "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- WRITE: no public writes; service role bypasses RLS.
```

Server API surface (Next.js on Vercel)
- `GET /api/auth/callback` → Supabase OAuth redirect handler (Phase 2/3)
  - Exchanges `code` for session via Supabase SSR helpers (no sessionStorage usage).
  - Reads `plan` + `checkout_test` from query params (must be validated).
  - Dynamically imports `dodopayments`, creates checkout session immediately, and redirects to `session.checkout_url` (no intermediate page).
  - Logs product metadata + return URL (`${NEXT_PUBLIC_SITE_URL}/checkout/success`) for debugging.
  - Supabase dashboard must allow wildcard redirect URLs (`/api/auth/callback*`) so params are preserved.
- `POST /api/webhooks/dodo` → Dodo webhook receiver (Phase 4).
  - Uses Supabase service-role client + lazy init to avoid build-time env issues.
  - Verifies Dodo signature, upserts `subscriptions`, writes `webhook_events`, updates `profiles.entitlement_ver` on cancel/on_hold/failed, and handles plan changes.
  - Maps Dodo fields (`previous_billing_date`, `next_billing_date`, `payment_frequency_interval`) to Supabase schema.
- `GET /checkout/success` → User-facing confirmation page.
  - Handles `status=pending|active|error`, `subscription_id`, `plan`, etc.
  - Includes `?test=success|pending|error` for design QA and communicates webhook delay expectations.
- `GET /api/billing/status` → Read entitlement for logged-in user (Supabase auth header required). Used by `/billing/return` (legacy) and planned desktop app polling.
- `POST /api/billing/entitlement-token` → Mint short-lived entitlement token (JWT via `jose`). Response includes `token`, `expires_at`, `plan`, `ver`, `is_active`.

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

Cloudflare Worker gating (zero-DB hot path — Phase 5)
- Desktop app will set `Authorization: Bearer <entitlement-token>` when opening the transcription WS connection.
- Worker validates:
  - Signature (JWK or secret)
  - exp & iat
  - ver (optional: compare against embedded policy value if you push ver to Worker via config; practical approach: rely on short exp, and bump ver for rapid rotation)
  - is_active === true
- If invalid/inactive → close with 401/402 and message prompting refresh or upgrade.
- Grace period: 120 seconds if exp lapses mid-stream; Worker allows request but notifies client to refresh token immediately.

Webhook processing (Dodo)
- Endpoint: `src/app/api/webhooks/dodo/route.ts`
- Verify signature with `DODO_PAYMENTS_WEBHOOK_KEY` (HMAC SHA256). Reject mismatched signatures, allow for `v1,<sig>` header format.
- Idempotency: `INSERT INTO webhook_events(event_id)`; if conflict → skip handler logic.
- Map payload fields carefully (per `2025-11-29_2030` log):
  - `previous_billing_date` → `current_period_start`
  - `next_billing_date` → `current_period_end`
  - `payment_frequency_interval` → `plan_interval`
- Event handling (minimum):
  - `subscription.active`: upsert, set plan/product metadata, leave `entitlement_ver` unchanged.
  - `subscription.renewed`: update billing dates.
  - `subscription.on_hold` / `subscription.failed`: update status + bump `entitlement_ver`.
  - `subscription.cancelled` / `subscription.expired`: update status, set `canceled_at`, bump `entitlement_ver`.
  - `subscription.plan_changed`: update plan metadata.
  - `subscription.failed` prior to payment: log + keep status for debugging.
- Always log raw payload for audit + debugging (goes into `webhook_events`).

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

A) App → Pricing → Checkout (auth-first, direct redirect)
- Desktop app Upgrade opens `https://sonicflow.app/pricing?source=app[&checkout_test=true]`.
- Pricing page renders AuthModal; Google OAuth runs via Supabase SSR helpers. `redirectTo` carries `plan` + `checkout_test`.
- `/api/auth/callback` exchanges the code, ensures profile row exists, creates Dodo checkout session (trial days optional), and redirects to `session.checkout_url`.
- Dodo hosted checkout completes → `return_url` = `/checkout/success`. Page clarifies pending vs active statuses and links to Manage Subscription.
- Webhook flips subscription to `active` a few seconds later; success page explains this delay. Desktop app should wait for `profiles.entitlement_ver` bump or poll `/api/billing/status`, then call `/api/billing/entitlement-token` and cache the token.

B) Website direct → Pricing → Checkout
- Identical to (A); enforce auth via AuthModal before redirecting to checkout. `?checkout_test=true` flag switches CTA copy for internal testing.

C) Checkout without auth (not recommended here; for completeness)
- Create checkout session without Supabase session (Dodo collects email)
- On return_url, prompt sign-in; map dodo_customer_id to user_id via email
- Risks: email mismatches, orphaned customers, delayed entitlement

UI notes (Pricing & Upgrade)
- Pricing page uses WaitlistModal/AuthModal visual language (card width 448px, AuthModal component already live). Keep Suspense boundaries around hooks that call `useSearchParams`.
- CTA copy flips between “Join Waitlist” / “Get Started” by inspecting `checkout_test=true`.
- Ensure Supabase redirect wildcards include query params (`/api/auth/callback*`).
- `/checkout/success` now handles `status` variations, includes confetti on success, and exposes `?test=success|pending|error` for QA. UI should focus on a single primary action per state (Manage Subscription, Back to Home, Try Again).
- “Manage subscription” will eventually create a Dodo customer portal session; server endpoint TBD.

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
  - Pricing CTA + AuthModal route through Supabase OAuth, preserve plan + `checkout_test` params (verify Supabase redirect whitelist allows `?plan=` queries).
  - `/api/auth/callback` creates checkout session and logs payload; verify redirect lands on Dodo.
  - Use correct regional test cards (US vs India) + UPI handles to validate USD and INR flows (see log `2025-11-29_2230` for card numbers). Wrong region cards will surface `subscription.failed` with `payment_method_id: null`.
  - Successful checkout → `/checkout/success?status=active` + webhook `subscription.active` → entitlement `is_active=true`.
  - Pending/incomplete payment → `/checkout/success?status=pending`; confirm message explains webhook delay.
  - Renewal → `subscription.renewed` extends entitlement, `increment_entitlement_ver` not bumped.
  - Cancel/on_hold/failed → entitlement false (respect grace if enabled); verify ver bump invalidates old tokens.
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
- [ ] Confirm Supabase redirect URLs allow `/api/auth/callback*` (with `plan` + `checkout_test` params) for both apex + www domains
- [ ] Ensure Dodo webhook + return URLs both use `https://www.sonicflow.app` (match `NEXT_PUBLIC_SITE_URL`)
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
  - RETURN_URL=https://sonicflow.app/billing/return
- Cloudflare Worker
  - ENTITLEMENT_VERIFY_KEY or ENTITLEMENT_JWK_PUBLIC
  - SENTRY_DSN (optional)

Future extensions
- Usage-based billing: add Dodo Meters + Usage Events and blend with fixed fee (see Ingestion Blueprints); entitlement may carry remaining units or fallback to server check per session.
- Customer portal: expose server endpoint to create Dodo customer portal session for plan changes and payment method updates.
- Dunning grace: configurable grace for failed renewals (e.g., 12–48 hours) before revocation.

Implementation steps (sequenced)
1) Supabase (✅): create/secure tables (`profiles`, `subscriptions`, `webhook_events`), add `increment_entitlement_ver()`, enable RLS.
2) Next.js web stack (✅ Phases 1-4):
   - AuthModal + Supabase SSR helpers.
   - `/api/auth/callback` direct checkout session creation.
   - `/api/webhooks/dodo`, `/api/billing/status`, `/api/billing/entitlement-token`.
   - `/checkout/success` UX polish + logging.
3) Cloudflare Worker (🔜 Phase 5):
   - Add `worker/src/auth/entitlement.ts` and unit tests.
   - Enforce Authorization header in `worker/src/handlers/ws.ts` (reject unauthenticated).
   - Wire JWK/secret via `runtime.ts`.
4) Desktop app (🔜 Phase 6):
   - Provide Upgrade entry points that open pricing with Supabase auth.
   - After purchase, poll `/api/billing/status` or watch `profiles.entitlement_ver`, then call `/api/billing/entitlement-token`.
   - Cache tokens (electron-store), refresh proactively, include `Authorization: Bearer <entitlement>` header in WS requests to Worker.
   - Surface entitlement errors (e.g., prompt to upgrade, retry token fetch).
5) QA in Dodo Test Mode: cover USD/INR, pending/error, idempotency, stress token refresh.
6) Go live: switch keys/URLs, verify webhook deliveries, monitor Worker metrics, ramp enforcement flag.

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
