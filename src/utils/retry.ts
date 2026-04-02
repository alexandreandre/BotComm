export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry ? shouldRetry(error) : true;
      if (!retryable || attempt >= options.attempts) {
        break;
      }
      const delay = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
