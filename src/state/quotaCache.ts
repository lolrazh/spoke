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

// Note: This module is UI-local and does not directly call Supabase.

// ============================================================================
// TYPES
// ============================================================================

export type QuotaState = {
    wordsUsed: number;        // How many words used this week
    resetDate: string | null; // When quota resets (ISO timestamp)
    limit: number;            // Weekly limit (hardcoded to 1000)
    isPro: boolean;           // Is user a Pro subscriber? (unlimited dictation)
};

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_KEY_WORDS_USED = 'sf.quotaWordsUsed';
const CACHE_KEY_RESET_DATE = 'sf.quotaResetDate';
const CACHE_KEY_LAST_SYNCED = 'sf.quotaLastSynced';
const QUOTA_LIMIT = 1000; // Free tier limit (1k/week) - hardcoded for now

// ============================================================================
// STATE
// ============================================================================

const listeners = new Set<(quota: QuotaState) => void>();
let quota: QuotaState = {
    wordsUsed: 0,
    resetDate: null,
    limit: QUOTA_LIMIT,
    isPro: false, // Default to free tier until we know from JWT
};

let initialized = false;

// ============================================================================
// CACHE HYDRATION (runs on module load)
// ============================================================================

// Load from localStorage on startup for instant UI display
try {
    if (typeof window !== 'undefined' && window.localStorage) {
        const cachedWordsUsed = window.localStorage.getItem(CACHE_KEY_WORDS_USED);
        const cachedResetDate = window.localStorage.getItem(CACHE_KEY_RESET_DATE);

        // Also check for cached subscription status
        const cachedIsPro = window.localStorage.getItem('sf.isPro');

        if (cachedWordsUsed !== null || cachedIsPro !== null) {
            quota = {
                wordsUsed: cachedWordsUsed ? parseInt(cachedWordsUsed, 10) || 0 : 0,
                resetDate: cachedResetDate,
                limit: QUOTA_LIMIT,
                isPro: cachedIsPro === 'true',
            };
            // Cache hydrated successfully
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
        isPro: !!next.isPro,
    };

    // Skip if nothing changed
    if (
        quota.wordsUsed === sanitized.wordsUsed &&
        quota.resetDate === sanitized.resetDate &&
        quota.isPro === sanitized.isPro
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

            // Also cache subscription status
            window.localStorage.setItem('sf.isPro', sanitized.isPro ? 'true' : 'false');

            // Cache updated
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
 * This is for DISPLAY ONLY - server writes are handled by worker
 * 
 * @param wordCount - Number of words to add to quota (from worker response)
 * 
 * @example
 * incrementQuotaLocal(50); // Add 50 words to local counter (UI only)
 */
export function incrementQuotaLocal(wordCount: number): void {
    if (wordCount <= 0) return;

    const nextWordsUsed = quota.wordsUsed + wordCount;

    emit({
        wordsUsed: nextWordsUsed,
        resetDate: quota.resetDate,
        limit: QUOTA_LIMIT,
        isPro: quota.isPro,
    });

    // Quota incremented locally
}

// ============================================================================
// PUBLIC: INITIALIZE MODULE
// ============================================================================

/**
 * Initialize quota cache module
 * - Loads quota from localStorage for instant UI
 * - Can be called multiple times safely (idempotent)
 */
export function initQuotaCache(): void {
    if (initialized) return;

    initialized = true;
    // Initialized
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
        isPro: false,
    };

    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(CACHE_KEY_WORDS_USED);
            window.localStorage.removeItem(CACHE_KEY_RESET_DATE);
            window.localStorage.removeItem(CACHE_KEY_LAST_SYNCED);
            window.localStorage.removeItem('sf.isPro');
            // Cache cleared
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
    isPro?: boolean;
}): void {
    // Updating from server

    emit({
        wordsUsed: serverQuota.wordsUsed,
        resetDate: serverQuota.resetDate,
        limit: QUOTA_LIMIT,
        isPro: serverQuota.isPro ?? quota.isPro, // Keep existing value if not provided
    });
}

/**
 * Check if user is a Pro subscriber
 */
export function isPro(): boolean {
    return quota.isPro;
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
        isPro: false,
    };

    initialized = false;

    listeners.clear();

    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(CACHE_KEY_WORDS_USED);
            window.localStorage.removeItem(CACHE_KEY_RESET_DATE);
            window.localStorage.removeItem(CACHE_KEY_LAST_SYNCED);
            window.localStorage.removeItem('sf.isPro');
        }
    } catch { }
}
