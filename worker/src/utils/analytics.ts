/**
 * Analytics Engine Helper
 * 
 * Tracks timing metrics for critical operations using Cloudflare Analytics Engine.
 * 
 * Key metrics tracked:
 * - JWT/JWKS fetch timing (cold start performance)
 * - Database calls (increment_quota)
 * - Auth flow timing
 * - STT/LLM performance
 */

export type AnalyticsEvent = {
    // Event metadata
    event: string;           // Event type (e.g., 'jwt.verify', 'db.quota_increment')
    traceId?: string;        // Session trace ID for correlation
    userId?: string;         // User ID (if authenticated)

    // Timing metrics (all in milliseconds)
    durationMs?: number;     // How long the operation took
    ttfbMs?: number;         // Time to first byte (for network calls)

    // Status
    success: boolean;        // Did the operation succeed?
    error?: string;          // Error message (if failed)

    // Context
    provider?: string;       // Provider name (e.g., 'groq', 'baseten')
    model?: string;          // Model name (for LLM/STT)
    cached?: boolean;        // Was this result cached?
    coldStart?: boolean;     // Was this a cold start?

    // Additional metadata (specific to event type)
    [key: string]: any;
};

/**
 * Write event to Analytics Engine
 */
export function trackEvent(
    analytics: AnalyticsEngineDataset,
    event: AnalyticsEvent
): void {
    try {
        // Write to Analytics Engine
        // Indexes: https://developers.cloudflare.com/analytics/analytics-engine/
        analytics.writeDataPoint({
            // Indexed fields (for fast queries)
            indexes: [
                event.event,                                    // index1: event type
                event.userId || 'anonymous',                   // index2: user ID
                event.success ? 'success' : 'failure',         // index3: status
                event.provider || '',                          // index4: provider
            ],
            // Blob data (queryable but not indexed)
            blobs: [
                event.traceId || '',                           // blob1: trace ID
                event.error || '',                             // blob2: error message
                event.model || '',                             // blob3: model name
            ],
            // Numeric metrics (aggregatable)
            doubles: [
                event.durationMs || 0,                         // double1: duration
                event.ttfbMs || 0,                             // double2: TTFB
                event.cached ? 1 : 0,                          // double3: cache hit
                event.coldStart ? 1 : 0,                       // double4: cold start
            ],
        });
    } catch (error) {
        // Silent fail - analytics should never break the worker
        console.warn('[Analytics] Failed to write event:', error);
    }
}

/**
 * Track timing for an async operation
 */
export async function trackTiming<T>(
    analytics: AnalyticsEngineDataset,
    eventName: string,
    operation: () => Promise<T>,
    metadata?: Partial<AnalyticsEvent>
): Promise<T> {
    const startAt = Date.now();
    let success = true;
    let error: string | undefined;
    let result: T;

    try {
        result = await operation();
        return result;
    } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        throw err;
    } finally {
        const durationMs = Date.now() - startAt;

        trackEvent(analytics, {
            event: eventName,
            durationMs,
            success,
            error,
            ...metadata,
        });
    }
}
