# Database Architecture

Spoke uses Supabase (PostgreSQL) to manage user data, subscriptions, quota tracking, and telemetry. The database is designed with privacy in mind—transcription text is never stored, only performance metrics.

**Related:** `docs/AUTH.md`, `docs/TRANSCRIPTION.md`, `docs/PAYMENTS.md`

---

## Philosophy

The database serves four core functions:

1. **User Identity**: Profiles linked 1:1 with Supabase Auth users
2. **Subscription Management**: Dodo Payments integration for billing
3. **Free Tier Quota Tracking**: Server-authoritative word count limits (1000 words/week, resets Monday)

Privacy is paramount—all performance telemetry is stored in Cloudflare Analytics Engine (no transcription text). History is stored locally on the user's device.

The quota system is **server-authoritative**: the Cloudflare Worker counts words and writes to the database, ensuring users cannot tamper with their quota. JWT claims provide instant quota gating before audio streams begin.

---

## Schema Overview

<schema>
  <table name="profiles">
    <purpose>User profiles, preferences, and free tier quota tracking (1:1 with auth.users)</purpose>
    <relationship>profiles.id → auth.users.id (FK)</relationship>
    <rows>13</rows>
    <rls>enabled</rls>
  </table>

  <table name="subscriptions">
    <purpose>Dodo Payments subscription records</purpose>
    <relationship>subscriptions.user_id → auth.users.id (FK, 1:N)</relationship>
    <rows>1</rows>
    <rls>enabled</rls>
  </table>

  <table name="webhook_events">
    <purpose>Dodo Payments webhook event audit log</purpose>
    <relationship>None (standalone)</relationship>
    <rows>2</rows>
    <rls>enabled (service role only)</rls>
  </table>

  <table name="waitlist">
    <purpose>Pre-launch email collection</purpose>
    <relationship>None (standalone, public inserts)</relationship>
    <rows>13</rows>
    <rls>disabled</rls>
  </table>
</schema>

---

## Tables

### profiles

User profile data tied to authentication. Each authenticated user gets one profile row.

<table name="profiles">
  <columns>
    id (uuid, PK, FK → auth.users.id)
    email (text, nullable, unique) - For display
    display_name (text, nullable) - Editable in onboarding
    avatar_url (text, nullable) - From OAuth provider
    share_transcriptions (boolean, default false) - Dataset consent
    onboarding_done (boolean, default false) - Skip onboarding if true
    dodo_customer_id (text, nullable, unique) - Dodo Payments customer ID
    words_used_this_week (integer, default 0) - Free tier quota tracking
    quota_reset_date (timestamptz, nullable) - Weekly reset timestamp (Monday 00:00 UTC)
    created_at, updated_at (timestamptz)
  </columns>

  <rls>
    Users can only read/write their own profile (auth.uid() = id).
    Three policies: self read, self insert, self update.
  </rls>

  <integration>
    <file path="src/lib/supabaseClient.ts">
      getProfile(), getProfileDetailed(), ensureProfileRow(),
      updateDisplayName(), setShareTranscriptionsPreference(),
      markOnboardingDone()
    </file>
    <file path="src/state/userIdentity.ts">Client-side identity cache</file>
    <file path="src/components/Onboarding.tsx">Name verification flow</file>
    <file path="worker/src/handlers/ws.ts">
      Worker increments quota via increment_quota_simple() after transcription
    </file>
    <file path="src/state/quotaCache.ts">
      Local quota display cache (synced from JWT on startup)
    </file>
  </integration>

  <quota_tracking>
    Free tier users have a 1000 word/week limit tracked server-side:
    - words_used_this_week: Current usage counter (incremented by worker, reset weekly)
    - quota_reset_date: Next reset date (lazy weekly reset in auth hook, every Monday 00:00 UTC)

    Architecture (server-authoritative):
    1. Worker counts words from STT output (spoken words, not LLM output)
    2. Worker fires increment_quota_simple() in background (waitUntil)
    3. custom_access_token_hook() adds quota to JWT claims on refresh
    4. Worker checks JWT quota at auth time (instant blocking)
    5. App displays quota in UI (localStorage cache, display-only)

    Security: Users cannot tamper - worker is source of truth, JWT is signed.
  </quota_tracking>
</table>

### subscriptions

Dodo Payments subscription lifecycle managed entirely by webhook handler.

<table name="subscriptions">
  <columns>
    id (uuid, PK)
    user_id (uuid, FK → auth.users.id)
    subscription_id (text, nullable, unique) - Dodo subscription ID
    plan_id (text) - e.g., 'plan_monthly', 'plan_yearly'
    product_id (text, nullable)
    status (text) - 'active' | 'canceled' | 'past_due' | 'paused'
    plan_interval (text, nullable) - 'month' | 'year'
    current_period_start, current_period_end, trial_end (timestamptz, nullable)
    cancel_at_period_end (boolean, default false)
    canceled_at (timestamptz, nullable) - When user/admin canceled
    created_at, updated_at (timestamptz)
  </columns>

  <rls>
    Users can SELECT their own subscription (auth.uid() = user_id).
    Service role manages all writes via webhook (no user write access).
  </rls>

  <integration>
    <file path="worker/src/routes/webhooks.ts">Dodo webhook handler (service role)</file>
    <file path="src/lib/supabaseClient.ts">getUserSubscription()</file>
    <usage>
      Webhook creates/updates on subscription events.
      App reads for entitlement checks.
      After update, worker calls increment_entitlement_ver() to notify client.
    </usage>
  </integration>

  <philosophy>
    Single source of truth for billing state.
    App never writes—only reads. Worker handles all lifecycle events.
  </philosophy>
</table>

### webhook_events

Audit log for all Dodo Payments webhook events. Useful for debugging payment flows.

<table name="webhook_events">
  <columns>
    event_id (text, PK) - Dodo event ID (idempotency key)
    type (text) - Event type (e.g., 'subscription.created')
    raw (jsonb) - Full webhook payload
    received_at (timestamptz, default now())
  </columns>

  <rls>
    RLS enabled, but no user policies (service role only).
  </rls>

  <integration>
    <file path="worker/src/routes/webhooks.ts">Logs all Dodo webhook events for debugging</file>
    <usage>
      Append-only audit log, never modified.
      Idempotent inserts using event_id as PK.
    </usage>
  </integration>
</table>

### waitlist

Pre-launch email collection. No relation to users—standalone.

<table name="waitlist">
  <columns>
    id (uuid, PK)
    email (text, unique)
    source (text, nullable) - e.g., 'website', 'twitter'
    created_at (timestamptz)
  </columns>

  <rls>disabled (public inserts allowed)</rls>

  <usage>Simple email collection for launch announcements</usage>
</table>

---

## Functions & Triggers

Database functions provide reusable logic for common operations.

<functions>
  <function name="handle_new_user">
    <signature>handle_new_user() RETURNS trigger</signature>
    <type>Trigger function (VOLATILE, SECURITY DEFINER)</type>
    <trigger>
      Trigger: on_auth_user_created
      Event: AFTER INSERT ON auth.users
      Timing: FOR EACH ROW
    </trigger>
    <action>
      Auto-creates profiles row on user signup with initial data:
      - id: new.id (FK to auth.users.id)
      - email: new.email
      - display_name: coalesce(new.raw_user_meta_data->>'name', '')
      - avatar_url: coalesce(new.raw_user_meta_data->>'avatar_url', '')
    </action>
    <purpose>
      Ensures every authenticated user has a profile row.
      Uses ON CONFLICT (id) DO NOTHING for idempotency.
    </purpose>
    <usage>
      Automatically invoked by Supabase Auth on user registration.
      No manual calls needed.
    </usage>
    <security>
      SET search_path TO 'public' for security isolation.
    </security>
  </function>

  <function name="increment_quota_simple">
    <signature>increment_quota_simple(p_user_id uuid, p_word_count integer) RETURNS void</signature>
    <type>Database function (VOLATILE, SECURITY DEFINER)</type>
    <action>
      Increments words_used_this_week by p_word_count for the given user:
      UPDATE profiles
      SET words_used_this_week = COALESCE(words_used_this_week, 0) + p_word_count
      WHERE id = p_user_id;

      Uses COALESCE to handle NULL initial values.
      Atomic operation - no race conditions.
      Logs warning if user not found in profiles table.
    </action>
    <purpose>
      Server-side quota tracking for free tier users.
      Worker calls this after each transcription to update usage.
    </purpose>
    <usage>
      <file path="worker/src/handlers/ws.ts">
        Called via Supabase RPC with service role key after transcription completes.
        Fire-and-forget pattern using executionCtx.waitUntil() for zero latency.

        await fetch(supabaseUrl + '/rest/v1/rpc/increment_quota_simple', {
          method: 'POST',
          headers: {
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p_user_id: userId, p_word_count: wordCount })
        });
      </file>
    </usage>
    <security>
      Only callable with service role key (bypasses RLS).
      Worker validates user JWT before calling, preventing unauthorized increments.
    </security>
  </function>

  <function name="custom_access_token_hook">
    <signature>custom_access_token_hook(event jsonb) RETURNS jsonb</signature>
    <type>Auth hook (VOLATILE, SECURITY DEFINER)</type>
    <hook_type>Custom Access Token Hook (registered in Supabase Auth settings)</hook_type>
    <action>
      Modifies JWT claims during token generation/refresh:

      1. Checks if user has active subscription (status = 'active')
      2. Adds subscription_active claim to JWT (boolean)
      3. For FREE tier users only (no subscription):
         - Reads words_used_this_week and quota_reset_date from profiles
         - Implements lazy weekly reset (every Monday 00:00 UTC):
           IF quota_reset_date IS NULL OR quota_reset_date &lt; NOW() THEN
             - Reset words_used_this_week to 0
             - Set quota_reset_date to start of next week (Monday)
             - Update profiles table with new values
         - Adds quota claims to JWT:
           - words_used_this_week (integer)
           - quota_limit (1000, hardcoded)
           - quota_reset_date (timestamptz, for debugging)

      Error handling: Returns event with just subscription_active on failure.
    </action>
    <critical_fix>
      MUST be VOLATILE (not STABLE) because it performs UPDATE operations.
      Original bug: Function was STABLE, which prohibits writes in Postgres.
      Symptom: Quota would not sync from database to JWT (silently failed).
      Fixed 2025-12-04 by changing to VOLATILE + SECURITY DEFINER.
      Reference: agent-logs/2025-12-04_1640_fix-quota-system.md
    </critical_fix>
    <purpose>
      Embeds subscription and quota data into JWTs for instant worker-side gating.
      No database queries needed during transcription - all info in signed token.
    </purpose>
    <usage>
      <file path="worker/src/auth/supabaseJwt.ts">
        verifySupabaseJwt() extracts claims from JWT:
        - subscriptionActive (boolean)
        - wordsUsedThisWeek (number, free tier only)
        - quotaLimit (number, free tier only)
      </file>
      <file path="worker/src/handlers/ws.ts">
        WebSocket auth checks JWT quota:
        if (!subscriptionActive && wordsUsed >= quotaLimit) {
          // Close connection with code 4021 (QUOTA_EXCEEDED)
        }
      </file>
      <file path="src/state/quotaCache.ts">
        App syncs local cache from JWT on startup for UI display.
      </file>
    </usage>
    <lazy_reset_logic>
      Weekly reset is lazy (on-demand) rather than scheduled:
      - Avoids cron jobs or scheduled tasks
      - Resets automatically when user next refreshes token after week boundary (Monday 00:00 UTC)
      - Efficient: only resets for users who are active

      Example:
      - User last used app on Monday, Dec 16
      - User opens app on Tuesday, Dec 24 (week after reset date)
      - JWT refresh triggers custom_access_token_hook()
      - Hook sees quota_reset_date (Dec 23 00:00 UTC) &lt; NOW() (Dec 24)
      - Resets words_used_this_week to 0, sets quota_reset_date to Dec 30 (next Monday) 00:00 UTC
      - User starts fresh week with 1000 words
    </lazy_reset_logic>
    <security>
      Runs in database with full access (auth.users, public.profiles, public.subscriptions).
      SET search_path TO 'public', 'auth' for security isolation.
      JWT signature prevents tampering - worker validates all tokens.
      Free tier users cannot forge pro subscription claims.
    </security>
  </function>
</functions>

---

## Security Model

Row Level Security (RLS) ensures users can only access their own data.

<security>
  <principle name="self_access_only">
    Users can only read/write data where auth.uid() = their user ID.
    No cross-user access—policies enforce strict isolation.
  </principle>

  <principle name="service_role_bypass">
    Worker uses service role key for telemetry and webhook processing.
    Bypasses RLS but validates user JWT before writes.
  </principle>

  <auth_flow>
    1. User authenticates via Google OAuth (Supabase Auth)
    2. handle_new_user() trigger creates profiles row
    3. All queries use auth.uid() for RLS filtering
    4. Client caches profile data (src/state/userIdentity.ts)
  </auth_flow>

  <service_role_usage>
    Worker (Cloudflare) uses service role key for:
    - Processing Dodo webhooks (validates signature)
    - Updating subscriptions table
    - Logging webhook_events
  </service_role_usage>
</security>

---

## Key Client Functions

Client-side database operations live in `src/lib/supabaseClient.ts`.

<client_functions>
  <function name="getProfile">
    <signature>async getProfile(): Promise&lt;ProfileRecord | null&gt;</signature>
    <description>
      Returns current user's profile with basic fields (id, email, display_name, avatar_url,
      onboarding_done, share_transcriptions). Used for quick profile checks.
    </description>
  </function>

  <function name="getProfileDetailed">
    <signature>async getProfileDetailed(): Promise&lt;{ok: true, data: ProfileRecord} | {ok: false, error: string}&gt;</signature>
    <description>
      Returns current user's full profile including quota fields (words_used_this_week,
      quota_reset_date) and subscription info. Used for detailed profile views.
      Returns error-wrapped result for better error handling.
    </description>
  </function>

  <function name="ensureProfileRow">
    <signature>async ensureProfileRow(): Promise&lt;void&gt;</signature>
    <description>
      Creates profile if missing (upsert pattern). Used during onboarding flow to ensure
      profile exists before updating fields. Handles race conditions with ON CONFLICT.
    </description>
  </function>

  <function name="updateDisplayName">
    <signature>async updateDisplayName(name: string): Promise&lt;void&gt;</signature>
    <description>
      Updates display_name with retry logic for handling concurrent updates.
      Called from onboarding flow when user confirms/edits their name.
    </description>
  </function>

  <function name="setShareTranscriptionsPreference">
    <signature>async setShareTranscriptionsPreference(share: boolean): Promise&lt;void&gt;</signature>
    <description>
      Updates share_transcriptions consent flag. When true, worker logs STT/LLM
      input/output for dataset collection. Always user-controlled, opt-in only.
    </description>
  </function>

  <function name="markOnboardingDone">
    <signature>async markOnboardingDone(): Promise&lt;void&gt;</signature>
    <description>
      Sets onboarding_done = true. Called after user completes onboarding flow
      (name verification, permissions granted). Prevents onboarding from showing again.
    </description>
  </function>

  <function name="getUserSubscription">
    <signature>async getUserSubscription(): Promise&lt;Subscription | null&gt;</signature>
    <description>
      Fetches active subscription (status = 'active'). Returns most recent if multiple exist.
      Used to check Pro tier status for UI features (though JWT claims are primary source).
    </description>
    <note>
      JWT claims (subscription_active) are the primary source of truth for entitlement checks.
      This function is mainly for displaying subscription details in settings/UI.
    </note>
  </function>
</client_functions>

---

## Common Query Patterns

<queries>
  <query name="Check onboarding status">
    SELECT onboarding_done FROM profiles WHERE id = auth.uid()
  </query>

  <query name="Get user profile with quota">
    SELECT
      id, email, display_name, avatar_url,
      onboarding_done, share_transcriptions,
      words_used_this_week, quota_reset_date
    FROM profiles
    WHERE id = auth.uid()
  </query>

  <query name="Get user subscription">
    SELECT * FROM subscriptions
    WHERE user_id = auth.uid()
    AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  </query>

  <query name="Increment quota (worker via RPC)">
    -- Called via Supabase REST API:
    -- POST /rest/v1/rpc/increment_quota_simple
    -- Body: { "p_user_id": "uuid", "p_word_count": 42 }

    SELECT increment_quota_simple($1::uuid, $2::integer);

    -- Function atomically updates:
    -- UPDATE profiles
    -- SET words_used_this_week = COALESCE(words_used_this_week, 0) + $2
    -- WHERE id = $1;
  </query>

  <query name="Check quota in auth hook">
    -- Runs inside custom_access_token_hook()
    SELECT words_used_this_week, quota_reset_date
    FROM public.profiles
    WHERE id = (event->>'user_id')::uuid;

    -- If reset needed (when reset_date &lt; NOW()):
    UPDATE public.profiles
    SET
      words_used_this_week = 0,
      quota_reset_date = DATE_TRUNC('week', NOW() + INTERVAL '1 week')
    WHERE id = (event->>'user_id')::uuid;
  </query>

  <query name="Log webhook event (worker)">
    INSERT INTO webhook_events (event_id, type, raw)
    VALUES ($1, $2, $3)
    ON CONFLICT (event_id) DO NOTHING
  </query>

  <query name="Update subscription (worker)">
    UPDATE subscriptions
    SET status = $1, updated_at = now()
    WHERE subscription_id = $2;

    -- Note: No longer calls increment_entitlement_ver()
    -- JWT claims are updated on next token refresh via custom_access_token_hook()
  </query>
</queries>

---

## Migrations

Database schema is managed via Supabase migrations.

<migrations>
  <migration version="20251127114911" name="add_payment_fields_to_profiles">
    Added dodo_customer_id to profiles for Dodo Payments integration.
    Note: entitlement_ver was later removed in favor of JWT-based quota system.
  </migration>

  <migration version="20251127114937" name="create_subscriptions_table">
    Created subscriptions table with RLS for Dodo Payments integration.
  </migration>

  <migration version="20251127114952" name="create_webhook_events_table">
    Created webhook_events audit log for Dodo Payments webhook debugging.
  </migration>

  <migration version="20251127125526" name="add_increment_entitlement_ver_function">
    Added increment_entitlement_ver() function for cache invalidation.
    Note: This function was later removed in favor of JWT-based quota system.
  </migration>

  <migration version="20251129143742" name="add_canceled_at_to_subscriptions">
    Added canceled_at timestamp to subscriptions for lifecycle tracking.
  </migration>

  <migration version="(unmigrated)" name="Free tier quota system">
    Added to profiles table:
    - words_used_this_week (integer, default 0)
    - quota_reset_date (timestamptz, nullable)

    Added functions:
    - increment_quota_simple(p_user_id uuid, p_word_count integer)
    - custom_access_token_hook(event jsonb) RETURNS jsonb

    Removed:
    - entitlement_ver column (replaced by JWT claims)
    - increment_entitlement_ver() function (no longer needed)
    - sync_quota_simple() function (replaced by increment_quota_simple)
  </migration>
</migrations>

---

## Indexes

<indexes>
  <automatic>
    Primary keys: profiles.id, subscriptions.id, webhook_events.event_id
    Unique constraints: profiles.email, profiles.dodo_customer_id, subscriptions.subscription_id,
                        waitlist.email
    Foreign keys: auto-indexed on user_id columns
  </automatic>

  <recommended_for_scale>
    These indexes will help as data grows:

    CREATE INDEX idx_subscriptions_status ON subscriptions(status);
  </recommended_for_scale>
</indexes>

---

## Privacy & Data Retention

<privacy>
  <transcription_text>
    NEVER stored in database. Only stored locally on user's device (electron-store).
  </transcription_text>

  <telemetry>
    All performance telemetry moved to Cloudflare Analytics Engine (2025-12-11).
    `dictation_logs` table was completely removed (2025-12-13).
    Privacy-safe metadata only—no transcription text or recordings.
  </telemetry>

  <dataset_consent>
    share_transcriptions flag in profiles table.
    When true, worker logs stt/llm input/output to console for dataset collection.
    When false (default), no text logging occurs.
    Always user-controlled, opt-in only.
  </dataset_consent>

  <retention>
    Transcription history: 1000 items max (local storage, auto-pruned).
    Analytics Engine data: Retained based on Cloudflare dataset settings.
    webhook_events: Append-only audit log (consider periodic archival for production).
  </retention>
</privacy>

---

## Custom Access Token Hook Configuration

The `custom_access_token_hook()` function must be registered in Supabase Auth settings to modify JWT claims.

<auth_hook_setup>
  <location>Supabase Dashboard → Authentication → Hooks</location>
  <hook_type>Custom Access Token Hook</hook_type>
  <hook_function>public.custom_access_token_hook</hook_function>
  <description>
    This hook runs during JWT generation/refresh to add custom claims:
    - subscription_active: Whether user has active paid subscription
    - words_used_this_week: Current quota usage (free tier only)
    - quota_limit: Weekly word limit (free tier only, hardcoded to 1000)
    - quota_reset_date: Next reset date (free tier only, every Monday 00:00 UTC)
  </description>

  <when_called>
    - User signs up (initial JWT generation)
    - User signs in (JWT generation)
    - Token refresh (every hour by default)
    - Explicit refreshSession() call from client
  </when_called>

  <performance>
    - Runs synchronously during auth flow
    - Adds ~10-50ms to JWT generation (depends on DB performance)
    - Lazy reset logic only executes when needed (once per week per user, Monday 00:00 UTC)
    - Pro users skip quota logic entirely (minimal overhead)
  </performance>

  <testing>
    To test hook changes:
    1. Update function in database (via Supabase SQL Editor or migration)
    2. Force JWT refresh in app: supabase.auth.refreshSession()
    3. Verify claims in worker logs or by decoding JWT at jwt.io
  </testing>

  <related_docs>
    - agent-logs/2025-12-04_1330_free-tier-quota-implementation.md (Initial implementation)
    - agent-logs/2025-12-04_1640_fix-quota-system.md (VOLATILE fix for hook)
    - agent-logs/2025-12-02_1900_payments-auth-optimization.md (Custom Access Token Hook setup)
  </related_docs>
</auth_hook_setup>

---

## Free Tier Quota Architecture

Comprehensive overview of the server-authoritative quota system.

<quota_architecture>
  <design_principles>
    - Server-authoritative: Worker is source of truth (users cannot tamper)
    - Zero-latency tracking: Fire-and-forget DB writes using waitUntil()
    - JWT-based gating: Instant blocking at auth time (no DB queries during transcription)
    - Fair word counting: STT output (spoken words), not LLM output
    - Lazy weekly reset: On-demand reset in auth hook (no cron jobs), resets Monday 00:00 UTC
  </design_principles>

  <flow>
    1. User opens app → JWT refresh → custom_access_token_hook() runs
    2. Hook checks subscription, adds claims (subscription_active, quota data)
    3. User starts dictation → Worker validates JWT → checks quota from claims
    4. If over limit → immediate close (code 4021) before audio streams
    5. User speaks → STT transcribes → Worker counts words
    6. Worker fires increment_quota_simple() in background (waitUntil)
    7. Worker sends response with wordCount to app
    8. App updates localStorage for UI display (progress bar)
    9. Next app restart → JWT refresh syncs reality from database
  </flow>

  <security_model>
    | Component | Role | Trusted? | Can Write Quota? |
    |-----------|------|----------|------------------|
    | Worker | Authority | ✅ YES | ✅ YES (service role) |
    | Database | Storage | ✅ YES | N/A (passive) |
    | Auth Hook | Gate | ✅ YES | ✅ YES (lazy reset) |
    | JWT Claims | Distribution | ✅ YES | ❌ NO (read-only, signed) |
    | App localStorage | Display | ❌ NO | ❌ NO (UI only) |

    Tamper scenarios:
    - User edits localStorage → fake progress bar shown ✅ SAFE (worker still blocks)
    - User tampers with JWT → signature invalid ✅ SAFE (worker rejects)
    - User replays old JWT → expired token ✅ SAFE (worker checks exp claim)
    - User bypasses app quota check → worker still gates ✅ SAFE (server-authoritative)
  </security_model>

  <word_counting_logic>
    Worker counts STT transcription output (finalText), NOT LLM output (responseText).

    Why this matters:
    - Normal dictation: User speaks "hello world" → STT outputs 2 words → count 2 ✅
    - Edit mode: User says "make it shorter" (3 words) → LLM generates 70 words
      - OLD (wrong): Count LLM output → 70 words charged ❌
      - NEW (correct): Count STT output → 3 words charged ✅

    Implementation:
    - finalText = STT transcription (always present)
    - responseText = LLM output (only in edit/llm mode)
    - wordCount = finalText.split(/\\s+/).filter(w => w.length > 0).length

    File: worker/src/handlers/ws.ts:~450
  </word_counting_logic>

  <latency_optimization>
    Fire-and-forget pattern eliminates blocking on DB writes:

    // ❌ BAD: Blocks response on DB write (adds 50-200ms latency)
    await incrementQuota(userId, wordCount);
    server.send(finalResponse);

    // ✅ GOOD: Sends response immediately, DB write happens after
    server.send(finalResponse);
    executionCtx.waitUntil(incrementQuota(userId, wordCount));

    Cloudflare Workers guarantees waitUntil() tasks complete even after response sent.
    Result: Zero perceived latency for users, quota still tracked reliably.
  </latency_optimization>

  <weekly_reset_strategy>
    Lazy reset in custom_access_token_hook():

    Advantages:
    - No cron jobs or scheduled tasks needed
    - Only resets for active users (efficient)
    - Automatic and self-healing
    - Works across timezones (uses UTC)
    - Resets every Monday 00:00 UTC

    Logic:
    IF quota_reset_date IS NULL OR quota_reset_date < NOW() THEN
      words_used_this_week = 0
      quota_reset_date = DATE_TRUNC('week', NOW() + INTERVAL '1 week')  -- Next Monday

    Example timeline:
    - Monday Dec 16: User uses 300 words, quota_reset_date = Dec 23 00:00:00 UTC
    - Wednesday Dec 18: User uses 400 more words (total: 700)
    - Tuesday Dec 24: User opens app → JWT refresh → hook sees reset_date (Dec 23) < NOW() (Dec 24)
    - Hook resets: words_used_this_week = 0, quota_reset_date = Dec 30 00:00:00 UTC (next Monday)
    - User now has 1000 words available for the new week
  </weekly_reset_strategy>

  <ui_display_caching>
    App uses localStorage for instant progress bar updates (display-only):

    - On app startup: updateQuotaFromServer() syncs from JWT claims
    - After transcription: incrementQuotaLocal(wordCount) for instant feedback
    - localStorage can be stale between sessions (acceptable UX trade-off)
    - Next JWT refresh (app restart) syncs reality from database

    Why this is safe:
    - localStorage is display-only (no security boundary)
    - Worker never reads app localStorage (checks JWT only)
    - User can tamper with localStorage but cannot bypass worker gate
    - Staleness is bounded (max 1 session, refreshes on restart)

    File: src/state/quotaCache.ts
  </ui_display_caching>
</quota_architecture>

---

## Troubleshooting

### Quota Not Syncing from Database to JWT

**Symptom**: Database shows correct `words_used_this_week`, but Worker logs show `wordsUsed: 0` from JWT claims.

**Root Cause**: The `custom_access_token_hook()` function was defined as `STABLE`, which prohibits UPDATE operations in PostgreSQL. The lazy weekly reset logic (which writes to `profiles` table) was silently failing.

**Error Message** (when manually executing hook):
```
ERROR: 0A000: UPDATE is not allowed in a non-volatile function
```

**Solution**: Change function volatility to `VOLATILE` and add `SECURITY DEFINER`:
```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE  -- Changed from STABLE
SECURITY DEFINER  -- Added for RLS bypass
SET search_path TO 'public', 'auth'
AS $function$
-- ... function body ...
$function$;
```

**Verification**:
1. Check database: `SELECT words_used_this_week FROM profiles WHERE id = auth.uid();`
2. Force JWT refresh: `supabase.auth.refreshSession()` in app
3. Check Worker logs for `wordsUsed` in JWT claims
4. Check app localStorage: `localStorage.getItem('sf.quotaWordsUsed')`

**Reference**: `agent-logs/2025-12-04_1640_fix-quota-system.md`

---

**Last Updated**: 2025-12-20
**Schema Version**: 4 active tables (profiles, subscriptions, webhook_events, waitlist) - `dictation_logs` removed
