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
import { isRecord } from "../utils/index.js";

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
  retryAfter?: number;
}

/** True when `body` is the `DetailError` shape (`{ detail: "msg" }`) rather than field-keyed. */
function isDetailShaped(body: unknown): body is { detail: string } {
  return isRecord(body) && typeof body.detail === "string" && body.detail.length > 0;
}

/**
 * Normalizes a `FieldError` body into `Record<string, string[]>`, flattening nested objects into
 * dot-path keys (`customer.phone`) and renaming the wire's root `client` key to `customer` on the
 * way — SDK Naming Map v1.1 Open Question A, resolved (2026-08-24, confirmed live against
 * `POST /subscriptions/`): a validation failure on the customer payload nests errors under
 * `client` as a real object (`{"client": {"phone": ["This field is required."]}}`), not a flat
 * dotted key — so this needs path-aware rewriting, not a flat key swap, exactly as the map warned.
 *
 * Only the **root-level** `client` key is renamed (`pathPrefix === ""` below) — a field genuinely
 * named `client` nested somewhere else wouldn't be, though no such field exists in the documented
 * API surface today. A value that's neither a string, a string array, nor a nested object worth
 * recursing into is skipped rather than guessed at — this never fabricates a message it wasn't
 * given.
 *
 * The nested-object check explicitly excludes arrays (`!Array.isArray(value)`), even though
 * `isRecord` alone would let one through — `typeof anArray === "object"` in JavaScript. Without
 * that exclusion, a field value shaped as a list of objects (e.g.
 * `{"billing": [{"business_name": ["required"]}]}`) would get recursed into using the array's
 * numeric indices as path segments (`billing.0.business_name`) instead of being skipped, silently
 * contradicting the rule stated above (found in review, reproduced).
 */
function fieldErrorsFrom(body: unknown, pathPrefix = ""): FieldErrors {
  if (!isRecord(body)) return {};
  const fieldErrors: FieldErrors = {};
  for (const [rawKey, value] of Object.entries(body)) {
    const key = pathPrefix === "" && rawKey === "client" ? "customer" : rawKey;
    const path = pathPrefix === "" ? key : `${pathPrefix}.${key}`;

    if (typeof value === "string") {
      fieldErrors[path] = [value];
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      fieldErrors[path] = value;
    } else if (isRecord(value) && !Array.isArray(value)) {
      Object.assign(fieldErrors, fieldErrorsFrom(value, path));
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
 * case) populates `ValidationError.message` instead, with `fieldErrors` left empty. A field-keyed
 * body's `client` key (the wire name for the subscription customer payload) is renamed to
 * `customer` and flattened into dot-path keys (`customer.phone`) — SDK Naming Map v1.1 Open
 * Question A, resolved: yes, translate.
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
  const { status, statusText, body, requestId, retryAfter } = input;
  const fallbackMessage = `Request failed with status ${status}${statusText ? ` (${statusText})` : ""}`;
  // rawBody's declared type is `unknown`, so including it unconditionally is always valid under
  // exactOptionalPropertyTypes; requestId is narrower (string), so it's only spread in when
  // actually provided, never as an explicit `key: undefined`.
  const base = { status, rawBody: body, ...(requestId !== undefined ? { requestId } : {}) };

  switch (status) {
    case 401:
      return new AuthenticationError(messageFrom(body, fallbackMessage), base);
    case 403: {
      const kycStatus = isRecord(body) && typeof body.status_code === "string" ? body.status_code : undefined;
      const message = messageFrom(body, "KYC verification needed to perform this action.");
      return new KycRequiredError(message, { ...base, ...(kycStatus !== undefined ? { kycStatus } : {}) });
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
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      });
    default:
      // 5xx and any genuinely unmapped status both land here. SDK-SPEC.md §7 doesn't define a
      // class for out-of-contract codes, and the base SuqoError is never thrown directly — and
      // openapi.yaml's documented surface never returns anything outside
      // {400, 401, 403, 404, 429, 5xx} today, so this default is a safety net, not an expected path.
      return new ServerError(messageFrom(body, fallbackMessage), base);
  }
}
