/**
 * The full `SuqoError` hierarchy (SDK-SPEC.md §7).
 *
 * Every error thrown by this SDK is an instance of `SuqoError` — but the base class itself is
 * never thrown directly; the SDK always throws one of the subclasses below.
 *
 * @packageDocumentation
 */

/** Options accepted by every {@link SuqoError} subclass constructor. */
export interface SuqoErrorOptions {
  /** HTTP status code this error was mapped from, if any (absent for `SuqoConfigError`/`NetworkError` — there was no response). */
  status?: number;
  /** The raw, parsed response body this error was mapped from, if any. */
  rawBody?: unknown;
  /**
   * The backend's request id for this call, if the response included one — ties a failure to a
   * specific server-side log line. Nice-to-have: SUQO backend confirmation on whether/how this is
   * exposed is still pending (docs/implementation-plan.md Ticket 0 item 3) — always optional,
   * never assumed present.
   */
  requestId?: string;
  /** The underlying cause (e.g. the original `fetch` rejection), for debugging — never surfaced to end users directly. */
  cause?: unknown;
}

/**
 * Base class for every error thrown by the SDK (SDK-SPEC.md §7). Never thrown directly — always
 * one of the subclasses below.
 *
 * @example
 * ```ts
 * try {
 *   await suqo.subscriptions.create({ ... });
 * } catch (err) {
 *   if (err instanceof SuqoError) {
 *     console.error(err.name, err.message, err.status);
 *   }
 * }
 * ```
 */
export class SuqoError extends Error {
  /** HTTP status code this error was mapped from, if any. */
  readonly status?: number;
  /** The raw, parsed response body this error was mapped from, if any. */
  readonly rawBody?: unknown;
  /** The backend's request id for this call, if one was returned. See {@link SuqoErrorOptions.requestId}. */
  readonly requestId?: string;

  constructor(message: string, options: SuqoErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    // rawBody's declared type is already `unknown`, so assigning it unconditionally is always
    // valid under exactOptionalPropertyTypes; status/requestId are narrower (string/number) so
    // they're only assigned when actually provided, never as an explicit `undefined`.
    this.rawBody = options.rawBody;
    if (options.status !== undefined) this.status = options.status;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    // Restore the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Construction-time configuration problems: a malformed API key, or an explicit `baseUrl`
 * override that disagrees with the key's prefix (SDK-SPEC.md §2, §7). Thrown before any request
 * is made — analogous to a syntax error in the integration, not an HTTP failure. Never carries
 * `status`/`rawBody`; there was no request to map one from.
 */
export class SuqoConfigError extends SuqoError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
  }
}

/** 401 — the API key is missing, malformed, or inactive (SDK-SPEC.md §7). */
export class AuthenticationError extends SuqoError {}

/** Options accepted by {@link KycRequiredError}. */
export interface KycRequiredErrorOptions extends SuqoErrorOptions {
  /** The KYC status code from the response body's `status_code` field (openapi.yaml `KycError`). */
  statusCode?: string;
}

/** 403 — the owning seller has not completed KYC verification (SDK-SPEC.md §7). */
export class KycRequiredError extends SuqoError {
  /** The KYC status code from the response body, if present. */
  readonly statusCode?: string;

  constructor(message: string, options: KycRequiredErrorOptions = {}) {
    super(message, options);
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
  }
}

/** Field-keyed validation messages, normalized to string arrays regardless of wire shape. */
export type FieldErrors = Record<string, string[]>;

/** Options accepted by {@link ValidationError}. */
export interface ValidationErrorOptions extends SuqoErrorOptions {
  /** Field-keyed validation messages. Empty if the 400 used the `detail` shape instead. */
  fieldErrors?: FieldErrors;
}

/**
 * 400 — request validation failed (SDK-SPEC.md §7). The API uses two different 400 body shapes;
 * {@link mapHttpError} normalizes both into this one class so consumers rely on `instanceof`,
 * never the wire shape:
 * - A field-keyed body (`{ field: ["msg"] }`) populates {@link fieldErrors}.
 * - A `detail`-shaped body (`{ detail: "msg" }`, e.g. the duplicate-active-subscription case)
 *   populates `message` instead, with `fieldErrors` left empty.
 */
export class ValidationError extends SuqoError {
  /** Field-keyed validation messages. Empty (not undefined) when the 400 used the `detail` shape. */
  readonly fieldErrors: FieldErrors;

  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, options);
    this.fieldErrors = options.fieldErrors ?? {};
  }
}

/** 404 — the resource doesn't exist, or doesn't belong to the authenticated seller (SDK-SPEC.md §7). */
export class NotFoundError extends SuqoError {}

/** Options accepted by {@link RateLimitError}. */
export interface RateLimitErrorOptions extends SuqoErrorOptions {
  /** Suggested backoff derived from a `Retry-After` header, in milliseconds, if present. */
  retryAfterMs?: number;
}

/**
 * 429 — rate limited (SDK-SPEC.md §7). **Reserved**: the API does not enforce rate limiting yet
 * and never emits 429 today; this class exists so the SDK is forward-ready the moment it does
 * (SDK-SPEC.md §10).
 */
export class RateLimitError extends SuqoError {
  /** Suggested backoff derived from a `Retry-After` header, in milliseconds, if present. */
  readonly retryAfterMs?: number;

  constructor(message: string, options: RateLimitErrorOptions = {}) {
    super(message, options);
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/** 5xx — the SUQO API failed unexpectedly (SDK-SPEC.md §7). */
export class ServerError extends SuqoError {}

/**
 * Transport failure or timeout — the request never got a response at all (SDK-SPEC.md §7). Covers
 * timeouts too; there is no separate timeout class. Thrown directly by `http.ts` (Ticket 2) when
 * `fetch` rejects or an `AbortSignal` fires — never produced by {@link mapHttpError}, since
 * there's no HTTP status to map in that case.
 */
export class NetworkError extends SuqoError {}
