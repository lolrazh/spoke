/**
 * Authentication Module
 *
 * Provides JWT verification for gating transcription access.
 *
 * Usage in WebSocket handler:
 * 1. Client sends { type: 'auth', token: '<supabase_access_token>' }
 * 2. Worker verifies JWT signature using JWKS
 * 3. Worker reads subscription_active claim from JWT payload
 * 4. Worker responds with { type: 'auth_ok' } or closes connection
 *
 * Subscription status is baked into the JWT via Supabase Custom Access Token Hook.
 * No database query is needed per request — the claim is verified cryptographically.
 *
 * See: plans/PAYMENTS_AUTH_OPTIMIZATION.md for architecture details
 */

export {
  verifySupabaseJwt,
  clearJwksCache,
  type JwtVerifyResult,
} from './supabaseJwt';

/**
 * WebSocket close codes for auth errors
 */
export const WS_CLOSE_CODES = {
  /** Token invalid, expired, or malformed */
  UNAUTHORIZED: 4010,
  /** Valid user but no active subscription */
  PAYMENT_REQUIRED: 4020,
  /** Free tier user exceeded monthly quota */
  QUOTA_EXCEEDED: 4021,
  /** Auth message timeout (no auth message received within timeout) */
  AUTH_TIMEOUT: 4011,
} as const;

/**
 * Auth timeout duration in milliseconds
 * Client must send auth message within this time after connecting
 */
export const AUTH_TIMEOUT_MS = 10_000; // 10 seconds
