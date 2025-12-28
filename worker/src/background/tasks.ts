import type { ConnectionContext } from "../pipeline/types";

/**
 * Schedules quota increment (for free tier users)
 *
 * Note: Uses fire-and-forget pattern. In production, this should use
 * executionCtx.waitUntil() to ensure completion.
 */
export function scheduleQuotaIncrement(
  ctx: ConnectionContext,
  wordCount: number,
  executionCtx?: ExecutionContext,
): void {
  if (ctx.subscriptionActive || !ctx.userId || wordCount === 0) {
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = ctx.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const task = (async () => {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_quota_simple`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          p_user_id: ctx.userId,
          p_word_count: wordCount,
        }),
      });
    } catch (error) {
      console.warn("[Background] Quota increment failed:", error);
    }
  })();

  // If executionCtx is available, use waitUntil for proper lifecycle
  if (executionCtx) {
    executionCtx.waitUntil(task);
  } else {
    // Fire-and-forget fallback
    task.catch(() => {});
  }
}

/**
 * Schedules analytics logging
 */
export function scheduleAnalytics(
  ctx: ConnectionContext,
  data: any,
  executionCtx: ExecutionContext,
): void {
  executionCtx.waitUntil(
    (async () => {
      try {
        console.log("[Background] Session analytics:", {
          trace_id: ctx.traceId,
          user_id: ctx.userId,
          data,
        });
      } catch (error) {
        console.warn("[Background] Analytics logging failed:", error);
      }
    })(),
  );
}
