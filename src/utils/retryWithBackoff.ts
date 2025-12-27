/**
 * Retry a function with exponential backoff
 * Used for transient network failures (Cloudflare edge rejections, etc.)
 */

// Configuration constants
export const PRECONNECT_MAX_RETRIES = 3;
export const PRECONNECT_INITIAL_DELAY_MS = 500;
export const PRECONNECT_BACKOFF_MULTIPLIER = 2;

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  context: string;
}

/**
 * Retry an async function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @example
 * await retryWithBackoff(
 *   () => trans.preConnect(),
 *   { context: 'Pre-connect on startup' }
 * );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T | void> {
  const {
    maxRetries = PRECONNECT_MAX_RETRIES,
    initialDelayMs = PRECONNECT_INITIAL_DELAY_MS,
    backoffMultiplier = PRECONNECT_BACKOFF_MULTIPLIER,
    context,
  } = options;

  let retries = 0;

  while (retries < maxRetries) {
    try {
      const result = await fn();
      console.log(`[App] ${context} succeeded`);
      return result;
    } catch (err) {
      retries++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (retries < maxRetries) {
        const backoffMs =
          initialDelayMs * Math.pow(backoffMultiplier, retries - 1);
        console.warn(
          `[App] ${context} attempt ${retries} failed, retrying in ${backoffMs}ms:`,
          errorMsg,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } else {
        console.warn(
          `[App] ${context} failed after ${maxRetries} attempts, will retry on first dictation:`,
          errorMsg,
        );
      }
    }
  }
}
