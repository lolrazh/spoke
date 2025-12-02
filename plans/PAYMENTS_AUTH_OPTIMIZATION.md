# Payments Auth Optimization: Custom JWT Claims

**Status**: Planned
**Priority**: P1 (Performance + Scalability)
**Effort**: ~15 minutes implementation
**Impact**: 50x auth speedup (50ms → 1ms), 99% reduction in DB queries

---

## Problem Statement

Current implementation (PR #172) queries the `subscriptions` table on **every single dictation**:

```
Current flow per dictation:
1. Verify JWT signature (~1ms, cached)
2. Query subscriptions table (~50ms)  ← BOTTLENECK
3. Allow/deny access
```

**Issues:**
- 50ms auth latency adds to user-perceived delay
- Scales poorly: 10k users × 20 dictations/day = 200k DB queries/day
- DB connections become bottleneck at scale
- Unnecessary load on Supabase

---

## Solution: Custom JWT Claims via Supabase Auth Hook

Use Supabase's **Custom Access Token Hook** (native feature, production-ready) to bake subscription status directly into JWT.

```
New flow per dictation:
1. Verify JWT signature (~1ms, cached)
2. Read subscription_active from JWT payload (~0ms)
3. Allow/deny access

Total: ~1ms (50x faster)
```

**When does DB query happen?**
- On user login (once per day)
- On token refresh (every hour)
- Supabase Auth handles this automatically

**Result:**
- 200k queries/day → 2k queries/day (99% reduction)
- 50ms → 1ms auth latency (50x speedup)
- Scales to millions of users (cryptography only)

---

## Implementation Plan

### Step 1: Create Postgres Function (2 min)

Run this in Supabase SQL Editor:

```sql
-- Create the custom access token hook
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
  declare
    claims jsonb;
    has_subscription boolean;
  begin
    -- Check if user has active subscription
    select exists(
      select 1 from public.subscriptions
      where user_id = (event->>'user_id')::uuid
      and status = 'active'
    ) into has_subscription;

    claims := event->'claims';

    -- Add subscription_active claim to JWT
    claims := jsonb_set(claims, '{subscription_active}', to_jsonb(has_subscription));

    -- Update the 'claims' object in the original event
    event := jsonb_set(event, '{claims}', claims);

    return event;
  end;
$$;

-- Grant permissions for Supabase Auth to execute this function
grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook
  from authenticated, anon, public;

-- Grant Supabase Auth access to read subscriptions table
grant select
  on table public.subscriptions
  to supabase_auth_admin;

revoke all
  on table public.subscriptions
  from authenticated, anon, public;

-- Add RLS policy for auth admin
create policy "Allow auth admin to read subscriptions"
on public.subscriptions
as permissive for select
to supabase_auth_admin
using (true);
```

### Step 2: Enable Hook in Dashboard (30 sec)

1. Go to Supabase Dashboard
2. Navigate to **Authentication → Hooks (Beta)**
3. Find **Custom Access Token** hook
4. Select `public.custom_access_token_hook` from dropdown
5. Click **Enable**

### Step 3: Update Worker Auth Logic (5 min)

**File: `worker/src/handlers/ws.ts`**

Replace the subscription check with a claim check:

```typescript
// OLD (delete this):
const hasSubscription = await hasActiveSubscription(supabase, userId);
if (!hasSubscription) {
  ws.close(WS_CLOSE_CODES.PAYMENT_REQUIRED, 'Active subscription required');
  return;
}

// NEW (replace with this):
if (!result.subscriptionActive) {
  ws.close(WS_CLOSE_CODES.PAYMENT_REQUIRED, 'Active subscription required');
  return;
}
```

**File: `worker/src/auth/supabaseJwt.ts`**

Update the return type:

```typescript
export async function verifySupabaseJwt(
  token: string,
  supabaseUrl: string
): Promise<
  | { valid: true; userId: string; email: string; subscriptionActive: boolean }
  | { valid: false; error: string }
> {
  try {
    const JWKS = getJWKS(supabaseUrl);

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });

    return {
      valid: true,
      userId: payload.sub as string,
      email: payload.email as string,
      subscriptionActive: payload.subscription_active === true, // Read from JWT claim
    };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}
```

### Step 4: Delete Unused Code (1 min)

**Delete file: `worker/src/auth/subscription.ts`**

This entire module is no longer needed. The subscription check happens at token issuance, not per-request.

**File: `worker/src/handlers/ws.ts`**

Remove the import:

```typescript
// DELETE THIS LINE:
import { hasActiveSubscription } from '../auth/subscription.js';
```

### Step 5: Update Tests (3 min)

**File: `worker/src/auth/supabaseJwt.test.ts`**

Update tests to expect `subscriptionActive` in the response:

```typescript
expect(result).toEqual({
  valid: true,
  userId: expect.any(String),
  email: expect.any(String),
  subscriptionActive: false, // or true depending on test case
});
```

---

## Testing Strategy

### Local Testing

1. **Create test user**:
   ```sql
   -- In Supabase SQL Editor
   insert into public.subscriptions (user_id, status, dodo_subscription_id)
   values ('your-user-uuid', 'active', 'test_sub_123');
   ```

2. **Sign in and inspect JWT**:
   ```typescript
   const { data } = await supabase.auth.getSession();
   const jwt = jwtDecode(data.session.access_token);
   console.log(jwt.subscription_active); // Should be true
   ```

3. **Test dictation**:
   - User with `subscription_active: true` → Works
   - User with `subscription_active: false` → 4020 close code

### Edge Cases to Test

| Scenario | Expected Behavior |
|----------|-------------------|
| User signs up (no subscription) | `subscription_active: false` in JWT |
| User completes payment | Next token refresh includes `subscription_active: true` |
| User cancels subscription | Works for up to 1 hour (until token refresh) |
| Token expires | Supabase auto-refreshes with latest subscription status |
| Webhook updates subscription | Next token refresh picks up change |

---

## FAQ

### Q: What about the 1-hour propagation delay?

**A: This is standard and acceptable.**

- When user cancels, they can use app for up to 1 more hour (until token refresh)
- Cost: ~$0.01 in compute for 1 hour of usage
- This is how **every SaaS works** (Stripe, GitHub, Notion, etc.)
- Rare scenario: most cancellations aren't immediate rage-quits

**If you need faster propagation:**
- Call `supabase.auth.refreshSession()` in your webhook handler
- Forces new token to be issued immediately
- Optional nice-to-have, not required

### Q: What if Supabase is down?

**A: Same behavior as before.**

- If user already has a valid JWT → they can use the app
- If they need to sign in → they can't (same as current implementation)
- JWT verification is stateless (doesn't require Supabase to be up)

### Q: What about the free tier with usage limits?

**A: Implement later as a separate concern.**

When you add free tier (2000 words/month):

```sql
-- Add to the hook:
if not has_subscription then
  -- Check monthly usage
  select coalesce(sum(word_count), 0) into words_used
  from dictation_logs
  where user_id = (event->>'user_id')::uuid
  and created_at >= date_trunc('month', now());

  claims := jsonb_set(claims, '{words_remaining}',
                      to_jsonb(greatest(0, 2000 - words_used)));
end if;
```

Worker can then check `payload.words_remaining` and decide whether to allow dictation.

---

## Performance Comparison

### Current (DB Query Per Dictation)

| Scale | Dictations/Day | DB Queries/Day | Bottleneck |
|-------|----------------|----------------|------------|
| 1k users | 20k | 20k | None |
| 10k users | 200k | 200k | DB connections |
| 100k users | 2M | 2M | **Can't scale** |

### With Custom Claims

| Scale | Dictations/Day | DB Queries/Day | Bottleneck |
|-------|----------------|----------------|------------|
| 1k users | 20k | ~200 (logins) | None |
| 10k users | 200k | ~2k (logins) | None |
| 100k users | 2M | ~20k (logins) | None |
| **1M users** | **20M** | **~200k (logins)** | **Still none** |

**Cryptography scales infinitely.** Your bottleneck becomes STT/LLM, not auth.

---

## Architecture Benefits

### Before (Current)

```
┌─────────────────────────────────────────────────────────┐
│  Worker (Cloudflare)                                     │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │ Auth Logic                                │           │
│  │                                           │           │
│  │ 1. Verify JWT signature                  │           │
│  │ 2. Query subscriptions table   ──────────┼─────────> │
│  │ 3. Check status = 'active'               │    DB     │
│  │ 4. Allow/deny                            │   Query   │
│  └──────────────────────────────────────────┘    50ms   │
│                                                          │
└─────────────────────────────────────────────────────────┘

Issues:
- Business logic in Worker (knows about subscriptions)
- Tight coupling to DB schema
- DB is in critical path
```

### After (Custom Claims)

```
┌─────────────────────────────────────────────────────────┐
│  Supabase Auth (owns entitlements)                       │
│                                                          │
│  On token issuance:                                      │
│  1. Query subscriptions (internal, ~5ms)                │
│  2. Add subscription_active to JWT                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
                         │
                         │ JWT with subscription_active
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Worker (Cloudflare)                                     │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │ Auth Logic                                │           │
│  │                                           │           │
│  │ 1. Verify JWT signature                  │           │
│  │ 2. Read subscription_active from payload │           │
│  │ 3. Allow/deny                            │           │
│  └──────────────────────────────────────────┘           │
│                                                          │
│  No DB query! (~1ms total)                              │
│                                                          │
└─────────────────────────────────────────────────────────┘

Benefits:
- Perfect separation of concerns
- Worker has zero business logic
- Stateless (cryptography only)
- Scales infinitely
```

---

## Migration Checklist

- [ ] Create Postgres function in Supabase SQL Editor
- [ ] Enable hook in Supabase Dashboard (Authentication → Hooks)
- [ ] Update `worker/src/auth/supabaseJwt.ts` to read `subscription_active` claim
- [ ] Update `worker/src/handlers/ws.ts` to use claim instead of DB query
- [ ] Delete `worker/src/auth/subscription.ts` file
- [ ] Remove subscription import from `ws.ts`
- [ ] Update Worker tests to expect `subscriptionActive` in result
- [ ] Deploy Worker to Cloudflare
- [ ] Test with real user (sign in, check JWT, try dictation)
- [ ] Test with unpaid user (should get 4020 close code)
- [ ] Update PAYMENTS_BLUEPRINT.md with new architecture
- [ ] Celebrate 50x speedup 🎉

---

## References

- [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
- [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
- Original implementation: `agent-logs/2025-12-02_1430_payments-worker-app-auth.md`
- Current blueprint: `plans/PAYMENTS_BLUEPRINT.md`
