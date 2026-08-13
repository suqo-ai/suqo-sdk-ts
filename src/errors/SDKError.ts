/**
 * The full `SDKError` hierarchy (RFC §8).
 *
 * Every error thrown by this SDK — whether from a failed HTTP call, a validation
 * failure, or invalid configuration — is an instance of {@link SDKError}, never a
 * raw `Error` and never a raw `fetch` rejection (RFC Best Practice #2).
 *
 * @packageDocumentation
 */

/** Options accepted by every {@link SDKError} subclass constructor. */
export interface SDKErrorOptions {
  /** HTTP status code this error was mapped from, if any. */
  status?: number;
  /** Backend request id, if the response included one — ties a failure to a specific server log line. */
  requestId?: string;
  /** The underlying cause (e.g. the original fetch rejection), for debugging — never surfaced to end users directly. */
  cause?: unknown;
}

/**
 * Base class for every error thrown by the SDK.
 *
 * @example
 * ```ts
 * try {
 *   await sdk.subscriptions.get("sub_123");
 * } catch (err) {
 *   if (err instanceof SDKError) {
 *     console.error(err.code, err.message, err.requestId);
 *   }
 * }
 * ```
 */
export class SDKError extends Error {
  /** Stable, machine-readable error code (RFC Best Practice #21). Never changes across SDK versions for a given failure kind. */
  readonly code: string;
  /** HTTP status code this error was mapped from, if any. */
  readonly status?: number;
  /** Backend request id, if the response included one. */
  readonly requestId?: string;

  constructor(message: string, code: string, options: SDKErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    // Restore prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A single field-level validation failure. */
export interface ValidationIssue {
  /** Dot-path to the offending field, e.g. `"billing.currency"`. */
  path: string;
  /** Human-readable description of what's wrong with this field. */
  message: string;
}

/** Options accepted by {@link ValidationError}. */
export interface ValidationErrorOptions extends SDKErrorOptions {
  /** The specific fields that failed validation (RFC §13 Best Practice: name the exact failing field). */
  issues?: ValidationIssue[];
}

/** 400/422 — request or config shape failed validation. Carries the exact failing field(s). */
export class ValidationError extends SDKError {
  /** The specific fields that failed validation, if known. */
  readonly issues: ValidationIssue[];

  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, "validation_error", options);
    this.issues = options.issues ?? [];
  }
}

/** 401 — invalid, missing, or expired credentials. */
export class AuthenticationError extends SDKError {
  constructor(message: string, options: SDKErrorOptions = {}) {
    super(message, "authentication_error", options);
  }
}

/** 403 — the caller is authenticated but lacks the required scope/permission. */
export class PermissionError extends SDKError {
  constructor(message: string, options: SDKErrorOptions = {}) {
    super(message, "permission_error", options);
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends SDKError {
  constructor(message: string, options: SDKErrorOptions = {}) {
    super(message, "not_found", options);
  }
}

/** Options accepted by {@link RateLimitError}. */
export interface RateLimitErrorOptions extends SDKErrorOptions {
  /** Milliseconds to wait before retrying, derived from the response's `Retry-After` header, if present. */
  retryAfterMs?: number;
}

/** 429 — too many requests. Carries the server's suggested backoff, if provided. */
export class RateLimitError extends SDKError {
  /** Milliseconds to wait before retrying, if the server provided a `Retry-After` header. */
  readonly retryAfterMs?: number;

  constructor(message: string, options: RateLimitErrorOptions = {}) {
    super(message, "rate_limited", options);
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/** 5xx — the backend failed to process an otherwise-valid request. */
export class ServerError extends SDKError {
  constructor(message: string, options: SDKErrorOptions = {}) {
    super(message, "server_error", options);
  }
}

/** `fetch` itself threw — DNS failure, TLS failure, offline, connection refused. Never has an HTTP status. */
export class NetworkError extends SDKError {
  constructor(message: string, options: Omit<SDKErrorOptions, "status"> = {}) {
    super(message, "network_error", options);
  }
}

/** Options accepted by {@link TimeoutError}. */
export interface TimeoutErrorOptions extends Omit<SDKErrorOptions, "status"> {
  /** The timeout that was exceeded, in milliseconds. */
  timeoutMs?: number;
}

/** The request's `AbortController` fired because the configured deadline elapsed. Never has an HTTP status. */
export class TimeoutError extends SDKError {
  /** The timeout that was exceeded, in milliseconds. */
  readonly timeoutMs?: number;

  constructor(message: string, options: TimeoutErrorOptions = {}) {
    super(message, "timeout_error", options);
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }
}
