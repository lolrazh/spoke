/**
 * Supabase JWT Verification using JWKS
 *
 * Verifies Supabase access tokens using the public JWKS endpoint.
 * This is the recommended approach for verifying JWTs in edge environments.
 *
 * How it works:
 * 1. Supabase signs JWTs with a private key (ES256/P-256 algorithm)
 * 2. The public key is available at: https://<project>.supabase.co/auth/v1/.well-known/jwks.json
 * 3. We use the public key to verify the JWT signature
 * 4. If valid, we extract user info from the token claims
 *
 * Key claims in Supabase JWTs:
 * - sub: User's unique ID (UUID)
 * - email: User's email address
 * - aud: Audience (should be "authenticated")
 * - exp: Expiration timestamp
 * - iss: Issuer (your Supabase project URL)
 */

import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

/**
 * Cache for JWKS instances per Supabase URL
 * jose's createRemoteJWKSet handles its own internal caching,
 * but we cache the function reference to avoid recreating it.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Get or create a JWKS verifier for the given Supabase URL
 */
function getJWKS(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(supabaseUrl);
  if (cached) {
    return cached;
  }

  // Build the JWKS endpoint URL
  // Format: https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
  const jwksUrl = new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);

  const jwks = createRemoteJWKSet(jwksUrl);
  jwksCache.set(supabaseUrl, jwks);
  return jwks;
}

/**
 * Result type for JWT verification
 */
export type JwtVerifyResult =
  | { valid: true; userId: string; email: string; subscriptionActive: boolean; payload: JWTPayload }
  | { valid: false; error: string; code: 'invalid' | 'expired' | 'malformed' };

/**
 * Verify a Supabase JWT and extract user information
 *
 * @param token - The JWT access token from Supabase
 * @param supabaseUrl - The Supabase project URL (e.g., https://xxx.supabase.co)
 * @returns Verification result with user info or error details
 *
 * @example
 * ```typescript
 * const result = await verifySupabaseJwt(token, 'https://xxx.supabase.co');
 * if (result.valid) {
 *   console.log('User ID:', result.userId);
 *   console.log('Email:', result.email);
 * } else {
 *   console.log('Invalid token:', result.error);
 * }
 * ```
 */
export async function verifySupabaseJwt(
  token: string,
  supabaseUrl: string
): Promise<JwtVerifyResult> {
  // Basic validation
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is required', code: 'malformed' };
  }

  if (!supabaseUrl || typeof supabaseUrl !== 'string') {
    return { valid: false, error: 'Supabase URL is required', code: 'invalid' };
  }

  try {
    const JWKS = getJWKS(supabaseUrl);

    // Verify the JWT signature and claims
    const { payload } = await jwtVerify(token, JWKS, {
      // Verify the token was issued by this Supabase project
      issuer: `${supabaseUrl}/auth/v1`,
      // Verify the token is for authenticated users
      audience: 'authenticated',
    });

    // Extract required claims
    const userId = payload.sub;
    const email = payload.email as string | undefined;
    const subscriptionActive = payload.subscription_active === true;

    if (!userId) {
      return {
        valid: false,
        error: 'Token missing user ID (sub claim)',
        code: 'malformed',
      };
    }

    return {
      valid: true,
      userId,
      email: email || '',
      subscriptionActive,
      payload,
    };
  } catch (error: unknown) {
    // Handle specific error types from jose
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Log for debugging (will appear in Cloudflare logs)
    console.error('[Auth] JWT verification failed:', {
      error: errorMessage,
      name: errorName,
    });

    // Determine error code based on error type
    if (
      errorName === 'JWTExpired' ||
      errorMessage.includes('exp') ||
      errorMessage.includes('expired')
    ) {
      return {
        valid: false,
        error: 'Token has expired',
        code: 'expired',
      };
    }

    if (
      errorName === 'JWTClaimValidationFailed' ||
      errorMessage.includes('issuer') ||
      errorMessage.includes('audience')
    ) {
      return {
        valid: false,
        error: `Token validation failed: ${errorMessage}`,
        code: 'invalid',
      };
    }

    // Generic invalid token (signature mismatch, malformed, etc.)
    return {
      valid: false,
      error: `Invalid token: ${errorMessage}`,
      code: 'invalid',
    };
  }
}

/**
 * Clear the JWKS cache (useful for testing or key rotation)
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}
