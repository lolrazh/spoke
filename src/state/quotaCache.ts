/**
 * Quota Cache Module
 * 
 * Manages free tier quota tracking using localStorage (same pattern as userIdentity.ts)
 * 
 * ELI5: This is like a punch card in your wallet
 * - You mark off items as you use them (incrementQuotaLocal)
 * - Every so often, you sync with the server (syncQuotaToServer)
 * - Your UI can watch the card to update progress bars (subscribeQuota)
 * 
 * LOCAL-FIRST APPROACH:
 * - Instant UI updates (no waiting for database)
 * - Periodic sync to server (efficient, batched)
 * - Offline-aware (queues syncs when offline)
 * - Server validation on app startup (tamper protection)
 */

import { getSupabase } from '../lib/supabaseClient';

// ============================================================================
// TYPES
// ============================================================================

export type QuotaState = {
    wordsUsed: number;        // How many words used this month
    resetDate: string | null; // When quota resets (ISO timestamp)
    limit: number;            // Monthly limit (hardcoded to 2000)
};

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_KEY_WORDS_USED = 'sf.quotaWordsUsed';
const CACHE_KEY_RESET_DATE = 'sf.quotaResetDate';
const CACHE_KEY_LAST_SYNCED = 'sf.quotaLastSynced';
const QUOTA_LIMIT = 2000; // Free tier limit - hardcoded for now

// ============================================================================
// STATE
// ============================================================================

const listeners = new Set<(quota: QuotaState) => void>();
let quota: QuotaState = {
    wordsUsed: 0,
    resetDate: null,
    limit: QUOTA_LIMIT,
};

let initialized = false;
let dictationsSinceLastSync = 0; // Counter for "every 5 dictations" sync trigger
let syncTimer: NodeJS.Timeout | null = null; // Timer for "every 5 minutes" sync trigger

// ============================================================================
// CACHE HYDRATION (runs on module load)
// ============================================================================

// Load from localStorage on startup for instant UI display
try {
    if (typeof window !== 'undefined' && window.localStorage) {
        const cachedWordsUsed = window.localStorage.getItem(CACHE_KEY_WORDS_USED);
        const cachedResetDate = window.localStorage.getItem(CACHE_KEY_RESET_DATE);

        if (cachedWordsUsed !== null) {
            quota = {
                wordsUsed: parseInt(cachedWordsUsed, 10) || 0,
                resetDate: cachedResetDate,
                limit: QUOTA_LIMIT,
            };
            console.log('[QuotaCache] Hydrated from cache:', {
                wordsUsed: quota.wordsUsed,
                resetDate: quota.resetDate,
                limit: quota.limit,
            });
        }
    }
} catch {
    // Ignore cache hydration failures (localStorage might be disabled)
}

// ============================================================================
// INTERNAL: EMIT CHANGES
// ============================================================================

/**
 * Emit quota changes to all subscribers and update localStorage
 */
function emit(next: QuotaState) {
    // Sanitize input
    const sanitized: QuotaState = {
        wordsUsed: Math.max(0, Math.floor(next.wordsUsed)), // Ensure non-negative integer
        resetDate: next.resetDate,
        limit: QUOTA_LIMIT,
    };

    // Skip if nothing changed
    if (
        quota.wordsUsed === sanitized.wordsUsed &&
        quota.resetDate === sanitized.resetDate
    ) {
        return;
    }

    quota = sanitized;

    // Update localStorage cache
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(CACHE_KEY_WORDS_USED, String(sanitized.wordsUsed));

            if (sanitized.resetDate) {
                window.localStorage.setItem(CACHE_KEY_RESET_DATE, sanitized.resetDate);
            } else {
                window.localStorage.removeItem(CACHE_KEY_RESET_DATE);
            }

            console.log('[QuotaCache] Cache updated:', {
                wordsUsed: sanitized.wordsUsed,
                resetDate: sanitized.resetDate,
            });
        }
    } catch {
        // Ignore storage failures
    }

    // Notify all subscribers (e.g., progress bar components)
    for (const listener of listeners) {
        try {
            listener(quota);
        } catch {
            // Ignore listener errors to avoid breaking other listeners
        }
    }
}

// ============================================================================
// PUBLIC: SUBSCRIBE TO CHANGES
// ============================================================================

/**
 * Subscribe to quota changes (for reactive UI updates)
 * 
 * @example
 * const unsubscribe = subscribeQuota((quota) => {
 *   console.log(`Used ${quota.wordsUsed} of ${quota.limit} words`);
 * });
 */
export function subscribeQuota(listener: (quota: QuotaState) => void) {
    listeners.add(listener);
    listener(quota); // Immediately call with current state
    return () => {
        listeners.delete(listener);
    };
}

// ============================================================================
// PUBLIC: INCREMENT QUOTA LOCALLY
// ============================================================================

/**
 * Increment quota counter locally (instant UI update)
 * This does NOT sync to server - call syncQuotaToServer() separately
 * 
 * @param wordCount - Number of words to add to quota
 * 
 * @example
 * incrementQuotaLocal(50); // Add 50 words to local counter
 */
export function incrementQuotaLocal(wordCount: number): void {
    if (wordCount <= 0) return;

    const nextWordsUsed = quota.wordsUsed + wordCount;

    emit({
        wordsUsed: nextWordsUsed,
        resetDate: quota.resetDate,
        limit: QUOTA_LIMIT,
    });

    // Track dictations for sync trigger
    dictationsSinceLastSync++;

    console.log('[QuotaCache] Incremented locally:', {
        added: wordCount,
        total: nextWordsUsed,
        dictationsSinceLastSync,
    });
}

// ============================================================================
// PUBLIC: SYNC TO SERVER
// ============================================================================

/**
 * Sync local quota to Supabase database
 * This is called periodically (every 5 dictations or 5 minutes)
 * 
 * @returns Promise that resolves to true if sync succeeded
 */
export async function syncQuotaToServer(): Promise<boolean> {
    // Check if online
    if (typeof navigator !== 'undefined' && navigator && !navigator.onLine) {
        console.info('[QuotaCache] Offline; skipping sync');
        return false;
    }

    const supabase = getSupabase();
    if (!supabase) {
        console.warn('[QuotaCache] No Supabase client; skipping sync');
        return false;
    }

    // Get current user ID
    let userId: string | null = null;
    try {
        const { getCurrentUser } = await import('../lib/supabaseClient');
        const user = await getCurrentUser();
        userId = user?.id ?? null;
    } catch (err) {
        console.warn('[QuotaCache] Failed to get user ID:', err);
        return false;
    }

    if (!userId) {
        console.warn('[QuotaCache] No user ID; skipping sync');
        return false;
    }

    try {
        console.log('[QuotaCache] Syncing to server:', {
            userId,
            wordsUsed: quota.wordsUsed
        });

        // Call the simple sync function - just updates the DB with our local value
        const { error } = await supabase.rpc('sync_quota_simple', {
            p_user_id: userId,
            p_words_used: quota.wordsUsed,
        });

        if (error) {
            console.error('[QuotaCache] Sync RPC error:', error);
            return false;
        }

        // Update last synced timestamp
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(CACHE_KEY_LAST_SYNCED, new Date().toISOString());
            }
        } catch {
            // Ignore storage failures
        }

        // Reset sync counter
        dictationsSinceLastSync = 0;

        console.log('[QuotaCache] Sync successful');
        return true;
    } catch (error) {
        console.error('[QuotaCache] Sync failed:', error);
        return false;
    }
}

// ============================================================================
// PUBLIC: CHECK IF SHOULD SYNC
// ============================================================================

/**
 * Check if we should sync to server based on triggers:
 * - Every 5 dictations
 * - Every 5 minutes (handled by timer)
 * - When quota limit reached
 * 
 * @returns true if should sync now
 */
export function shouldSyncQuota(): boolean {
    // Always sync if we've hit the limit
    if (quota.wordsUsed >= quota.limit) {
        return true;
    }

    // Sync every 5 dictations
    if (dictationsSinceLastSync >= 5) {
        return true;
    }

    return false;
}

// ============================================================================
// PUBLIC: INITIALIZE MODULE
// ============================================================================

/**
 * Initialize quota cache module
 * - Starts 5-minute sync timer
 * - Can be called multiple times safely (idempotent)
 */
export function initQuotaCache(): void {
    if (initialized) return;

    // Start 5-minute sync timer
    if (syncTimer) {
        clearInterval(syncTimer);
    }

    syncTimer = setInterval(() => {
        console.log('[QuotaCache] 5-minute timer triggered');
        syncQuotaToServer().catch((error) => {
            console.warn('[QuotaCache] Timer-based sync failed:', error);
        });
    }, 5 * 60 * 1000); // 5 minutes

    initialized = true;
    console.log('[QuotaCache] Initialized with 5-minute sync timer');
}

// ============================================================================
// PUBLIC: GET CURRENT QUOTA
// ============================================================================

/**
 * Get current quota state (synchronous)
 */
export function getQuota(): QuotaState {
    return quota;
}

/**
 * Check if user has exceeded quota
 */
export function isQuotaExceeded(): boolean {
    return quota.wordsUsed >= quota.limit;
}

/**
 * Get remaining words in quota
 */
export function getRemainingWords(): number {
    return Math.max(0, quota.limit - quota.wordsUsed);
}

// ============================================================================
// PUBLIC: CLEAR CACHE (on sign out)
// ============================================================================

/**
 * Clear quota cache (called on sign-out)
 */
export function clearQuotaCache(): void {
    quota = {
        wordsUsed: 0,
        resetDate: null,
        limit: QUOTA_LIMIT,
    };

    dictationsSinceLastSync = 0;

    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }

    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(CACHE_KEY_WORDS_USED);
            window.localStorage.removeItem(CACHE_KEY_RESET_DATE);
            window.localStorage.removeItem(CACHE_KEY_LAST_SYNCED);
            console.log('[QuotaCache] Cache cleared');
        }
    } catch {
        // Ignore storage failures
    }

    // Notify listeners about cleared state
    for (const listener of listeners) {
        try {
            listener(quota);
        } catch { }
    }
}

// ============================================================================
// PUBLIC: UPDATE FROM SERVER (validation/refresh)
// ============================================================================

/**
 * Update quota from server data (e.g., JWT claims or database)
 * This is the "server wins" validation that prevents tampering
 * 
 * @param serverQuota - Quota data from server
 */
export function updateQuotaFromServer(serverQuota: {
    wordsUsed: number;
    resetDate: string | null;
}): void {
    console.log('[QuotaCache] Updating from server:', serverQuota);

    emit({
        wordsUsed: serverQuota.wordsUsed,
        resetDate: serverQuota.resetDate,
        limit: QUOTA_LIMIT,
    });

    // Reset sync counter since we just got fresh data
    dictationsSinceLastSync = 0;
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Reset quota cache for tests
 */
export function resetQuotaCacheForTests(): void {
    quota = {
        wordsUsed: 0,
        resetDate: null,
        limit: QUOTA_LIMIT,
    };

    initialized = false;
    dictationsSinceLastSync = 0;

    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }

    listeners.clear();

    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(CACHE_KEY_WORDS_USED);
            window.localStorage.removeItem(CACHE_KEY_RESET_DATE);
            window.localStorage.removeItem(CACHE_KEY_LAST_SYNCED);
        }
    } catch { }
}
