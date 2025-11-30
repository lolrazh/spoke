# Database Architecture

Sonic Flow uses Supabase (PostgreSQL) to manage user data, subscriptions, and telemetry. The database is designed with privacy in mind—transcription text is never stored, only performance metrics.

**Related:** `docs/AUTH.md`, `docs/TRANSCRIPTION.md`, `docs/PAYMENTS.md`

---

## Philosophy

The database serves three core functions:

1. **User Identity**: Profiles linked 1:1 with Supabase Auth users
2. **Subscription Management**: Dodo Payments integration for billing
3. **Performance Telemetry**: Timing metrics for monitoring (no transcription text)

Privacy is paramount—`dictation_logs` stores word count, latency, provider info, but never the actual transcription. History is stored locally on the user's device.

---

## Schema Overview

<schema>
  <table name="profiles">
    <purpose>User profiles and preferences (1:1 with auth.users)</purpose>
    <relationship>profiles.id → auth.users.id (FK)</relationship>
    <rows>11</rows>
    <rls>enabled</rls>
  </table>

  <table name="subscriptions">
    <purpose>Dodo Payments subscription records</purpose>
    <relationship>subscriptions.user_id → auth.users.id (FK, 1:N)</relationship>
    <rows>5</rows>
    <rls>enabled</rls>
  </table>

  <table name="dictation_logs">
    <purpose>Transcription session telemetry (no text stored)</purpose>
    <relationship>dictation_logs.user_id → auth.users.id (FK, 1:N)</relationship>
    <rows>800</rows>
    <rls>enabled</rls>
  </table>

  <table name="webhook_events">
    <purpose>Dodo Payments webhook event audit log</purpose>
    <relationship>None (standalone)</relationship>
    <rows>16</rows>
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
    entitlement_ver (integer, default 1) - Incremented to invalidate client cache
    created_at, updated_at (timestamptz)
  </columns>

  <rls>
    Users can only read/write their own profile (auth.uid() = id).
    Three policies: self read, self insert, self update.
  </rls>

  <integration>
    <file path="src/lib/supabaseClient.ts">
      getProfile(), ensureProfileRow(), updateDisplayName(),
      setShareTranscriptionsPreference(), markOnboardingDone()
    </file>
    <file path="src/state/userIdentity.ts">Client-side identity cache</file>
    <file path="src/components/Onboarding.tsx">Name verification flow</file>
  </integration>

  <entitlement_ver>
    When subscription changes, worker calls increment_entitlement_ver(user_id).
    Client polls this version to detect subscription updates and refresh UI.
    Simple cache invalidation strategy—increment bumps client to refetch entitlements.
  </entitlement_ver>
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

## Functions

Database functions provide reusable logic for common operations.

<functions>
  <function name="handle_new_user">
    <trigger>auth.users INSERT</trigger>
    <action>Auto-creates profiles row on user signup</action>
    <purpose>Ensures every authenticated user has a profile</purpose>
  </function>

  <function name="increment_entitlement_ver">
    <signature>increment_entitlement_ver(user_uuid uuid) RETURNS void</signature>
    <action>Increments profiles.entitlement_ver to invalidate client cache</action>
    <usage>
      Called by webhook handler after subscription changes.
      Client polls this value to detect updates and refresh entitlements.
    </usage>
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
    Returns current user's profile or null.
  </function>

  <function name="ensureProfileRow">
    Creates profile if missing (upsert pattern).
  </function>

  <function name="updateDisplayName">
    Updates display_name with retry logic.
  </function>

  <function name="setShareTranscriptionsPreference">
    Updates share_transcriptions consent flag.
  </function>

  <function name="markOnboardingDone">
    Sets onboarding_done = true.
  </function>

  <function name="getUserSubscription">
    Fetches active subscription (status IN ('active', 'trialing')).
    Returns most recent if multiple exist.
  </function>
</client_functions>

---

## Common Query Patterns

<queries>
  <query name="Check onboarding status">
    SELECT onboarding_done FROM profiles WHERE id = auth.uid()
  </query>

  <query name="Get user subscription">
    SELECT * FROM subscriptions
    WHERE user_id = auth.uid()
    AND status IN ('active', 'trialing')
    ORDER BY created_at DESC
    LIMIT 1
  </query>

  <query name="Insert telemetry (worker)">
    INSERT INTO dictation_logs (user_id, session_id, stt_ms, word_count, ...)
    VALUES ($1, $2, $3, $4, ...)
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

    -- Then invalidate client cache
    SELECT increment_entitlement_ver(user_id)
    FROM subscriptions
    WHERE subscription_id = $2;
  </query>
</queries>

---

## Migrations

Database schema is managed via Supabase migrations. Recent migrations add payment support.

<migrations>
  <migration version="20251127114911" name="add_payment_fields_to_profiles">
    Added dodo_customer_id, entitlement_ver to profiles
  </migration>

  <migration version="20251127114937" name="create_subscriptions_table">
    Created subscriptions table with RLS
  </migration>

  <migration version="20251127114952" name="create_webhook_events_table">
    Created webhook_events audit log
  </migration>

  <migration version="20251127125526" name="add_increment_entitlement_ver_function">
    Added increment_entitlement_ver() function for cache invalidation
  </migration>

  <migration version="20251129143742" name="add_canceled_at_to_subscriptions">
    Added canceled_at timestamp to subscriptions for lifecycle tracking
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

**Last Updated**: 2025-11-30
**Schema Version**: 5 migrations (includes payment integration)
