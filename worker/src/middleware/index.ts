/**
 * Middleware Composition
 *
 * Exports all middleware and provides composition utilities.
 */

import { Context } from "hono";
import { cors } from "hono/cors";

export { authMiddleware } from "./auth";
export { requestIdMiddleware } from "./requestId";

/**
 * CORS middleware for Electron app
 *
 * Allows file:// protocol (Electron) and localhost (dev)
 */
export const corsMiddleware = cors({
  origin: (origin) => {
    // Allow Electron (file://) and dev (localhost:5173)
    if (
      !origin ||
      origin.startsWith("file://") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    ) {
      return origin || "*";
    }
    return null;
  },
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  exposeHeaders: ["X-Request-Id"],
});

/**
 * Global error handler
 *
 * Catches any unhandled errors and returns consistent JSON response.
 */
export async function errorHandler(
  c: Context,
  next: () => Promise<void>,
): Promise<Response | void> {
  try {
    await next();
  } catch (error) {
    console.error("[HTTP] Unhandled error:", error);

    const message = error instanceof Error ? error.message : String(error);
    const requestId = c.get("requestId") || "unknown";

    return c.json(
      {
        error: "Internal server error",
        message,
        requestId,
      },
      500,
    );
  }
}

/**
 * Rate limiting middleware (placeholder)
 *
 * NOTE: For Phase 1, we'll use Cloudflare Rate Limiting Rules (dashboard config).
 * This is a placeholder for Phase 4 if we need code-based rate limiting.
 */
export async function rateLimitMiddleware(
  c: Context,
  next: () => Promise<void>,
) {
  // TODO: Implement KV-based rate limiting if CF Rules hit limits
  // For now, pass through (CF Rules handle rate limiting)
  await next();
}
