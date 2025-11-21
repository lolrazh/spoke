# Database Architecture

Sonic Flow uses Supabase (PostgreSQL) for user authentication, profiles, and telemetry. This document covers the schema, relationships, security policies, and integration points with the app.

**Related Documentation:**
- `docs/AUTH.md` - Authentication flow and token handling
- `docs/TRANSCRIPTION.md` - Transcription pipeline and metrics

---

## Overview

### Database Stats
| Table | Rows | Purpose |
|-------|------|---------|
| `profiles` | 8 | User profiles and preferences |
| `dictation_logs` | 377 | Transcription telemetry |
| `waitlist` | 11 | Pre-launch email collection |

### Schema Diagram

```
┌─────────────────┐
│   auth.users    │
│  (Supabase)     │
└────────┬────────┘
         │
         │ 1:1 (id → id)
         ▼
┌─────────────────┐
│    profiles     │
│                 │
│ - display_name  │
│ - avatar_url    │
│ - onboarding    │
│ - share_prefs   │
└─────────────────┘

┌─────────────────┐
│   auth.users    │
└────────┬────────┘
         │
         │ 1:N (id → user_id)
         ▼
┌─────────────────┐
│ dictation_logs  │
│                 │
│ - session_id    │
│ - timing metrics│
│ - provider info │
└─────────────────┘

┌─────────────────┐
│    waitlist     │
│  (standalone)   │
│                 │
│ - email         │
│ - source        │
└─────────────────┘
```

---

## Tables

### `profiles`

User profile data created after authentication. Links 1:1 with `auth.users`.

#### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `uuid` | — | Primary key, matches `auth.users.id` |
| `email` | `text` | `null` | User's email (for display) |
| `display_name` | `text` | `null` | User's display name (editable in onboarding) |
| `avatar_url` | `text` | `null` | Profile picture URL from OAuth provider |
| `share_transcriptions` | `boolean` | `false` | Consent to share transcriptions for training |
| `onboarding_done` | `boolean` | `false` | Whether user completed onboarding |
| `created_at` | `timestamptz` | `now()` | Profile creation timestamp |
| `updated_at` | `timestamptz` | `now()` | Last update timestamp |

#### Relationships

- **Foreign Key**: `profiles.id` → `auth.users.id`
- **Constraint**: One profile per user (1:1)

#### RLS Policies

| Policy | Command | Rule |
|--------|---------|------|
| `profiles: self read` | SELECT | `auth.uid() = id` |
| `profiles: self insert` | INSERT | `auth.uid() = id` |
| `profiles: self update` | UPDATE | `auth.uid() = id` |

#### App Integration

**Files:**
- `src/lib/supabaseClient.ts` - Profile CRUD operations
- `src/state/userIdentity.ts` - Client-side identity cache
- `src/components/Onboarding.tsx` - Name verification, onboarding_done flag

**Key Functions:**
```typescript
// supabaseClient.ts
getProfile()              // Fetch current user's profile
getProfileDetailed()      // Fetch with detailed error typing
ensureProfileRow()        // Create profile if missing
updateDisplayName(name)   // Update display_name with retry
setShareTranscriptionsPreference(enabled)  // Update share_transcriptions
markOnboardingDone()      // Set onboarding_done = true
```

**Usage Patterns:**
- **Returning user detection**: Check `onboarding_done` to skip onboarding
- **Identity display**: `display_name` and `avatar_url` shown in settings
- **Privacy control**: `share_transcriptions` gates dataset logging in worker

---

### `dictation_logs`

Telemetry for each transcription session. Used for performance monitoring and debugging.

#### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `uuid` | `gen_random_uuid()` | Primary key |
| `user_id` | `uuid` | — | User who dictated |
| `session_id` | `text` | — | Unique session identifier (from client) |
| `created_at` | `timestamptz` | `now()` | Session start time |
| `completed_at` | `timestamptz` | `null` | Session end time |
| `dictation_ms` | `integer` | `null` | Time user spent speaking |
| `e2e_ms` | `integer` | `null` | End-to-end latency |
| `total_ms` | `integer` | `null` | Total processing time |
| `stt_ms` | `integer` | `null` | STT provider latency |
| `llm_ms` | `integer` | `null` | LLM processing latency |
| `audio_duration_ms` | `integer` | `null` | Audio file duration |
| `word_count` | `integer` | `null` | Words in final transcription |
| `pipeline` | `text` | `null` | Pipeline type (e.g., "stt+llm") |
| `stt_provider` | `text` | `'groq'` | STT provider used |
| `stt_model` | `text` | `null` | STT model used |
| `llm_provider` | `text` | `null` | LLM provider used |
| `llm_model` | `text` | `null` | LLM model used |
| `ws_close_code` | `integer` | `null` | WebSocket close code |
| `ws_close_reason` | `text` | `null` | WebSocket close reason |

#### Relationships

- **Foreign Key**: `dictation_logs.user_id` → `auth.users.id`
- **Unique**: `session_id` (one log per session)

#### RLS Policies

| Policy | Command | Rule |
|--------|---------|------|
| `Service role can insert dictation logs` | INSERT | `true` (service role only) |
| `Users can view own dictation logs` | SELECT | `auth.uid() = user_id` |

#### App Integration

**Files:**
- `worker/src/handlers/ws.ts` - Inserts logs on session complete
- `worker/src/utils/telemetry.ts` - Telemetry helper functions

**Usage Patterns:**
- **Worker writes**: Uses service role key to insert after transcription completes
- **User reads**: Can view own logs (for potential future analytics dashboard)
- **No updates**: Logs are append-only, never modified

**Metrics Flow:**
```
Client sends metrics → Worker receives on WebSocket close
Worker extracts timing data → Inserts into dictation_logs
```

---

### `waitlist`

Email collection for pre-launch signups. Standalone table with no user relationship.

#### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `uuid` | `gen_random_uuid()` | Primary key |
| `email` | `text` | — | Email address (unique) |
| `source` | `text` | `null` | Signup source (e.g., "website", "twitter") |
| `created_at` | `timestamptz` | `now()` | Signup timestamp |

#### RLS Policies

**RLS is disabled** on this table (public inserts allowed).

#### App Integration

**Files:**
- Website signup form (external)

**Usage Patterns:**
- Simple email collection
- No authentication required
- Used for launch announcements

---

## Security

### Row Level Security (RLS)

All public tables have RLS enabled except `waitlist`.

**Key Principles:**
1. **Self-access only**: Users can only read/write their own data
2. **Service role bypass**: Worker uses service role key for inserts
3. **No cross-user access**: No policies allow reading other users' data

### Authentication Flow

1. User authenticates via Google OAuth
2. Supabase creates `auth.users` entry
3. App calls `ensureProfileRow()` to create `profiles` entry
4. All subsequent queries use `auth.uid()` for RLS filtering

### Service Role Usage

The Cloudflare Worker uses the service role key for:
- Inserting `dictation_logs` (bypasses user RLS)
- This is safe because the worker validates the user's JWT

---

## Indexes

### Primary Keys (automatic indexes)
- `profiles.id`
- `dictation_logs.id`
- `waitlist.id`

### Unique Constraints (automatic indexes)
- `profiles.email`
- `dictation_logs.session_id`
- `waitlist.email`

### Recommended Indexes (for scale)

```sql
-- Query dictation_logs by user (already indexed via FK)
CREATE INDEX idx_dictation_logs_user_id ON dictation_logs(user_id);

-- Query dictation_logs by date range
CREATE INDEX idx_dictation_logs_created_at ON dictation_logs(created_at);

-- Query by provider for analytics
CREATE INDEX idx_dictation_logs_stt_provider ON dictation_logs(stt_provider);
```

---

## Common Queries

### Get User Profile
```typescript
const { data } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single();
```

### Check Onboarding Status
```typescript
const { data } = await supabase
  .from('profiles')
  .select('onboarding_done')
  .eq('id', userId)
  .single();
```

### Insert Dictation Log (Worker)
```typescript
await supabase
  .from('dictation_logs')
  .insert({
    user_id: userId,
    session_id: sessionId,
    stt_ms: metrics.stt.total,
    llm_ms: metrics.llm?.total,
    word_count: wordCount,
    stt_provider: 'groq',
    stt_model: 'whisper-large-v3-turbo',
    // ... other metrics
  });
```

### Get User's Dictation Stats
```typescript
const { data } = await supabase
  .from('dictation_logs')
  .select('word_count, stt_ms, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false });
```

---

## Future Schema Considerations

### Subscriptions (Planned)
For payment integration with Dodo Payments:

```sql
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  plan_id text NOT NULL,  -- 'monthly' | 'yearly'
  status text NOT NULL,   -- 'active' | 'canceled' | 'past_due'
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: Users can read own subscription
CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage (webhook updates)
CREATE POLICY "Service role can manage subscriptions"
  ON subscriptions FOR ALL
  USING (true);
```

### Usage Tracking (Planned)
For metered billing or usage limits:

```sql
CREATE TABLE usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  period_start date NOT NULL,
  word_count integer DEFAULT 0,
  dictation_count integer DEFAULT 0,
  UNIQUE(user_id, period_start)
);
```

---

## Migrations

Migrations are managed through Supabase Dashboard or CLI. Currently no local migration files are tracked (schema created via Dashboard).

**To add local migrations:**
```bash
# Initialize Supabase locally
supabase init

# Pull remote schema
supabase db pull

# Create new migration
supabase migration new add_subscriptions
```

---

## Troubleshooting

### "permission denied for table profiles"
- Check that RLS policies exist
- Verify user is authenticated (`auth.uid()` returns value)
- Ensure query uses correct user ID

### "duplicate key value violates unique constraint"
- `profiles`: User already has a profile (use upsert)
- `dictation_logs`: Session ID already logged
- `waitlist`: Email already registered

### Slow queries on dictation_logs
- Add indexes for commonly filtered columns
- Consider partitioning by date for large datasets

---

**Last Updated**: 2025-11-21
**Version**: 1.0.0
