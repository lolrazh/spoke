/**
 * Authentication Module
 *
 * Provides JWT verification and subscription checking for gating transcription access.
 *
 * Usage in WebSocket handler:
 * 1. Client sends { type: 'auth', token: '<supabase_access_token>' }
 * 2. Worker verifies JWT signature using JWKS
 * 3. Worker checks subscription status
 * 4. Worker responds with { type: 'auth_ok' } or closes connection
 *
 * See: plans/PAYMENTS_BLUEPRINT.md for full architecture
 */

export {
  verifySupabaseJwt,
  clearJwksCache,
  type JwtVerifyResult,
} from './supabaseJwt';

export {
  checkSubscription,
  hasActiveSubscription,
  type SubscriptionCheckResult,
} from './subscription';

/**
 * WebSocket close codes for auth errors
 */
export const WS_CLOSE_CODES = {
  /** Token invalid, expired, or malformed */
  UNAUTHORIZED: 4010,
  /** Valid user but no active subscription */
  PAYMENT_REQUIRED: 4020,
  /** Auth message timeout (no auth message received within timeout) */
  AUTH_TIMEOUT: 4011,
} as const;

/**
 * Auth timeout duration in milliseconds
 * Client must send auth message within this time after connecting
 */
export const AUTH_TIMEOUT_MS = 10_000; // 10 seconds
