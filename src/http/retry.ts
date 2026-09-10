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

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

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
 * Parses a `Retry-After` header value into milliseconds, clamped to `MAX_RETRY_AFTER_MS`. Accepts
 * both forms RFC 7231 §7.1.3 allows: the seconds-delta form (e.g. `"5"`) and the HTTP-date form
 * (e.g. `"Wed, 21 Oct 2026 07:28:00 GMT"`) — accepting only the former is a common bug (SDK Naming
 * Map v1.1), since real servers (and load balancers in front of them) send either. Returns
 * `undefined` if neither form parses, so the caller falls back to computed backoff instead of
 * guessing (SDK-SPEC.md §8: "Respect Retry-After when present").
 *
 * @param now - The current time in epoch ms, used to convert an HTTP-date into a delta.
 *   Overridable for tests; defaults to `Date.now()`.
 */
export function parseRetryAfterMs(headerValue: string | null, now: number = Date.now()): number | undefined {
  if (headerValue === null) return undefined;
  // `Number("")` (and whitespace-only strings) is `0` in JavaScript, not `NaN` — checked
  // explicitly so an empty-but-present header is treated as unparseable, not "retry after 0ms"
  // (found in review: this would otherwise hammer a server that just asked to slow down).
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return undefined;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  // Not the delta-seconds form — try the HTTP-date form. `Date.parse` returns `NaN` for anything
  // it can't parse, which also correctly rejects plain garbage strings rather than guessing.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  // A date already in the past means "retry now," not "unparseable" or a negative wait.
  const delta = Math.max(dateMs - now, 0);
  return Math.min(delta, MAX_RETRY_AFTER_MS);
}
