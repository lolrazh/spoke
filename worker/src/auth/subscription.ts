/**
 * Subscription Status Check
 *
 * Queries the Supabase `subscriptions` table to verify if a user has an active subscription.
 * This is called once per WebSocket session (not per audio frame) to gate access.
 *
 * Database schema (from docs/DATABASE.md):
 * - subscriptions.user_id: UUID, FK to auth.users.id
 * - subscriptions.status: 'active' | 'canceled' | 'past_due' | 'paused'
 *
 * Valid subscription statuses that grant access:
 * - 'active': Paid and in good standing
 * - 'trialing': Trial period (if we add this later)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Subscription status values that grant access to transcription
 */
const ACTIVE_STATUSES = ['active', 'trialing'] as const;

/**
 * Result type for subscription check
 */
export type SubscriptionCheckResult =
  | { hasAccess: true; status: string; subscriptionId: string | null }
  | { hasAccess: false; reason: 'no_subscription' | 'inactive' | 'error'; status?: string };

/**
 * Check if a user has an active subscription
 *
 * @param supabase - Supabase client (with service role for bypassing RLS)
 * @param userId - The user's UUID (from JWT's `sub` claim)
 * @returns Whether the user has access and their subscription status
 *
 * @example
 * ```typescript
 * const result = await checkSubscription(supabase, userId);
 * if (result.hasAccess) {
 *   // Allow transcription
 *   console.log('Active subscription:', result.status);
 * } else {
 *   // Block and prompt upgrade
 *   console.log('No access:', result.reason);
 * }
 * ```
 */
export async function checkSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionCheckResult> {
  try {
    // Query for active subscriptions
    // Using maybeSingle() to handle 0 or 1 row gracefully
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, subscription_id, status')
      .eq('user_id', userId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Auth] Subscription query failed:', {
        userId,
        error: error.message,
        code: error.code,
      });
      // Fail closed — if we can't check, deny access
      return { hasAccess: false, reason: 'error' };
    }

    // No active subscription found
    if (!data) {
      // Check if user has ANY subscription (to differentiate "never subscribed" vs "expired")
      const { data: anySubscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (anySubscription) {
        // User has a subscription, but it's not active
        return {
          hasAccess: false,
          reason: 'inactive',
          status: anySubscription.status,
        };
      }

      // User has never had a subscription
      return { hasAccess: false, reason: 'no_subscription' };
    }

    // Active subscription found
    return {
      hasAccess: true,
      status: data.status,
      subscriptionId: data.subscription_id,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Subscription check exception:', {
      userId,
      error: errorMessage,
    });
    // Fail closed — deny access on error
    return { hasAccess: false, reason: 'error' };
  }
}

/**
 * Simple boolean check for subscription access
 * Convenience wrapper for cases where you only need yes/no
 *
 * @param supabase - Supabase client
 * @param userId - The user's UUID
 * @returns true if user has active subscription, false otherwise
 */
export async function hasActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const result = await checkSubscription(supabase, userId);
  return result.hasAccess;
}
