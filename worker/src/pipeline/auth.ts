import { verifySupabaseJwt, WS_CLOSE_CODES, AUTH_TIMEOUT_MS } from "../auth";
import { safeClose } from "../utils/ws";
import { safely } from "../utils/safely";
import { logSessionAuth } from "../utils/sessionLogger";
import type { ConnectionContext } from "./types";

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  subscriptionActive?: boolean;
  error?: string;
  code?: number;
}

/**
 * Sets up auth timeout - closes connection if no auth within timeout
 */
export function setupAuthTimeout(ctx: ConnectionContext): void {
  ctx.authTimeoutHandle = setTimeout(() => {
    if (!ctx.authenticated && !ctx.socketClosed) {
      logSessionAuth({
        outcome: "timeout",
        duration_ms: AUTH_TIMEOUT_MS,
        cold_start: false,
        trace_id: ctx.traceId,
      });

      safely(() =>
        ctx.server.send(
          JSON.stringify({
            type: "auth_error",
            error: "Authentication timeout - please send auth message",
            code: WS_CLOSE_CODES.AUTH_TIMEOUT,
          }),
        ),
      );
      safeClose(ctx.server, WS_CLOSE_CODES.AUTH_TIMEOUT, "auth timeout");
    }
  }, AUTH_TIMEOUT_MS);
}

/**
 * Clears auth timeout (called when auth message received)
 */
export function clearAuthTimeout(ctx: ConnectionContext): void {
  if (ctx.authTimeoutHandle) {
    clearTimeout(ctx.authTimeoutHandle);
    ctx.authTimeoutHandle = null;
  }
}

/**
 * Handles auth message - verifies JWT and checks quota
 */
export async function handleAuth(
  ctx: ConnectionContext,
  token: string,
): Promise<AuthResult> {
  const supabaseUrl = ctx.env.SUPABASE_URL;

  if (!supabaseUrl) {
    return {
      success: false,
      error: "Server configuration error",
      code: WS_CLOSE_CODES.UNAUTHORIZED,
    };
  }

  // Verify JWT
  const jwtStartAt = Date.now();
  const jwtResult = await verifySupabaseJwt(token, supabaseUrl);
  const jwtDurationMs = Date.now() - jwtStartAt;

  ctx.timing.authStartAt = jwtStartAt;
  ctx.timing.authDurationMs = jwtDurationMs;
  ctx.timing.authWasColdStart = jwtDurationMs > 500;

  if (!jwtResult.valid) {
    logSessionAuth({
      outcome: "invalid",
      duration_ms: jwtDurationMs,
      cold_start: ctx.timing.authWasColdStart,
      trace_id: ctx.traceId,
    });

    const jwtErrorResult = jwtResult as {
      valid: false;
      error: string;
      code: "invalid" | "expired" | "malformed";
    };
    const errorMessage =
      jwtErrorResult.code === "expired"
        ? "Token has expired"
        : jwtErrorResult.error;

    return {
      success: false,
      error: errorMessage,
      code: WS_CLOSE_CODES.UNAUTHORIZED,
    };
  }

  // Check quota for free tier
  if (!jwtResult.subscriptionActive) {
    const wordsUsed = jwtResult.wordsUsedThisWeek ?? 0;
    const quotaLimit = jwtResult.quotaLimit ?? 1000;

    if (wordsUsed >= quotaLimit) {
      logSessionAuth({
        outcome: "quota_exceeded",
        duration_ms: jwtDurationMs,
        cold_start: ctx.timing.authWasColdStart,
        trace_id: ctx.traceId,
        user_id: jwtResult.userId,
      });

      return {
        success: false,
        error: "Free words used up this week",
        code: WS_CLOSE_CODES.QUOTA_EXCEEDED,
      };
    }
  }

  // Success
  logSessionAuth({
    outcome: "success",
    duration_ms: jwtDurationMs,
    cold_start: ctx.timing.authWasColdStart,
    trace_id: ctx.traceId,
    user_id: jwtResult.userId,
  });

  return {
    success: true,
    userId: jwtResult.userId,
    email: jwtResult.email,
    subscriptionActive: jwtResult.subscriptionActive,
  };
}

/**
 * Sends auth error and closes connection
 */
export function sendAuthError(
  ctx: ConnectionContext,
  error: string,
  code: number,
): void {
  safely(() =>
    ctx.server.send(
      JSON.stringify({
        type: "auth_error",
        error,
        code,
      }),
    ),
  );
  safeClose(ctx.server, code, error);
}

/**
 * Sends auth success
 */
export function sendAuthSuccess(ctx: ConnectionContext): void {
  safely(() =>
    ctx.server.send(
      JSON.stringify({
        type: "auth_ok",
        userId: ctx.userId,
      }),
    ),
  );
}
