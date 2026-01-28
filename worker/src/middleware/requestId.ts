/**
 * Request ID Middleware
 *
 * Generates or extracts X-Request-Id header for tracing.
 */

import { Context } from "hono";
import { nanoid } from "nanoid";

/**
 * Request ID middleware
 *
 * Generates a unique request ID or uses existing one from header.
 * Sets X-Request-Id response header and stores in c.var.requestId.
 */
export async function requestIdMiddleware(
  c: Context,
  next: () => Promise<void>,
) {
  // Use existing request ID from header, or generate new one
  const requestId = c.req.header("X-Request-Id") || nanoid(10);

  // Store in context for handlers
  c.set("requestId", requestId);

  // Set response header
  c.header("X-Request-Id", requestId);

  await next();
}
