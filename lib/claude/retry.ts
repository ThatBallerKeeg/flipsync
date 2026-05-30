import Anthropic from '@anthropic-ai/sdk'

/**
 * Wraps a Claude API call with automatic rate-limit retry.
 * On HTTP 429, reads the `retry-after` header and waits that many seconds
 * before retrying. Falls back to exponential backoff if the header is absent.
 * Retries up to `maxRetries` times (default 12 ≈ ~10 min total wait budget).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label = 'claude',
  maxRetries = 12,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Anthropic.RateLimitError ||
        (err instanceof Anthropic.APIError && err.status === 429)

      if (isRateLimit && attempt < maxRetries) {
        // Try to honour the retry-after header first
        let waitSec = Math.min(60, 5 * Math.pow(2, attempt)) // default backoff
        try {
          const headers = (err as { headers?: { get?: (k: string) => string | null } }).headers
          const ra = headers?.get?.('retry-after')
          if (ra) waitSec = Math.max(1, parseInt(ra, 10))
        } catch { /* ignore */ }

        console.log(`[${label}] Rate limited — waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise((r) => setTimeout(r, waitSec * 1000))
        continue
      }

      throw err
    }
  }
  throw new Error(`[${label}] Max retries (${maxRetries}) exceeded`)
}
