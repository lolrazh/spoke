# Payments Integration Phase 4: Webhook Handler & Debugging

**Date:** 2025-11-29
**Agent:** Claude (Sonnet 4.5)
**Status:** ⚠️ Partial - Webhook handler built, but payment flow broken

## Note

This was not implemented in the app repository, but in the site repository. These logs have been added for context related to the payments infra setup.

## User Intention

User wanted to implement Phase 4 (Webhooks) and Phase 5 (Success Page) of the Dodo Payments integration. The goal was to receive webhook events when subscriptions are created/updated and store them in Supabase, completing the end-to-end payment flow. During testing, we discovered the checkout flow itself is broken - payments are not completing successfully, preventing webhooks from ever firing.

## What We Accomplished

- ✅ **Complete webhook handler** - Built `/api/webhooks/dodo/route.ts` with handlers for all 7 subscription lifecycle events
- ✅ **Database schema updated** - Added missing `canceled_at` column to subscriptions table
- ✅ **WWW domain standardization** - Fixed www vs non-www domain inconsistency issues
- ✅ **Environment variable consolidation** - Switched from `NEXT_PUBLIC_BASE_URL` to existing `NEXT_PUBLIC_SITE_URL`
- ⚠️ **Payment flow debugging** - Identified that checkout creates subscriptions with `status=pending` and "requires payment method", but root cause not yet resolved

## Technical Implementation

### Webhook Handler Architecture

**File:** `src/app/api/webhooks/dodo/route.ts` (325 lines)

**Pattern:** Lazy initialization with Supabase admin client
```typescript
// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // Bypasses RLS
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getWebhookHandler() {
  if (!webhookHandler) {
    webhookHandler = Webhooks({
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,
      onSubscriptionActive: async (payload) => { /* ... */ },
      // ... other handlers
    });
  }
  return webhookHandler;
}

export async function POST(req: NextRequest) {
  const handler = getWebhookHandler();
  return handler(req);
}
```

**Why lazy initialization:** Prevents build-time errors when environment variables aren't available during Next.js build.

### Event Handlers Implemented

1. **`onSubscriptionActive`** - Creates/updates subscription in DB, sets `dodo_customer_id` in profiles
2. **`onSubscriptionRenewed`** - Updates billing period dates
3. **`onSubscriptionOnHold`** - Marks subscription as on_hold when payment fails
4. **`onSubscriptionCancelled`** - Sets `canceled_at` timestamp and status
5. **`onSubscriptionExpired`** - Marks subscription as expired
6. **`onSubscriptionFailed`** - Logs failed subscription creation attempts
7. **`onSubscriptionPlanChanged`** - Updates plan_id and billing interval on upgrade/downgrade

### Database Changes

**Migration:** `add_canceled_at_to_subscriptions`
```sql
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS canceled_at timestamptz NULL;
```

**Dodo Payload Field Mapping:**
- `previous_billing_date` → `current_period_start` (our DB)
- `next_billing_date` → `current_period_end` (our DB)
- `payment_frequency_interval` → `plan_interval` (month/year)

### Files Modified

- `src/app/api/webhooks/dodo/route.ts` - Created complete webhook handler
- `src/app/api/auth/callback/route.ts` - Changed `NEXT_PUBLIC_BASE_URL` to `NEXT_PUBLIC_SITE_URL`
- `.env.example` - Updated to document `NEXT_PUBLIC_SITE_URL` instead of `BASE_URL`
- `next.config.js` - Attempted to add www redirect (later reverted by user)
- Database: Added `canceled_at` column to `subscriptions` table

## Bugs & Issues Encountered

### 1. **TypeScript Build Error: `any` Type Not Allowed**
**Symptom:** Build failed with error on line 327: `Unexpected any. Specify a different type.`
```typescript
async function logWebhookEvent(payload: any) { // ❌
```
**Fix:** Changed to `Record<string, unknown>`
```typescript
async function logWebhookEvent(payload: Record<string, unknown>) { // ✅
```

### 2. **TypeScript Type Error: Dodo Payload Field Names**
**Symptom:** Build failed - `current_period_start` doesn't exist on Dodo subscription payload type
```typescript
current_period_start: subscriptionData.current_period_start, // ❌ Wrong field name
```
**Root Cause:** Dodo uses different field names than expected
**Fix:** Updated to use correct Dodo API field names:
```typescript
current_period_start: subscriptionData.previous_billing_date, // ✅
current_period_end: subscriptionData.next_billing_date, // ✅
```

### 3. **WWW vs Non-WWW Domain Mismatch**
**Symptom:**
- Test webhooks from Dodo dashboard worked (sent to `www.sonicflow.app`)
- Real checkout webhooks didn't fire at all (no logs in Dodo or Vercel)

**Root Cause:** Checkout session created with `return_url` using non-www domain, but webhook endpoint configured with www domain

**Investigation Steps:**
1. Discovered `NEXT_PUBLIC_BASE_URL` not set in environment
2. Auth callback fell back to `origin` variable (which could be www or non-www)
3. Webhook URL in Dodo configured as `https://www.sonicflow.app/api/webhooks/dodo`

**Fix:** User already had `NEXT_PUBLIC_SITE_URL=https://www.sonicflow.app` configured, so updated code to use that instead

### 4. **Payment Flow Broken: Subscriptions Stuck in "Pending" Status** ⚠️ UNRESOLVED
**Symptom:**
- User completes checkout and is redirected to success page
- URL shows: `https://www.sonicflow.app/checkout/success?subscription_id=sub_tRVBTAgqdpQwnxbpvXTLw&status=pending`
- Dodo dashboard shows subscription with status "pending" and "requires payment method"
- No webhook ever fires (not in Dodo logs, not in Vercel logs)
- Database query confirms: No subscription rows, no webhook_events rows

**What This Means:**
- Checkout session created successfully ✅
- User redirected to Dodo checkout page ✅
- Payment was NOT completed ❌
- Webhook never sent because there's no successful payment to webhook about ❌

**User Confirmation:**
- Webhook URL is correct: `https://www.sonicflow.app/api/webhooks/dodo` ✅
- `subscription.active` event is selected in Dodo webhook config ✅
- Environment is test_mode (matches code) ✅
- Product is configured as Subscription with 1 month interval ✅
- Trial period is 0 days ✅

**Current Hypothesis:** Something in the checkout session creation or the checkout page itself is preventing payment submission. The subscription is created in "pending" state but payment never processes.

**Needs Investigation:**
- What happens on Dodo's checkout page when user clicks "Pay"?
- Are there JavaScript errors preventing form submission?
- Is the checkout session properly initialized?
- Does the payment form even render?

## Key Learnings

### Dodo Payments API Behavior

1. **Subscription Status Flow:**
   - `pending` = Subscription created but payment not yet completed
   - `active` = Payment succeeded, webhook fires with `subscription.active` event
   - `on_hold` = Renewal payment failed, Dodo retrying
   - Webhooks only fire when payment succeeds, not when subscription is first created

2. **Webhook Timing:**
   - Redirect happens **immediately** after user submits payment
   - Webhook fires **asynchronously** (5-30 seconds later for cards, up to 48 hours for Indian payment methods)
   - User sees success page before webhook arrives (this is normal)

3. **Field Naming Differences:**
   - Dodo uses `previous_billing_date` / `next_billing_date`
   - We map to `current_period_start` / `current_period_end` in our DB
   - Always check Dodo docs for actual payload structure

### Next.js & Supabase Patterns

1. **Service Role Key for Webhooks:**
   - Webhooks don't have user sessions or cookies
   - Must use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
   - Create separate client function for webhook operations

2. **Lazy Initialization Pattern:**
   - Prevents build-time errors when env vars not available
   - Cache handler instance to avoid recreating on every request
   - Works around Next.js build process limitations

3. **TypeScript Strict Mode:**
   - No `any` types allowed in build
   - Use `Record<string, unknown>` for dynamic payloads
   - Type imports with `import type` for type-only imports

### Debugging Webhook Issues

1. **Check Both Sides:**
   - Dodo Dashboard → Webhooks → Recent Deliveries (sender logs)
   - Vercel Logs (receiver logs)
   - If nothing in Dodo logs = webhook never sent (payment didn't complete)

2. **Test Webhooks vs Real Webhooks:**
   - Test webhooks from dashboard always fire (bypass payment flow)
   - Real webhooks only fire when payment succeeds
   - If test works but real doesn't = payment flow issue, not webhook config

3. **Domain Consistency:**
   - www vs non-www must match everywhere
   - Checkout return_url, webhook endpoint, OAuth redirects
   - Use environment variable for consistency

## Architecture Decisions

### Decision 1: Lazy Webhook Handler Initialization
**Why:** Next.js build process runs in environment without real env vars. Lazy initialization defers creation until runtime when vars are available.
**Trade-off:** Slightly more complex code, but prevents build failures.

### Decision 2: Separate Supabase Admin Client Function
**Why:** Webhooks need service role access, but we don't want to create client at module level (causes build issues).
**Trade-off:** Function call overhead, but cleaner separation of concerns.

### Decision 3: Upsert Instead of Insert for Subscriptions
**Why:** Dodo retries webhooks if we return errors. Upsert prevents duplicate rows if webhook processed twice.
**Trade-off:** Slightly more complex query, but prevents data integrity issues.

### Decision 4: Log All Webhook Events
**Why:** Debugging webhooks is hard. Complete audit log helps troubleshoot timing issues, missing events, duplicate processing.
**Trade-off:** Extra DB writes, but `webhook_events` table isn't queried in normal operations (debugging only).

### Decision 5: Use Existing NEXT_PUBLIC_SITE_URL Variable
**Why:** User already had this configured in Vercel. No need to introduce new variable with same purpose.
**Trade-off:** None - just used what was already there.

## Ready for Next Session

### ✅ Prepared Items
- Complete webhook handler ready to receive events (once payment flow fixed)
- Database schema complete with all required columns
- Environment variables configured correctly
- WWW domain standardization in place

### 🔧 Needs Work (CRITICAL)
- **Payment flow is broken** - Subscriptions stuck in "pending" status
- Root cause unknown - need to debug checkout session creation or Dodo checkout page
- Possible issues:
  - Missing required field in checkout session creation?
  - Product misconfiguration in Dodo despite user's confirmation?
  - JavaScript error on Dodo's checkout page preventing payment submission?
  - CORS or CSP blocking payment form?

### 🚫 Blocked Items
- Phase 5 (Success Page) can't be tested until payment flow works
- End-to-end testing blocked until webhooks fire
- Production launch blocked until root cause found

## Context for Future

This session built a complete webhook infrastructure for receiving Dodo Payments events, but uncovered a critical bug in the checkout flow itself. The webhook handler is production-ready and will work correctly once payments complete successfully. The next session MUST focus on debugging why payments are not completing - the subscription is created but stuck in "pending" status with "requires payment method" error. This suggests the payment form isn't submitting properly or there's a configuration mismatch between our checkout session creation and Dodo's expectations.

**Critical Next Steps:**
1. Debug what happens on Dodo's checkout page when user clicks "Pay"
2. Check browser console for JavaScript errors during checkout
3. Verify checkout session payload matches Dodo API expectations
4. Consider testing with Dodo support to rule out account-level issues

**Files to Reference:**
- `PAYMENTS_INTEGRATION_PLAN.md` - Original blueprint for all 5 phases
- Previous session logs showing Phase 1-3 implementation
- `src/app/api/auth/callback/route.ts` - Checkout session creation code (likely where bug is)
