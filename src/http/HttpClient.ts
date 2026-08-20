import { mapHttpError } from "../errors/mapHttpError.js";
import { NetworkError } from "../errors/SuqoError.js";
import type { SdkConfig } from "../config/index.js";
import { buildUrl, type QueryParams } from "./urlBuilder.js";
import { backoffDelayMs, isRetryableFailure, isRetryableMethod, parseRetryAfterMs } from "./retry.js";

/** HTTP methods this client supports — every route in the API is one of these two (SDK-SPEC.md §1). */
export type HttpMethod = "GET" | "POST";

/**
 * Options accepted by {@link HttpClient.request}. Generic on `TBody` so a call site can pass a
 * concrete request type (e.g. `CreateSubscriptionRequest` from `openapi.yaml`, wired up in
 * Ticket 4) and have it checked at compile time — `unknown` is only the *default* for callers
 * that don't specify one, never a signal that bodies go untyped by design. `HttpClient` itself is
 * internal (not exported from `src/index.ts`); the SDK's actual typed, consumer-facing contract
 * lives one layer up, in each resource method's own public signature.
 */
export interface HttpRequestOptions<TBody = unknown> {
  method: HttpMethod;
  /** The route path, e.g. `/api/v1/products` — the trailing slash is guaranteed by `buildUrl`; don't add it yourself. */
  path: string;
  /** Query params, appended after the trailing slash. `undefined` values are skipped. */
  query?: QueryParams;
  /** JSON-serializable request body, for writes. Omit entirely for a bodyless write (e.g. `cancel`). */
  body?: TBody;
  /** Per-call timeout override, in milliseconds. Defaults to `SdkConfig.timeoutMs`. */
  timeoutMs?: number;
  /**
   * Optional caller-supplied signal for cancelling an in-flight request — e.g. the host
   * application's own request lifecycle ending, or an overall operation deadline spanning
   * multiple SDK calls. Combined with the internal timeout signal; whichever fires first wins.
   * An explicit caller cancellation is never retried, even for an otherwise-retryable read —
   * retrying after the caller said "stop" would ignore what they asked for.
   */
  signal?: AbortSignal;
}

/** `RequestInit` extended with undici's non-standard `dispatcher` option (Node's built-in `fetch`, addendum §2). */
interface FetchInit extends RequestInit {
  dispatcher?: unknown;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Combines multiple signals into one that aborts as soon as any of them do. Hand-rolled rather
 * than the built-in `AbortSignal.any` (Node 18.17+/20.3+ only) so the SDK's stated Node 18+ floor
 * (addendum §1) holds without a caveat.
 */
function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Best-effort JSON parse of a response body. Never throws — an empty or non-JSON body just yields
 * `undefined`, matching `mapHttpError`'s own best-effort philosophy (Ticket 1).
 */
async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Wraps a `fetch` rejection (network failure, `AbortSignal.timeout` firing, or a caller
 * cancellation) as a `NetworkError` (SDK-SPEC.md §7 — covers timeouts too, no separate class).
 */
function toNetworkError(cause: unknown, timeoutMs: number, callerCancelled: boolean): NetworkError {
  if (callerCancelled) {
    return new NetworkError("Request cancelled", { cause });
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new NetworkError(`Request timed out after ${timeoutMs}ms`, { cause });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new NetworkError(`Network request failed: ${message}`, { cause });
}

/** Options accepted by {@link HttpClient}'s constructor. */
export interface HttpClientOptions {
  /**
   * Injectable sleep implementation, so tests can skip real backoff delays. @internal — not part
   * of the public contract; defaults to a real `setTimeout`-based wait in production.
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The fetch wrapper every resource calls through (SDK-SPEC.md §3, §4, §8; addendum §2, §10).
 *
 * Handles, in one place: the trailing-slash URL guarantee, the `Authorization`/`Content-Type`
 * headers, per-call timeout via `AbortSignal.timeout`, caller-supplied cancellation (`options.
 * signal`, combined with the timeout — whichever fires first wins), the read-only retry policy
 * (exponential backoff + jitter, honoring `Retry-After`), and feeding every non-2xx response
 * through `mapHttpError()` so callers only ever see a typed `SuqoError` subclass — never a raw
 * `fetch` rejection or an unparsed error body.
 *
 * Not wired into `SuqoClient`/any resource yet — that lands in Ticket 4.
 */
export class HttpClient {
  readonly #config: SdkConfig;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(config: SdkConfig, options: HttpClientOptions = {}) {
    this.#config = config;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Sends a request and returns the parsed 2xx body, or throws the `SuqoError` subclass
   * `mapHttpError` maps a non-2xx response to. Writes are never retried (SDK-SPEC.md §8, §12);
   * reads retry on network failure, `429`, or `5xx`, bounded by `SdkConfig.maxRetries`.
   *
   * Generic on both `TResponse` and `TBody` — e.g.
   * `request<CreateSubscriptionResponse, CreateSubscriptionRequest>({ body, ... })` — so a
   * resource method (Ticket 4) gets its request body checked against the exact shape it means to
   * send, not just `unknown`.
   */
  async request<TResponse, TBody = unknown>(options: HttpRequestOptions<TBody>): Promise<TResponse> {
    const url = buildUrl(this.#config.baseUrl, options.path, options.query);
    const retryable = isRetryableMethod(options.method);
    const maxAttempts = retryable ? this.#config.maxRetries + 1 : 1;
    const timeoutMs = options.timeoutMs ?? this.#config.timeoutMs;

    for (let attempt = 1; ; attempt++) {
      const isLastAttempt = attempt >= maxAttempts;
      let response: Response;

      try {
        response = await this.#doFetch(url, options, timeoutMs);
      } catch (cause) {
        // An explicit caller cancellation is never retried, even for a normally-retryable read —
        // continuing after the caller said "stop" would ignore what they asked for.
        const callerCancelled = options.signal?.aborted === true;
        if (
          !callerCancelled &&
          !isLastAttempt &&
          retryable &&
          isRetryableFailure({ networkError: true })
        ) {
          await this.#sleep(backoffDelayMs(attempt - 1));
          continue;
        }
        throw toNetworkError(cause, timeoutMs, callerCancelled);
      }

      if (response.ok) {
        return (await parseJsonBody(response)) as TResponse;
      }

      const body = await parseJsonBody(response);
      const retryAfterMs =
        response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : undefined;

      if (
        !isLastAttempt &&
        retryable &&
        isRetryableFailure({ networkError: false, status: response.status })
      ) {
        await this.#sleep(retryAfterMs ?? backoffDelayMs(attempt - 1));
        continue;
      }

      throw mapHttpError({
        status: response.status,
        statusText: response.statusText,
        body,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }
  }

  async #doFetch<TBody>(
    url: string,
    options: HttpRequestOptions<TBody>,
    timeoutMs: number,
  ): Promise<Response> {
    const isWrite = options.method !== "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#config.apiKey}`,
    };
    if (isWrite) {
      // SDK-SPEC.md §4: sent on every write, regardless of whether this particular write carries
      // a body (e.g. `cancel` has none).
      headers["Content-Type"] = "application/json";
    }

    const init: FetchInit = {
      method: options.method,
      headers,
      signal: combineSignals([AbortSignal.timeout(timeoutMs), options.signal]),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(this.#config.dispatcher !== undefined ? { dispatcher: this.#config.dispatcher } : {}),
    };

    return fetch(url, init);
  }
}
