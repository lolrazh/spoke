# Database Architecture

Sonic Flow uses Supabase (PostgreSQL) to manage user data, subscriptions, quota tracking, and telemetry. The database is designed with privacy in mind—transcription text is never stored, only performance metrics.

**Related:** `docs/AUTH.md`, `docs/TRANSCRIPTION.md`, `docs/PAYMENTS.md`

---

## Philosophy

The database serves four core functions:

1. **User Identity**: Profiles linked 1:1 with Supabase Auth users
2. **Subscription Management**: Dodo Payments integration for billing
3. **Free Tier Quota Tracking**: Server-authoritative word count limits (2000 words/month)
4. **Performance Telemetry**: Timing metrics for monitoring (no transcription text)

Privacy is paramount—`dictation_logs` stores word count, latency, provider info, but never the actual transcription. History is stored locally on the user's device.

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
    <rows>0</rows>
    <rls>enabled</rls>
  </table>

  <table name="dictation_logs">
    <purpose>Transcription session telemetry (no text stored)</purpose>
    <relationship>dictation_logs.user_id → auth.users.id (FK, 1:N)</relationship>
    <rows>1270</rows>
    <rls>enabled</rls>
  </table>

  <table name="webhook_events">
    <purpose>Dodo Payments webhook event audit log</purpose>
    <relationship>None (standalone)</relationship>
    <rows>0</rows>
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
    words_used_this_month (integer, default 0) - Free tier quota tracking
    quota_reset_date (timestamptz, nullable) - Monthly reset timestamp
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
    Free tier users have a 2000 word/month limit tracked server-side:
    - words_used_this_month: Current usage counter (incremented by worker)
    - quota_reset_date: Next reset date (lazy monthly reset in auth hook)

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

### dictation_logs

Performance telemetry for each transcription session. Privacy-safe—no text stored.

<table name="dictation_logs">
  <columns>
    id (uuid, PK)
    user_id (uuid, FK → auth.users.id)
    session_id (text, unique) - Client-generated session ID
    created_at (timestamptz) - Session start
    completed_at (timestamptz, nullable) - Session end
    dictation_ms (integer, nullable) - User speaking duration
    e2e_ms (integer, nullable) - End-to-end latency
    total_ms (integer, nullable) - Total processing time
    stt_ms (integer, nullable) - STT provider latency
    llm_ms (integer, nullable) - LLM processing latency
    audio_duration_ms (integer, nullable)
    word_count (integer, nullable)
    pipeline (text, nullable) - e.g., 'stt+llm', 'edit'
    stt_provider (text, default 'groq')
    stt_model (text, nullable)
    llm_provider (text, nullable)
    llm_model (text, nullable)
    ws_close_code (integer, nullable)
    ws_close_reason (text, nullable)
  </columns>

  <rls>
    Service role can INSERT (bypasses RLS).
    Users can SELECT their own logs (auth.uid() = user_id).
  </rls>

  <integration>
    <file path="worker/src/handlers/ws.ts">Inserts on session complete (service role)</file>
    <file path="worker/src/utils/telemetry.ts">Telemetry helpers</file>
    <privacy>
      No transcription text stored, only timing metrics and metadata.
      Enables performance monitoring without compromising user privacy.
    </privacy>
  </integration>

  <philosophy>
    Telemetry for debugging and optimization, not surveillance.
    Text stays on the user's device (local history) or is ephemeral (server processing).
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
    <type>Trigger function (SECURITY DEFINER)</type>
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
  </function>

  <function name="increment_quota_simple">
    <signature>increment_quota_simple(p_user_id uuid, p_word_count integer) RETURNS void</signature>
    <type>Database function (SECURITY DEFINER)</type>
    <action>
      Increments words_used_this_month by p_word_count for the given user:
      UPDATE profiles
      SET words_used_this_month = COALESCE(words_used_this_month, 0) + p_word_count
      WHERE id = p_user_id;

      Uses COALESCE to handle NULL initial values.
      Atomic operation - no race conditions.
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
    <type>Auth hook (STABLE)</type>
    <hook_type>Custom Access Token Hook (registered in Supabase Auth settings)</hook_type>
    <action>
      Modifies JWT claims during token generation/refresh:

      1. Checks if user has active subscription (status = 'active')
      2. Adds subscription_active claim to JWT (boolean)
      3. For FREE tier users only (no subscription):
         - Reads words_used_this_month and quota_reset_date from profiles
         - Implements lazy monthly reset:
           IF quota_reset_date IS NULL OR quota_reset_date &lt; NOW() THEN
             - Reset words_used_this_month to 0
             - Set quota_reset_date to start of next month
             - Update profiles table with new values
         - Adds quota claims to JWT:
           - words_used_this_month (integer)
           - quota_limit (2000, hardcoded)
           - quota_reset_date (timestamptz, for debugging)

      Error handling: Returns event with just subscription_active on failure.
    </action>
    <purpose>
      Embeds subscription and quota data into JWTs for instant worker-side gating.
      No database queries needed during transcription - all info in signed token.
    </purpose>
    <usage>
      <file path="worker/src/auth/supabaseJwt.ts">
        verifySupabaseJwt() extracts claims from JWT:
        - subscriptionActive (boolean)
        - wordsUsedThisMonth (number, free tier only)
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
      Monthly reset is lazy (on-demand) rather than scheduled:
      - Avoids cron jobs or scheduled tasks
      - Resets automatically when user next refreshes token after month boundary
      - Efficient: only resets for users who are active

      Example:
      - User last used app on Nov 15
      - User opens app on Dec 10
      - JWT refresh triggers custom_access_token_hook()
      - Hook sees quota_reset_date (Dec 1) &lt; NOW() (Dec 10)
      - Resets words_used_this_month to 0, sets quota_reset_date to Jan 1
      - User starts fresh month with 2000 words
    </lazy_reset_logic>
    <security>
      Runs in database with full access (auth.users, public.profiles, public.subscriptions).
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
    - Inserting dictation_logs (validated via JWT)
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
      Returns current user's full profile including quota fields (words_used_this_month,
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
      words_used_this_month, quota_reset_date
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
    -- SET words_used_this_month = COALESCE(words_used_this_month, 0) + $2
    -- WHERE id = $1;
  </query>

  <query name="Check quota in auth hook">
    -- Runs inside custom_access_token_hook()
    SELECT words_used_this_month, quota_reset_date
    FROM public.profiles
    WHERE id = (event->>'user_id')::uuid;

    -- If reset needed:
    UPDATE public.profiles
    SET
      words_used_this_month = 0,
      quota_reset_date = DATE_TRUNC('month', NOW() + INTERVAL '1 month')
    WHERE id = (event->>'user_id')::uuid;
  </query>

  <query name="Insert telemetry (worker)">
    INSERT INTO dictation_logs (
      user_id, session_id, word_count,
      stt_ms, llm_ms, e2e_ms, total_ms,
      stt_provider, stt_model, llm_provider, llm_model,
      pipeline, audio_duration_ms, completed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
    - words_used_this_month (integer, default 0)
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
    Primary keys: profiles.id, subscriptions.id, dictation_logs.id, webhook_events.event_id
    Unique constraints: profiles.email, profiles.dodo_customer_id, subscriptions.subscription_id,
                        dictation_logs.session_id, waitlist.email
    Foreign keys: auto-indexed on user_id columns
  </automatic>

  <recommended_for_scale>
    These indexes will help as data grows:

    CREATE INDEX idx_dictation_logs_created_at ON dictation_logs(created_at);
    CREATE INDEX idx_dictation_logs_stt_provider ON dictation_logs(stt_provider);
    CREATE INDEX idx_subscriptions_status ON subscriptions(status);
  </recommended_for_scale>
</indexes>

---

## Privacy & Data Retention

<privacy>
  <transcription_text>
    NEVER stored in database. Only stored locally on user's device (electron-store).
    dictation_logs table stores word_count, timing metrics, provider info—no text.
  </transcription_text>

  <telemetry>
    dictation_logs contains performance metrics only.
    Used for debugging, monitoring, optimization—not user surveillance.
  </telemetry>

  <dataset_consent>
    share_transcriptions flag in profiles table.
    When true, worker logs stt/llm input/output to console for dataset collection.
    When false (default), no text logging occurs.
    Always user-controlled, opt-in only.
  </dataset_consent>

  <retention>
    Transcription history: 1000 items max (local storage, auto-pruned).
    dictation_logs: No automatic deletion (lightweight metrics only).
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
    - words_used_this_month: Current quota usage (free tier only)
    - quota_limit: Monthly word limit (free tier only, hardcoded to 2000)
    - quota_reset_date: Next reset date (free tier only)
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
    - Lazy reset logic only executes when needed (once per month per user)
    - Pro users skip quota logic entirely (minimal overhead)
  </performance>

  <testing>
    To test hook changes:
    1. Update function in database (via Supabase SQL Editor or migration)
    2. Force JWT refresh in app: supabase.auth.refreshSession()
    3. Verify claims in worker logs or by decoding JWT at jwt.io
  </testing>

  <related_docs>
    - agent-logs/2025-12-04_1330_free-tier-quota-implementation.md
    - agent-logs/2025-12-02_1900_payments-auth-optimization.md
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
    - Lazy monthly reset: On-demand reset in auth hook (no cron jobs)
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

  <monthly_reset_strategy>
    Lazy reset in custom_access_token_hook():

    Advantages:
    - No cron jobs or scheduled tasks needed
    - Only resets for active users (efficient)
    - Automatic and self-healing
    - Works across timezones (uses UTC)

    Logic:
    IF quota_reset_date IS NULL OR quota_reset_date < NOW() THEN
      words_used_this_month = 0
      quota_reset_date = DATE_TRUNC('month', NOW() + INTERVAL '1 month')

    Example timeline:
    - Nov 15: User uses 500 words, quota_reset_date = Dec 1 00:00:00 UTC
    - Nov 30: User uses 300 more words (total: 800)
    - Dec 10: User opens app → JWT refresh → hook sees reset_date < NOW()
    - Hook resets: words_used_this_month = 0, quota_reset_date = Jan 1 00:00:00 UTC
    - User now has 2000 words available for December
  </monthly_reset_strategy>

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

**Last Updated**: 2025-12-04
**Schema Version**: 5 migrations + unmigrated quota system (includes payment integration and free tier quota)
