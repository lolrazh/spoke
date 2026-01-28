/**
 * HTTP Auth Middleware
 *
 * Extracts JWT from Authorization header, verifies it, and sets auth context.
 * Used by /prepare and /transcribe endpoints.
 */

import { Context } from "hono";
import { verifySupabaseJwt } from "../auth";

export type AuthContext = {
  userId: string;
  email: string;
  subscriptionActive: boolean;
  wordsUsedThisWeek?: number;
  quotaLimit?: number;
  authMs?: number; // JWT verification time (ms)
};

/**
 * Auth middleware for HTTP endpoints
 *
 * Extracts Authorization header, verifies JWT, and populates c.var.auth
 * Returns 401 or 402 on auth failures
 */
export async function authMiddleware(c: Context, next: () => Promise<void>) {
  const authStartTime = Date.now();
  const supabaseUrl = c.env.SUPABASE_URL;

  if (!supabaseUrl) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  // Extract Bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Missing or invalid Authorization header",
        code: "unauthorized",
      },
      401,
    );
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Verify JWT
  const jwtResult = await verifySupabaseJwt(token, supabaseUrl);
  const authMs = Date.now() - authStartTime;

  // Log auth timing (this runs BEFORE handler timing starts)
  console.log(`[Auth] JWT verification completed in ${authMs}ms`);

  if (!jwtResult.valid) {
    const jwtError = jwtResult as { valid: false; error: string; code: string };

    if (jwtError.code === "expired") {
      return c.json({ error: "Token has expired", code: "token_expired" }, 401);
    }

    return c.json({ error: jwtError.error, code: "unauthorized" }, 401);
  }

  // Check quota for free tier
  if (!jwtResult.subscriptionActive) {
    const wordsUsed = jwtResult.wordsUsedThisWeek ?? 0;
    const quotaLimit = jwtResult.quotaLimit ?? 1000;

    if (wordsUsed >= quotaLimit) {
      return c.json(
        {
          error: "Free words used up this week",
          code: "quota_exceeded",
          wordsUsed,
          quotaLimit,
        },
        402, // Payment Required
      );
    }
  }

  // Set auth context in c.var for downstream handlers
  c.set("auth", {
    userId: jwtResult.userId,
    email: jwtResult.email,
    subscriptionActive: jwtResult.subscriptionActive,
    wordsUsedThisWeek: jwtResult.wordsUsedThisWeek,
    quotaLimit: jwtResult.quotaLimit,
    authMs, // Pass auth timing to handler for logging
  } as AuthContext);

  await next();
}
