import {
  AuthenticationError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SDKError,
  ServerError,
  ValidationError,
  type ValidationIssue,
} from "./SDKError.js";

/**
 * The shape {@link mapHttpError} needs from a completed HTTP response. Deliberately not `Response`
 * itself — `http/` (Phase 1 - Part 2) reads the status, parses the body, and extracts headers
 * itself, keeping `errors/` free of any transport-layer dependency (RFC §3 folder ownership).
 */
export interface HttpErrorInput {
  /** The response's HTTP status code. */
  status: number;
  /** The response's HTTP status text, if available. */
  statusText?: string;
  /** The parsed response body, if the response had one and it parsed as JSON. */
  body?: unknown;
  /** The backend's request id for this call, if returned (e.g. an `X-Request-Id` header). */
  requestId?: string;
  /** Suggested backoff derived from a `Retry-After` header, in milliseconds. Only meaningful for 429s. */
  retryAfterMs?: number;
}

/** Best-effort extraction of a human-readable message from a parsed error body. */
function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** Best-effort extraction of field-level validation issues from a parsed error body. */
function issuesFrom(body: unknown): ValidationIssue[] | undefined {
  if (!body || typeof body !== "object" || !("issues" in body)) return undefined;
  const rawIssues = (body as { issues?: unknown }).issues;
  if (!Array.isArray(rawIssues)) return undefined;

  const issues: ValidationIssue[] = [];
  for (const rawIssue of rawIssues) {
    if (!rawIssue || typeof rawIssue !== "object") continue;
    const path = (rawIssue as { path?: unknown }).path;
    const message = (rawIssue as { message?: unknown }).message;
    if (typeof path === "string" && typeof message === "string") {
      issues.push({ path, message });
    }
  }
  return issues.length > 0 ? issues : undefined;
}

/**
 * The single, centralized status-code-to-error-class mapper (RFC §8). Every HTTP response with a
 * non-2xx status is mapped to the correct {@link SDKError} subclass through this function — no
 * other place in the SDK is allowed to make that decision (RFC §4 Single Responsibility).
 *
 * Does not handle `fetch` throwing or an `AbortController` firing — those have no HTTP status and
 * are constructed directly as {@link NetworkError} / {@link TimeoutError} by the caller (RFC §8).
 *
 * @example
 * ```ts
 * const response = await fetch(url);
 * if (!response.ok) {
 *   throw mapHttpError({ status: response.status, body: await response.json().catch(() => undefined) });
 * }
 * ```
 */
export function mapHttpError(input: HttpErrorInput): SDKError {
  const { status, statusText, body, requestId, retryAfterMs } = input;
  const fallbackMessage = `Request failed with status ${status}${statusText ? ` (${statusText})` : ""}`;
  const message = messageFrom(body, fallbackMessage);
  // Built conditionally, never with an explicit `key: undefined`, so this stays valid under the
  // project's `exactOptionalPropertyTypes` setting.
  const base = { status, ...(requestId !== undefined ? { requestId } : {}) };

  switch (status) {
    case 401:
      return new AuthenticationError(message, base);
    case 403:
      return new PermissionError(message, base);
    case 404:
      return new NotFoundError(message, base);
    case 400:
    case 422: {
      const issues = issuesFrom(body);
      return new ValidationError(message, { ...base, ...(issues !== undefined ? { issues } : {}) });
    }
    case 429:
      return new RateLimitError(message, {
        ...base,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    default:
      if (status >= 500 && status <= 599) {
        return new ServerError(message, base);
      }
      // Unmapped status (e.g. 402, 405, 409, 410) — still a typed SDKError, just without a
      // dedicated subclass. Carries the same `status`/`requestId` so callers can branch on it.
      return new SDKError(message, "http_error", base);
  }
}
