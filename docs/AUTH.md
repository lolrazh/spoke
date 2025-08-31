# Sonic Flow App - Auth Flow - docs/AUTH.md

This file provides comprehensive documentation for Sonic Flow's authentication system, including OAuth flows, deep link handling, and environment-specific configurations.

## Overview

Sonic Flow uses a **hybrid authentication system** that combines Supabase OAuth with custom deep link handling to provide seamless sign-in across development and production environments. The system supports Google OAuth and email magic links, with automatic app launching after authentication.

### Key Features
- **Supabase OAuth Integration** - Google sign-in and email magic links
- **Cross-Platform Deep Links** - `sonicflow://` protocol handling
- **Development HTTP Server** - Local callback server for dev environments
- **Hosted Callback Page** - Production web interface at `auth.sonicflow.app`
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
│   and completes │    │   with tokens    │    │   (sonicflow://)│
│   sign-in       │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Component Interaction

- **Electron Main Process** (`src/main.ts`) - Handles deep links, manages callback URLs, coordinates auth flow
- **Renderer/Onboarding** (`src/components/Onboarding.tsx`) - Initiates auth, displays UI, handles responses
- **Supabase Client** (`src/lib/supabaseClient.ts`) - Manages OAuth requests and token processing
- **Hosted Callback** (`api-sonic-flow-site`) - Production web interface for OAuth callbacks
- **Deep Link Handler** - Protocol registration and URL parsing across platforms

### Returning User Skip Logic (2025 Update)

- Uses `profiles.onboarding_done` in Supabase as cross-device source of truth to skip onboarding for returning users.
- On login or renderer mount, the app ensures a `profiles` row exists and immediately closes onboarding if `onboarding_done` is true.
- Local `onboarding.json` remains a fast local skip; the DB flag is authoritative across machines.

## Authentication Flow

### Complete OAuth Flow

```
1. User clicks "Sign in with Google" in Onboarding
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
11. App validates and processes auth tokens
12. User is signed in and onboarding continues
```

### Step-by-Step Process

#### 1. **Auth Initiation** (`Onboarding.tsx`)
```typescript
const handleGoogle = async () => {
  const url = await getGoogleOAuthUrl();  // Get OAuth URL
  await window.electron?.openExternal(url);  // Open in browser
};
```

#### 2. **Redirect URL Resolution** (`main.ts`)
```typescript
ipcMain.handle("auth:get-redirect-url", async () => {
  const isDev = !app.isPackaged;
  if (isDev) {
    // Wait for HTTP server to be ready (prevents race condition)
    await waitForDevServer();
    return { url: "http://127.0.0.1:43112/auth/callback" };
  }
  return { url: "https://auth.sonicflow.app/auth/callback" };
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
- **Production**: Hosted page at `auth.sonicflow.app` receives callback

#### 5. **Deep Link Generation**
Both callback methods convert to deep link: `sonicflow://auth/callback?code=...`

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

### 8. Returning-User Short-Circuit (Renderer)

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

## Environment Configuration

### Development Environment

**Callback Strategy**: Local HTTP Server
- **URL**: `http://127.0.0.1:43112/auth/callback`
- **Port**: 43112 (fixed)
- **Protocol**: Custom `sonicflow-dev://` protocol registered
- **Server**: Started automatically in `main.ts` when `!app.isPackaged`

**Key Features**:
- Waits for server to be ready before allowing auth (prevents race condition)
- 10-second timeout with proper error handling
- Automatic protocol registration for deep links

### Production Environment

**Callback Strategy**: Hosted Web Page
- **URL**: `https://auth.sonicflow.app/auth/callback`
- **Protocol**: Custom `sonicflow://` protocol registered
- **Hosting**: Vercel deployment from `api-sonic-flow-site`

**Hosted Page Requirements**:
- Must parse OAuth callback parameters (`?code=...` or `#access_token=...`)
- Must immediately deep-link to app with: `sonicflow://auth/callback?...`
- Must provide fallback UI if deep link fails

## URL Structure and Configuration

### Supabase Redirect URLs (Required in Dashboard)

**Production URLs**:
```
https://auth.sonicflow.app/auth/callback
sonicflow://auth/callback
```

**Development URLs**:
```
http://127.0.0.1:43112/auth/callback
http://localhost:43112/auth/callback
```

### Deep Link URL Formats

**Standard Form** (recommended):
```
sonicflow://auth/callback?code=abc123
sonicflow://auth/callback#access_token=xyz&refresh_token=abc
```

**Path Form** (also supported):
```
sonicflow:///auth/callback?code=abc123
```

### Callback URL Validation

The app accepts these URL patterns in `handleAuthCallbackUrl()`:
- Custom schemes: `sonicflow://` and `sonicflow-dev://`
- Dev HTTP: `http://127.0.0.1:43112` and `http://localhost:43112`
- Path validation: `/auth/callback` or hostname `auth` with pathname `/callback`

## Implementation Details

### File Organization

```
src/
├── main.ts                 # Main process - deep link handling, HTTP server
├── preload.ts             # IPC bridge for auth communication
├── lib/
│   └── supabaseClient.ts  # OAuth URL generation, token processing
├── components/
│   └── Onboarding.tsx     # Auth UI, returning-user short-circuit, permissions
└── types/
    └── electron.d.ts      # TypeScript definitions for auth IPC
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

### IPC Communication

**Auth-related IPC channels**:
```typescript
// Main → Renderer
"auth:callback"           // Delivers auth callback URLs
"ptt-ready"              // Signals auth system ready

// Renderer → Main  
"auth:get-redirect-url"   // Requests callback URL for environment
"open-external"          // Opens OAuth URL in browser
"onboarding-complete"    // Completes auth flow
```

### Protocol Registration

**Development**:
```typescript
app.setAsDefaultProtocolClient("sonicflow-dev", exe, [appPath]);
```

**Production**:
```typescript
app.setAsDefaultProtocolClient("sonicflow");
```

## Deep Link Handling

### Registration and Validation

Deep links are registered during app startup and validated on receipt:

```typescript
// Validation logic
const isCustomScheme = parsed.protocol === "sonicflow:" || parsed.protocol === "sonicflow-dev:";
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
sonicflow://auth/callback?code=abc123
```

**Magic Link Flow**:
```
sonicflow://auth/callback#access_token=xyz&refresh_token=abc
```

**Email OTP Flow**:
```
sonicflow://auth/callback?token_hash=xyz&type=email
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

### Debug Logging

Enable detailed auth logging:
```bash
# Environment variables for debugging
SF_DEBUG_AUTH=1 npm start          # Auth flow debugging
SF_DEBUG_IPC=1 npm start           # IPC communication debugging
```

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
- Scoped `renderer-ready` to the sending window; onboarding no longer causes the pill window to reappear.
- Dictation is gated client-side by signed-in state and microphone permission; clicking the pill while signed out opens onboarding instead of starting capture.
- Sign-out flow explicitly hides the floating bar, cancels any active transcription, and routes PTT to onboarding.
- Added light auth polling (60s) to detect server-side deletions until server-side JWT gating is added.
- Returning users skip onboarding based on `profiles.onboarding_done`.
- Onboarding email entry supports Enter-to-submit for OTP.

### Deferred Backend Enforcement
- JWT verification on the Cloudflare Worker WebSocket is deferred; backend remains open while the client enforces UX. Plan: include `Authorization: Bearer <access_token>` and verify on the Worker when ready.

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
