/**
 * Retry policy: which failures are retryable, bounded attempts, exponential backoff with full
 * jitter (SDK-SPEC.md §8).
 *
 * @packageDocumentation
 */

/**
 * HTTP methods eligible for retry at all.
 *
 * **SINGLE SWITCH** (SDK-SPEC.md §8, §12): every read in this API is `GET` and every write is
 * `POST` — reads are naturally idempotent, writes are not, and the backend doesn't support
 * idempotency keys yet, so a retried write could double-act. Flip this the moment idempotency
 * keys ship and writes carry one; until then, only `GET` retries.
 */
const RETRYABLE_METHODS: ReadonlySet<string> = new Set(["GET"]);

/** True if `method` is allowed to retry at all — independent of whether a given failure qualifies. */
export function isRetryableMethod(method: string): boolean {
  return RETRYABLE_METHODS.has(method);
}

/** The failure shape {@link isRetryableFailure} decides on. */
export interface RetryableFailureInput {
  /** True if the request never got a response at all (fetch threw / timed out). */
  networkError: boolean;
  /** The HTTP status code, if a response was received. */
  status?: number;
}

/** True if a failure of this shape should be retried (SDK-SPEC.md §8): network failure, 429, or 5xx. */
export function isRetryableFailure(input: RetryableFailureInput): boolean {
  if (input.networkError) return true;
  if (input.status === undefined) return false;
  return input.status === 429 || (input.status >= 500 && input.status <= 599);
}

const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 5_000;

/**
 * "Full jitter" backoff (SDK-SPEC.md §8: exponential backoff + jitter, bounded attempts): a
 * random delay between 0 and an exponentially growing cap, itself bounded by `MAX_DELAY_MS` so a
 * late retry never waits unboundedly long.
 *
 * @param attempt - 0-indexed retry attempt number (0 = the first retry, after the initial try).
 */
export function backoffDelayMs(attempt: number): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * cap;
}

/**
 * Generous cap on a server-supplied `Retry-After`, distinct from `MAX_DELAY_MS` (computed
 * backoff's own cap). `Retry-After` is explicit server guidance, worth respecting well past a
 * guessed backoff's ceiling — but an unbounded value (misconfigured server, or a malicious one)
 * must not stall a request indefinitely (found in review: a `Retry-After: 86400` would otherwise
 * wait a full day with nothing bounding it).
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Parses a `Retry-After` header value into milliseconds, clamped to `MAX_RETRY_AFTER_MS`. Only
 * the seconds-delta form (e.g. `"5"`) is supported — the common case for rate-limit headers; the
 * HTTP-date form is out of scope for now. Returns `undefined` if unparseable, so the caller falls
 * back to computed backoff instead of guessing (SDK-SPEC.md §8: "Respect Retry-After when present").
 */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}
