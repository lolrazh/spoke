# Spoke App - Auth Flow - docs/AUTH.md

This file provides comprehensive documentation for Spoke's authentication system, including OAuth flows, deep link handling, and environment-specific configurations.

## Overview

Spoke uses a **hybrid authentication system** that combines Supabase OAuth with custom deep link handling to provide seamless sign-in across development and production environments. The system supports Google OAuth and email magic links, with automatic app launching after authentication.

### Key Features
- **Supabase OAuth Integration** - Google sign-in and email magic links
- **Cross-Platform Deep Links** - `spoke://` protocol handling
- **Development HTTP Server** - Local callback server for dev environments
- **Hosted Callback Page** - Production web interface at `auth.spoke.so`
- **Duplicate Prevention** - Prevents multiple processing of same auth tokens
- **Graceful Error Handling** - User-friendly error messages and fallbacks

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User clicks   │    │   Supabase       │    │   Callback      │
│   "Sign in"     │───▶│   redirects to   │───▶│   Handler       │
│   in app        │    │   callback URL   │    │   (env-specific)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   App processes │◀───│   Deep link      │◀───│   Deep link     │
│   auth tokens   │    │   opens app      │    │   generation    │
│   and completes │    │   with tokens    │    │   (spoke://)│
│   sign-in       │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Component Interaction

- **Electron Main Process** (`src/main.ts`) - Handles deep links, manages callback URLs, coordinates auth flow
- **IntroExperience** (`src/components/intro/IntroExperience.tsx`) - Initial OAuth entry point (Google sign-in from first screen)
- **Renderer/Onboarding** (`src/components/Onboarding.tsx`) - Handles auth callbacks, name verification, permissions flow
- **Supabase Client** (`src/lib/supabaseClient.ts`) - Manages OAuth requests and token processing
- **Auth Signals** (`src/utils/authSignals.ts`) - Cross-window coordination for toast deduplication
- **User Identity** (`src/state/userIdentity.ts`) - Client-side identity cache management
- **Hosted Callback** (`api-spoke-site`) - Production web interface for OAuth callbacks
- **Deep Link Handler** - Protocol registration and URL parsing across platforms

### Returning User Skip Logic (2025 Update)

- Uses `profiles.onboarding_done` in Supabase as cross-device source of truth to skip onboarding for returning users.
- On login or renderer mount, the app ensures a `profiles` row exists and immediately closes onboarding if `onboarding_done` is true.
- Local `onboarding.json` remains a fast local skip; the DB flag is authoritative across machines.

## Authentication Flow

### Complete OAuth Flow

```
1. User clicks "Continue with Google" in IntroExperience (or Onboarding)
2. App requests redirect URL from main process
3. Main process returns environment-appropriate callback URL
4. Supabase client generates OAuth URL with callback
5. System browser opens OAuth URL
6. User completes authentication with Google
7. Google redirects to Supabase
8. Supabase redirects to our callback URL with auth code/tokens
9. Callback handler processes the response:
   - Development: HTTP server receives callback
   - Production: Hosted page receives callback and deep-links to app
10. App receives deep link with auth data
11. Onboarding handles callback (even if IntroExperience initiated it)
12. App validates and processes auth tokens
13. IntroExperience fades out, name-verification step appears
14. User confirms/edits display name
15. Onboarding continues with permissions flow
```

### Step-by-Step Process

#### 1. **Auth Initiation** (`IntroExperience.tsx` or `Onboarding.tsx`)

OAuth can be initiated from IntroExperience (first screen) or Onboarding:

```typescript
// IntroExperience.tsx - Primary entry point
const handleGoogleLogin = async () => {
  setAuthError(null);
  const url = await getGoogleOAuthUrl();
  if (!url) {
    setAuthError("Authentication setup failed...");
    return;
  }
  await window.electron?.openExternal(url);
};

// Onboarding.tsx - Also supports OAuth initiation
const handleGoogle = async () => {
  const url = await getGoogleOAuthUrl();
  await window.electron?.openExternal(url);
};
```

**Note:** IntroExperience initializes Supabase client on mount via `getSupabase()` to ensure PKCE flow works correctly.

#### 2. **Redirect URL Resolution** (`main.ts`)
```typescript
ipcMain.handle("auth:get-redirect-url", async () => {
  const isDev = !app.isPackaged;
  if (isDev) {
    // Wait for HTTP server to be ready (prevents race condition)
    await waitForDevServer();
    return { url: "http://127.0.0.1:43112/auth/callback" };
  }
  return { url: "https://auth.spoke.so/auth/callback" };
});
```

#### 3. **OAuth URL Generation** (`supabaseClient.ts`)
```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: redirect.url,  // Environment-specific URL
    skipBrowserRedirect: true,  // Let us handle the redirect
  },
});
```

#### 4. **Callback Processing**
- **Development**: HTTP server on `127.0.0.1:43112` receives callback
- **Production**: Hosted page at `auth.spoke.so` receives callback

#### 5. **Deep Link Generation**
Both callback methods convert to deep link: `spoke://auth/callback?code=...`

#### 6. **App Receives Deep Link** (`main.ts`)
```typescript
app.on("open-url", (event, url) => {
  sendAuthCallback(url);  // Processes with duplicate prevention
});
```

#### 7. **Token Processing** (`supabaseClient.ts`)
```typescript
export async function handleAuthCallbackUrl(url: string) {
  // Validates URL format and extracts tokens
  // Exchanges code for session or sets tokens directly
  // Returns success/error status
}
```

### 8. Name Verification Step (Onboarding)

After successful auth, users see a name verification step:

```typescript
// Onboarding.tsx - Step "name-verification"
const trimmedName = editableName.trim();
updateIdentityLocal({ displayName: trimmedName }); // Update cache immediately
updateDisplayName(trimmedName)                     // DB update in background
  .then(() => forceRefreshIdentity())
  .catch(console.error);
```

### 9. Returning-User Short-Circuit (Renderer)

After a successful session is set, onboarding performs a short-circuit check:

```typescript
// Onboarding.tsx
await ensureProfileRow();
const profile = await getProfile();
if (profile?.onboarding_done) {
  await window.electron?.setPttTarget?.("main");
  await window.electron?.onboardingComplete();
  return; // Skip onboarding UI entirely
}
```

### JWT Refresh on App Startup

The app refreshes the JWT on startup to get fresh subscription and quota claims:

```typescript
// App.tsx - Refresh session on app startup
if (!skipAuth) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.auth.refreshSession();
      console.log('[App] Session refreshed on startup - JWT claims updated');
    } catch (error) {
      console.warn('[App] Failed to refresh session on startup:', error);
      // Continue anyway - getCurrentUser will return cached session
    }
  }
}
```

**Why This Matters:**
- After payment, users need fresh JWT with `subscription_active: true` claim
- Ensures quota claims are up-to-date (`words_used_this_week`, `quota_limit` for weekly reset)
- Runs Custom Access Token Hook in Postgres to check subscriptions table and reset quota if needed (Monday 00:00 UTC)
- Allows instant access after subscription changes (just restart app)

### JWT Claims (Custom Access Token Hook)

JWTs include custom claims added by Supabase Custom Access Token Hook:

```typescript
// JWT payload includes:
{
  sub: "user-uuid",
  email: "user@example.com",
  subscription_active: true,           // Pro tier status
  words_used_this_week: 342,           // Free tier usage (if no subscription)
  quota_limit: 1000,                   // Free tier limit (if no subscription, 1000 words/week)
  quota_reset_date: "2025-01-06T00:00:00Z"  // Next reset (if no subscription, Monday 00:00 UTC)
}
```

**Hook Behavior:**
- Runs on token generation/refresh (login, startup refresh, hourly refresh)
- Checks `subscriptions` table for active subscription
- For free tier users: reads quota from `profiles` table, implements lazy weekly reset (every Monday 00:00 UTC)
- For Pro users: only adds `subscription_active: true`, skips quota fields
- Embeds data in JWT for instant worker-side gating (zero DB queries during transcription)

See `docs/DATABASE.md` for full Custom Access Token Hook documentation.

### Session Polling

The pill UI (App.tsx) polls for session validity every 60 seconds:

```typescript
// App.tsx - Light auth polling
useEffect(() => {
  const id = window.setInterval(async () => {
    const { data, error } = await supabase.auth.getUser();
    // Only sign out when no error AND no user
    if (!error && !data?.user && prevUserIdRef.current) {
      // User was signed out server-side
      handleSignOut();
    }
  }, 60_000);
  return () => clearInterval(id);
}, []);
```

**Note:** Network errors are ignored to prevent false sign-outs during connectivity blips. This polling detects server-side deletions or manual sign-outs.

## Environment Configuration

### Development Environment

**Callback Strategy**: Local HTTP Server
- **URL**: `http://127.0.0.1:43112/auth/callback`
- **Port**: 43112 (fixed)
- **Protocol**: Custom `spoke-dev://` protocol registered
- **Server**: Started automatically in `main.ts` when `!app.isPackaged`

**Key Features**:
- Waits for server to be ready before allowing auth (prevents race condition)
- 10-second timeout with proper error handling
- Automatic protocol registration for deep links

### Production Environment

**Callback Strategy**: Hosted Web Page
- **URL**: `https://auth.spoke.so/auth/callback`
- **Protocol**: Custom `spoke://` protocol registered
- **Hosting**: Vercel deployment from `api-spoke-site`

**Hosted Page Requirements**:
- Must parse OAuth callback parameters (`?code=...` or `#access_token=...`)
- Must immediately deep-link to app with: `spoke://auth/callback?...`
- Must provide fallback UI if deep link fails

## URL Structure and Configuration

### Supabase Redirect URLs (Required in Dashboard)

**Production URLs**:
```
https://auth.spoke.so/auth/callback
spoke://auth/callback
```

**Development URLs**:
```
http://127.0.0.1:43112/auth/callback
http://localhost:43112/auth/callback
```

### Deep Link URL Formats

**Standard Form** (recommended):
```
spoke://auth/callback?code=abc123
spoke://auth/callback#access_token=xyz&refresh_token=abc
```

**Path Form** (also supported):
```
spoke:///auth/callback?code=abc123
```

### Callback URL Validation

The app accepts these URL patterns in `handleAuthCallbackUrl()`:
- Custom schemes: `spoke://` and `spoke-dev://`
- Dev HTTP: `http://127.0.0.1:43112` and `http://localhost:43112`
- Path validation: `/auth/callback` or hostname `auth` with pathname `/callback`

## Implementation Details

### File Organization

```
src/
├── main.ts                      # Main process - deep link handling, HTTP server
├── preload.ts                   # IPC bridge for auth communication
├── lib/
│   └── supabaseClient.ts        # OAuth URL generation, token processing
├── components/
│   ├── Onboarding.tsx           # Auth callbacks, name verification, permissions
│   └── intro/
│       └── IntroExperience.tsx  # Initial OAuth entry point (Google sign-in)
├── hooks/
│   └── usePermissions.ts        # Shared permissions hook
├── utils/
│   └── authSignals.ts           # Cross-window auth coordination
├── state/
│   └── userIdentity.ts          # Client-side identity cache
└── types/
    └── electron.d.ts            # TypeScript definitions for auth IPC
```

### Key Functions

#### `sendAuthCallback(url: string)` (`main.ts`)
Central auth callback dispatcher with duplicate prevention:
- Deduplicates URLs to prevent double-processing
- Routes to appropriate window (onboarding or main)
- Handles window visibility and focus
- Queues callbacks if windows aren't ready

#### `getGoogleOAuthUrl()` (`supabaseClient.ts`)
Generates OAuth URL with environment-appropriate callback:
- Requests redirect URL from main process
- Handles dev server errors gracefully
- Returns null on failure for proper error handling

#### `handleAuthCallbackUrl(url: string)` (`supabaseClient.ts`)
Processes incoming auth callbacks:
- Validates URL format and security
- Handles both PKCE (code) and implicit (token) flows
- Exchanges codes for sessions or sets tokens directly
- Returns detailed success/error information

#### `ensureProfileRow()` (`supabaseClient.ts`)
Creates a `profiles` row for the current user if missing to reliably store onboarding state:

```typescript
export async function ensureProfileRow() {
  // Checks for existing profile; inserts { onboarding_done: false } if missing.
}
```

#### `getProfileDetailed()` (`supabaseClient.ts`)
Returns detailed profile fetch result with typed errors for better error handling.

#### `updateDisplayName(name: string)` (`supabaseClient.ts`)
Updates the user's display name with retry logic and refreshes identity cache:
- Attempts upsert to `profiles` table
- Retries once on failure
- Calls `forceRefreshIdentity()` on success

### Auth Signals System (`src/utils/authSignals.ts`)

Coordinates authentication state across separate windows (pill and onboarding) to prevent duplicate toasts and track auth flow:

```typescript
type AuthSignalsSnapshot = {
  authIntentTs: number | null;      // When user initiated OAuth
  authIntentProvider: string | null; // "google" etc.
  authCallbackTs: number | null;    // When callback was received
  onboardingTs: number | null;      // When onboarding became visible
  lastToastTs: number | null;       // Last sign-in toast shown
};

// Key functions
markAuthIntent(provider)  // Mark when user clicks sign-in
markAuthCallback()        // Mark when auth callback received
markOnboardingEvent()     // Mark onboarding visibility
setLastToastTs(ts)        // Record toast timestamp
getSignals()              // Get current snapshot (reads localStorage)
```

**LocalStorage keys**: `sf.auth.intentTs`, `sf.auth.intentProvider`, `sf.auth.callbackTs`, `sf.auth.onboardingTs`, `sf.auth.lastToastTs`

### User Identity Management (`src/state/userIdentity.ts`)

Client-side cache for user identity with functions:
- `updateIdentityLocal()` - Updates cache without server call
- `forceRefreshIdentity()` - Forces cache refresh from server
- `clearUserIdentityCache()` - Clears cache on sign-out

This module subscribes to `onAuthStateChange` to keep identity in sync.

### Shared Permissions Hook (`src/hooks/usePermissions.ts`)

Centralizes permission UX for both Onboarding and Settings:

- Provides: `permissions`, `ui`, `init()`, `requestMicrophone()`, `requestAccessibility()`, `requestInputMonitoring()`
- Handles polling and a single deep-link to System Settings after a short grace period
- Works with either the Electron preload provider or a mock provider (for development/testing)
- Eliminates duplicated logic and keeps UI feedback consistent across surfaces

Usage example:

```ts
const { permissions, ui, init, requestMicrophone, requestAccessibility, requestInputMonitoring } =
  usePermissions();

useEffect(() => { init(); }, []);
```

### IPC Communication

**Auth-related IPC channels**:
```typescript
// Main → Renderer
"auth:callback"           // Delivers auth callback URLs

// Renderer → Main
"auth:get-redirect-url"   // Requests callback URL for environment
"open-external"          // Opens OAuth URL in browser
"onboarding-complete"    // Completes onboarding flow
"ptt:set-target"         // Routes PTT to "auto", "onboarding", or "main"
"prepare-pill"           // Pre-creates pill window during onboarding
"pill:reveal"            // Shows pill without expanding
"pill:reveal-for-test"   // Shows pill during onboarding test steps
"permissions:post-grant" // Called after permission grants for UI sync
"floating-bar:hide-indefinitely" // Hides pill with fade
"floating-bar:show"      // Shows pill with fade
```

### Protocol Registration

**Development**:
```typescript
app.setAsDefaultProtocolClient("spoke-dev", exe, [appPath]);
```

**Production**:
```typescript
app.setAsDefaultProtocolClient("spoke");
```

## Deep Link Handling

### Registration and Validation

Deep links are registered during app startup and validated on receipt:

```typescript
// Validation logic
const isCustomScheme = parsed.protocol === "spoke:" || parsed.protocol === "spoke-dev:";
const isDevHttp = (parsed.protocol === "http:" || parsed.protocol === "https:") && 
                  (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
const isPathForm = parsed.pathname === "/auth/callback";
const isHostForm = isCustomScheme && parsed.hostname === "auth" && parsed.pathname === "/callback";
```

### Multi-Platform Support

- **macOS**: `app.on("open-url")` - Primary deep link handler
- **Windows/Linux**: `app.on("second-instance")` - Handles protocol from second instance
- **Development**: HTTP server fallback for unreliable protocol registration

### Token Extraction and Processing

The app handles multiple OAuth flow types:

**PKCE Flow** (recommended):
```
spoke://auth/callback?code=abc123
```

**Magic Link Flow**:
```
spoke://auth/callback#access_token=xyz&refresh_token=abc
```

**Email OTP Flow**:
```
spoke://auth/callback?token_hash=xyz&type=email
```

## Error Handling and Troubleshooting

### Common Issues and Solutions

#### "Invalid callback URL" Error
**Cause**: Callback URL not in Supabase allowlist or race condition in dev
**Solution**: 
- Ensure all URLs are exactly configured in Supabase dashboard
- Race condition eliminated by waiting for dev server

#### "Authentication setup failed" Error  
**Cause**: Dev server failed to start within timeout
**Solution**: Check port 43112 availability, restart app

#### Deep Link Not Opening App
**Cause**: Protocol not registered or app not installed
**Solution**: 
- Verify protocol registration in development
- Provide manual deep link button as fallback

#### Duplicate Token Processing
**Cause**: Multiple callback sources triggering simultaneously  
**Solution**: Implemented deduplication in `sendAuthCallback()`

#### "Onboarding repeats every login"
**Cause**: Missing `profiles` row or `onboarding_done` never set to true for that user id.
**Solution**: `ensureProfileRow()` on login; `markOnboardingDone()` at the end of onboarding; renderer short-circuits when `onboarding_done` is true.

#### "Signed out" during temporary network issues
**Cause**: Polling treated network errors as `null` user, triggering sign-out UX.
**Solution**: Poll uses `supabase.auth.getUser()` and only signs out when there is no error and no user. Network errors are ignored to avoid kicking users during blips.

### Debug Logging

Enable development tools for debugging:
```bash
# Environment variable for debugging
SF_DEVTOOLS=1 npm start            # Enable development console
```

**Tip:** Check browser console in the onboarding/pill windows for auth-related logs. Most auth functions log to console with prefixes like `[handleAuthCallbackUrl]`, `[updateDisplayName]`, etc.

### Error Messages

User-friendly error messages are provided for common failures:
- "Authentication setup failed" - Dev server timeout
- "Invalid auth callback URL" - URL validation failure  
- "Login failed" - General auth processing error

## Security Considerations

### URL Validation
- Strict validation of callback URLs to prevent malicious redirects
- Protocol and hostname checking for security
- Path validation to ensure legitimate callbacks

### Token Handling
- Tokens processed immediately and not stored in logs
- Secure token exchange using Supabase client
- Automatic session management with refresh tokens
- JWT claims embedded via Custom Access Token Hook for entitlement gating
- JWT signature verified on Worker using JWKS (Supabase public key)

### Supabase Auth Listener Best Practices
**CRITICAL:** Never call Supabase operations directly inside `onAuthStateChange` callback:

```typescript
// ❌ DANGEROUS - Breaks the auth listener
supabase.auth.onAuthStateChange(async (event) => {
  await supabase.from('profiles').select();  // This breaks subsequent events!
});

// ✅ SAFE - Defer with setTimeout
supabase.auth.onAuthStateChange((event) => {
  setTimeout(() => {
    supabase.from('profiles').select().then(...);
  }, 0);
});
```

**Why:** Executing Supabase operations within the callback can corrupt the listener state, causing it to stop firing for subsequent events. This is documented Supabase behavior but easy to miss.

**Impact:** Auth listener breaks after first use, causing sign-out failures and random behavior.

**Files that follow this pattern:**
- `src/state/userIdentity.ts` - Defers `refreshIdentity()`
- `src/components/App.tsx` - Defers `loadSharePreference()`

### Development Security
- Local HTTP server only binds to 127.0.0.1 (not 0.0.0.0)
- Protocol registration scoped to development environment
- Clear separation between dev and prod configurations

## Recent Cleanup (2024)

The auth system underwent major cleanup to resolve "invalid callback URL" errors and improve reliability:

### Issues Resolved
1. **Race Condition**: Removed custom scheme fallback that caused invalid URLs
2. **Dead Code**: Cleaned unused auth functions from SettingsPanel and supabaseClient
3. **Duplicate Processing**: Added deduplication to prevent token reuse
4. **Poor Error Handling**: Improved messages and timeout handling
5. **Configuration Duplication**: Eliminated duplicate initialization code

### Code Changes
- Converted `auth:get-redirect-url` to async with proper waiting
- Centralized auth callback handling in `sendAuthCallback()`
- Removed unused `verifyEmailOtp` function
- Enhanced error messages throughout the flow
- Added comprehensive duplicate prevention

### Performance Improvements
- Eliminated race conditions between server startup and auth requests
- Reduced redundant auth processing
- Cleaner IPC communication with fewer duplicate calls
- Better error recovery and user feedback

## 2025 Updates

### Behavior Changes
- **IntroExperience OAuth entry point** - Users can now start Google OAuth from the first intro screen instead of navigating to a separate auth step.
- **Name verification step** - After auth callback, users confirm/edit their display name before continuing to permissions.
- **Auth signals system** - Cross-window coordination via localStorage (`sf.auth.*` keys) prevents duplicate sign-in toasts.
- Scoped `renderer-ready` to the sending window; onboarding no longer causes the pill window to reappear.
- Dictation is gated client-side by signed-in state and microphone permission; clicking the pill while signed out opens onboarding instead of starting capture.
- Settings is no longer treated as an auth/account surface on the refactor line; provider selection and local API-key storage now live there instead.
- Sign-out flow explicitly hides the floating bar, cancels any active transcription, and routes PTT to onboarding.
- Added light auth polling (60s) to detect server-side deletions.
- Poll ignores network errors; only treats "no error + no user" as sign-out.
- Returning users skip onboarding based on `profiles.onboarding_done`.
- Onboarding email entry supports Enter-to-submit for OTP.
- Permissions logic is shared via `usePermissions` hook to eliminate duplication across Onboarding and Settings.
- **Smooth transitions** - `smoothShow()` and `smoothHide()` functions provide fade in/out for pill window.
- **Pre-created pill** - `preparePill()` is called during onboarding to pre-create the pill window for instant reveal.

### Historical Sign-Out Flow (Fixed December 2025)

This flow still exists in the app state machine, but the refactor line no longer exposes sign-out from `SettingsPanel`. Authentication remains onboarding-driven while settings focus on transcription providers and local credentials.

The sign-out flow underwent critical reliability fixes:

**Previous Issues:**
- Sign-out button appeared to do nothing (stuck on "Signing out...")
- First sign-out worked, but subsequent sign-outs failed
- Random sign-outs 1-2 minutes after clicking button
- Supabase auth listener silently broke after first use

**Root Cause:**
Calling Supabase operations inside `onAuthStateChange` callback breaks the listener:
```typescript
// ❌ BROKEN - Supabase query inside auth callback
supabase.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_IN") {
    await refreshIdentity();  // This breaks the listener!
  }
});
```

**Solution:**
Defer all Supabase operations outside the callback with `setTimeout()`:
```typescript
// ✅ FIXED - Deferred Supabase operations
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") {
    setTimeout(() => {
      refreshIdentity().catch(console.warn);
    }, 0);
  }
});
```

**Current Flow:**
1. A sign-out action calls `supaSignOut()`
2. `onAuthStateChange` fires with SIGNED_OUT event
3. Handler dispatches "Signed out" notification
4. Pill state machine transitions: EXPANDED → NOTIFICATION
5. Notification displays for 2 seconds
6. App shows onboarding window, routes PTT to onboarding

**Files Affected:**
- `src/components/App.tsx` - State machine handles NOTIFY in EXPANDED state, deferred Supabase calls
- `src/state/userIdentity.ts` - Deferred refreshIdentity() in auth listener

### Pre-Connect Pattern (Auth Error Reliability)

To eliminate first-dictation audio loss and ensure reliable error notifications:

**Problem:**
- First dictation after app launch lost 100-300ms of audio during auth check
- Auth errors sometimes didn't show (race conditions in async flow)
- UI showed "listening" before auth completed (incorrect state)

**Solution:**
```typescript
// Pre-connect WebSocket in background when app launches or user signs in
const preConnect = async () => {
  try {
    await ensureStreamingSocket();  // Establishes connection, verifies JWT
    console.info("[SF] Pre-connected to Worker successfully");
  } catch (err) {
    console.warn("[SF] Pre-connect failed (will retry on first dictation):", err);
  }
};
```

**Benefits:**
- First dictation captures audio from first syllable (zero latency)
- Auth errors show immediately and reliably (synchronous flow)
- UI stays in IDLE during auth, only shows LISTENING after success
- Pill state machine interrupts LISTENING for error notifications

**Triggers:**
- App launch when user is signed in (App.tsx)
- User signs in via auth state change (App.tsx)

**Error Handling:**
All auth failures normalized to single message: "Subscription required. Upgrade to continue."
- Covers: No JWT, invalid JWT (4012), no subscription (4020), quota exceeded (4021)
- State machine detects errors by content and shows immediately (doesn't queue)

### Backend JWT Verification (Implemented)

The Cloudflare Worker now fully enforces JWT-based authentication and entitlement gating:

**Authentication Flow:**
1. Client sends `{ type: "auth", token: "eyJhbG..." }` as first WebSocket message
2. Worker verifies JWT signature using JWKS (Supabase public key)
3. Worker extracts claims: `subscription_active`, `words_used_this_week`, `quota_limit`
4. Worker checks entitlement:
   - Pro users (`subscription_active: true`): Instant pass
   - Free users: Checks `words_used >= quota_limit` → blocks if exceeded
5. If auth passes: sends `{ type: "auth_ok" }`, connection ready
6. If auth fails: sends `{ type: "auth_error", code: 4011|4012|4020|4021 }`, closes connection

**Close Codes:**
- `4011` AUTH_TIMEOUT - No auth message within 15s
- `4012` UNAUTHORIZED - Invalid or expired JWT
- `4020` PAYMENT_REQUIRED - No active subscription (feature requires Pro)
- `4021` QUOTA_EXCEEDED - Free tier weekly limit reached (1000 words/week, resets Monday)

**Security:**
- Zero database queries during auth check (all data in JWT claims)
- Cryptographically secure (JWT signature verification)
- Instant blocking (checked before audio streams)
- Scales infinitely (pure CPU work, no DB bottleneck)

See `docs/TRANSCRIPTION.md` and `docs/DATABASE.md` for complete authentication and quota tracking architecture.

## Testing and Validation

### Development Testing
```bash
# Test auth flow in development
npm start
# Try Google sign-in - should use HTTP callback
# Check logs for proper URL handling
```

### Production Testing
```bash
# Test with production build
npm run package
# Try Google sign-in - should use hosted callback
# Verify deep link handling
```

### Supabase Configuration Verification
1. Check Authentication → URL Configuration
2. Verify all callback URLs are listed exactly
3. Test both Google OAuth and email magic links
4. Confirm deep links work on target platform

This authentication system provides a robust, secure, and user-friendly sign-in experience across all environments while maintaining clean, maintainable code architecture.
