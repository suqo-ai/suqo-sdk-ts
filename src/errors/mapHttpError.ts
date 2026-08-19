import {
  AuthenticationError,
  KycRequiredError,
  NotFoundError,
  RateLimitError,
  ServerError,
  SuqoError,
  ValidationError,
  type FieldErrors,
} from "./SuqoError.js";

/**
 * The shape {@link mapHttpError} needs from a completed HTTP response. Deliberately not a
 * `Response` itself — `http.ts` (Ticket 2) reads the status, parses the body, and extracts
 * headers itself, keeping this module free of any transport-layer dependency.
 */
export interface HttpErrorInput {
  /** The response's HTTP status code. */
  status: number;
  /** The response's HTTP status text, if available — used only for the generic fallback message. */
  statusText?: string;
  /**
   * The parsed response body, if the response had one and it parsed as JSON. Expected to be one
   * of `openapi.yaml`'s three error shapes (`FieldError`, `DetailError`, `KycError`) — the shape
   * is detected here, never assumed from the status code alone.
   */
  body?: unknown;
  /** The backend's request id for this call, if one was returned (nice-to-have — Ticket 0 item 3). */
  requestId?: string;
  /** Suggested backoff derived from a `Retry-After` header, in milliseconds. Only meaningful for 429s. */
  retryAfterMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True when `body` is the `DetailError` shape (`{ detail: "msg" }`) rather than field-keyed. */
function isDetailShaped(body: unknown): body is { detail: string } {
  return isRecord(body) && typeof body.detail === "string" && body.detail.length > 0;
}

/**
 * Normalizes a `FieldError` body (`{ field: "msg" | ["msg"] }`) into `Record<string, string[]>`.
 * A field's value that's neither a string nor a string array is skipped rather than guessed at —
 * this never fabricates a message it wasn't given.
 */
function fieldErrorsFrom(body: unknown): FieldErrors {
  if (!isRecord(body)) return {};
  const fieldErrors: FieldErrors = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value === "string") {
      fieldErrors[field] = [value];
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      fieldErrors[field] = value;
    }
  }
  return fieldErrors;
}

/** Best-effort extraction of a human-readable message from a `DetailError`/`KycError` body. */
function messageFrom(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.detail === "string" && body.detail.length > 0) return body.detail;
    if (typeof body.message === "string" && body.message.length > 0) return body.message;
  }
  return fallback;
}

/**
 * The single, centralized status-code-to-error-class mapper (SDK-SPEC.md §7). Every HTTP response
 * with a non-2xx status is mapped to the correct {@link SuqoError} subclass through this
 * function — no other place in the SDK is allowed to make that decision.
 *
 * Handles both documented 400 body shapes: a field-keyed body populates
 * `ValidationError.fieldErrors`; a `detail`-shaped body (e.g. the duplicate-active-subscription
 * case) populates `ValidationError.message` instead, with `fieldErrors` left empty.
 *
 * Does not handle `fetch` throwing or an `AbortSignal` firing — those have no HTTP status and are
 * constructed directly as `NetworkError` by `http.ts` (Ticket 2).
 *
 * @example
 * ```ts
 * const response = await fetch(url);
 * if (!response.ok) {
 *   throw mapHttpError({ status: response.status, body: await response.json().catch(() => undefined) });
 * }
 * ```
 */
export function mapHttpError(input: HttpErrorInput): SuqoError {
  const { status, statusText, body, requestId, retryAfterMs } = input;
  const fallbackMessage = `Request failed with status ${status}${statusText ? ` (${statusText})` : ""}`;
  // rawBody's declared type is `unknown`, so including it unconditionally is always valid under
  // exactOptionalPropertyTypes; requestId is narrower (string), so it's only spread in when
  // actually provided, never as an explicit `key: undefined`.
  const base = { status, rawBody: body, ...(requestId !== undefined ? { requestId } : {}) };

  switch (status) {
    case 401:
      return new AuthenticationError(messageFrom(body, fallbackMessage), base);
    case 403: {
      const statusCode = isRecord(body) && typeof body.status_code === "string" ? body.status_code : undefined;
      const message = messageFrom(body, "KYC verification needed to perform this action.");
      return new KycRequiredError(message, { ...base, ...(statusCode !== undefined ? { statusCode } : {}) });
    }
    case 400: {
      if (isDetailShaped(body)) {
        return new ValidationError(body.detail, base);
      }
      return new ValidationError("Validation failed.", { ...base, fieldErrors: fieldErrorsFrom(body) });
    }
    case 404:
      return new NotFoundError(messageFrom(body, "Not found."), base);
    case 429:
      return new RateLimitError(messageFrom(body, fallbackMessage), {
        ...base,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    default:
      // 5xx and any genuinely unmapped status both land here. SDK-SPEC.md §7 doesn't define a
      // class for out-of-contract codes, and the base SuqoError is never thrown directly — and
      // openapi.yaml's documented surface never returns anything outside
      // {400, 401, 403, 404, 429, 5xx} today, so this default is a safety net, not an expected path.
      return new ServerError(messageFrom(body, fallbackMessage), base);
  }
}
