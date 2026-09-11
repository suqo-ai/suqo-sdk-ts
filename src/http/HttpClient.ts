import { mapHttpError } from "../errors/mapHttpError.js";
import { NetworkError, SuqoError } from "../errors/SuqoError.js";
import type { SdkConfig } from "../config/index.js";
import { buildUrl, type QueryParams } from "./urlBuilder.js";
import { backoffDelayMs, isRetryableFailure, isRetryableMethod, parseRetryAfterMs } from "./retry.js";
import { combineSignals } from "./signals.js";

/** HTTP methods this client supports — every route in the API is one of these two (SDK-SPEC.md §1). */
export type HttpMethod = "GET" | "POST";

/** Fields shared by every request, regardless of method. */
interface HttpRequestOptionsBase {
  /** The route path, e.g. `/api/v1/products` — the trailing slash is guaranteed by `buildUrl`; don't add it yourself. */
  path: string;
  /** Query params, appended after the trailing slash. `undefined` values are skipped. */
  query?: QueryParams;
  /** Per-call timeout override, in milliseconds. Defaults to `SdkConfig.timeout`. */
  timeoutMs?: number;
  /**
   * Optional caller-supplied signal for cancelling an in-flight request — e.g. the host
   * application's own request lifecycle ending, or an overall operation deadline spanning
   * multiple SDK calls. Combined with the internal timeout signal (whichever fires first wins)
   * during the fetch itself, *and* observed during any retry backoff wait — cancelling mid-sleep
   * doesn't have to wait for the sleep to finish first. An explicit caller cancellation is never
   * retried, even for an otherwise-retryable read — retrying after the caller said "stop" would
   * ignore what they asked for.
   */
  signal?: AbortSignal;
}

/**
 * Options for a `GET` request. Never carries a body — every read in this API is `GET`
 * (SDK-SPEC.md §1), and `fetch` itself rejects a body on `GET`. Enforced at the type level, not
 * just by convention, so this can't be gotten wrong from a `TBody`-typed call site by accident.
 */
export interface HttpGetRequestOptions extends HttpRequestOptionsBase {
  method: "GET";
}

/**
 * Options for a `POST` request. Generic on `TBody` so a call site can pass a concrete request
 * type (e.g. `CreateSubscriptionParams`, wired up in Ticket 4 — the SDK-surface type for
 * `openapi.yaml`'s `CreateSubscriptionRequest` schema; SDK Naming Map v1.1 renames every
 * `*Request` wire schema to `*Params` on the surface, since "Request" reads as an HTTP request
 * object, not an SDK input) and have it checked at compile time — `unknown` is only the *default*
 * for callers that don't specify one, never a signal that bodies go untyped by design.
 */
export interface HttpPostRequestOptions<TBody = unknown> extends HttpRequestOptionsBase {
  method: "POST";
  /** JSON-serializable request body. Omit entirely for a bodyless write (e.g. `cancel`). */
  body?: TBody;
}

/**
 * Options accepted by {@link HttpClient.request}. `HttpClient` itself is internal (not exported
 * from `src/index.ts`); the SDK's actual typed, consumer-facing contract lives one layer up, in
 * each resource method's own public signature.
 */
export type HttpRequestOptions<TBody = unknown> = HttpGetRequestOptions | HttpPostRequestOptions<TBody>;

/** `RequestInit` extended with undici's non-standard `dispatcher` option (Node's built-in `fetch`, addendum §2). */
interface FetchInit extends RequestInit {
  dispatcher?: unknown;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * signal`, combined with the timeout during the fetch and also observed during any retry backoff
 * wait), the read-only retry policy (exponential backoff + jitter, honoring `Retry-After`,
 * clamped so a misconfigured server can't stall a request indefinitely), and feeding every
 * non-2xx response through `mapHttpError()` so callers only ever see a typed `SuqoError`
 * subclass — never a raw `fetch` rejection or an unparsed error body.
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
   * `request<CreateSubscriptionResponse, CreateSubscriptionParams>({ body, ... })` — so a
   * resource method (Ticket 4) gets its request body checked against the exact shape it means to
   * send, not just `unknown`.
   */
  async request<TResponse, TBody = unknown>(options: HttpRequestOptions<TBody>): Promise<TResponse> {
    // Defense-in-depth beneath the type-level guarantee (HttpGetRequestOptions has no `body`
    // field at all): a caller that bypasses TypeScript (a raw JS call, or an `as` cast) fails
    // loudly here instead of either crashing deep inside fetch (the original bug) or — worse —
    // silently dropping the body with no error at all, which would be even harder to debug.
    if (options.method === "GET" && (options as { body?: unknown }).body !== undefined) {
      throw new TypeError("HttpClient.request: a GET request cannot carry a body.");
    }

    // Both steps below wrapped in one try/catch, found in review: a malformed `path` (an
    // unparseable "next" link, say) or the off-host guard tripping are pre-flight, one-shot,
    // deterministic failures — they never touched `fetch`, so they must still surface as a typed
    // `NetworkError`, never a raw `TypeError`/`Error`, to hold the class's own documented contract
    // that a caller only ever sees a `SuqoError` subclass, and thrown directly (not fed through
    // the retry loop below) since retrying a malformed URL can never succeed.
    let url: string;
    try {
      url = buildUrl(this.#config.baseUrl, options.path, options.query);

      // Security guard: buildUrl accepts an already-complete absolute URL as `path` (needed so a
      // pagination `next` link, Ticket 3, can be followed as-is) — but this client attaches the
      // real API key to every request unconditionally. Without this check, a `next` link that
      // ever pointed off-host (a compromised proxy, a backend bug, tampering) would silently leak
      // the key to that host. `path` being relative always resolves to `baseUrl`'s own origin by
      // construction, so this only ever fires for an absolute `path` that's actually wrong.
      if (new URL(url).origin !== new URL(this.#config.baseUrl).origin) {
        throw new Error(
          `Refusing to send a request to ${new URL(url).origin} — it does not match the ` +
            `configured origin ${new URL(this.#config.baseUrl).origin}. This SDK never sends its ` +
            "API key to a different host.",
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new NetworkError(`Invalid request URL: ${message}`, { cause });
    }

    const retryable = isRetryableMethod(options.method);
    const maxAttempts = retryable ? this.#config.maxRetries + 1 : 1;
    const timeoutMs = options.timeoutMs ?? this.#config.timeout;

    for (let attempt = 1; ; attempt++) {
      const isLastAttempt = attempt >= maxAttempts;

      try {
        const response = await this.#doFetch(url, options, timeoutMs);

        if (response.ok) {
          return (await parseJsonBody(response)) as TResponse;
        }

        // Reading the body can fail too (e.g. the connection resets mid-stream after headers
        // already arrived fine) — that failure needs the exact same retry-or-network-error
        // treatment as `#doFetch` itself failing, not an unmapped rejection escaping `request()`.
        // Wrapping both in the same try/catch below (found in review) is what makes that happen.
        const body = await parseJsonBody(response);
        // Honored on any status, not just 429 (found in review) — a retried 5xx (isRetryableFailure
        // covers 500-599 too) can carry the same header, e.g. a 503 during a maintenance window, and
        // ignoring it there means retrying on our own backoff instead of the wait the server asked for.
        const retryAfter = parseRetryAfterMs(response.headers.get("Retry-After"));

        if (
          !isLastAttempt &&
          retryable &&
          isRetryableFailure({ networkError: false, status: response.status })
        ) {
          await this.#sleepOrAbort(retryAfter ?? backoffDelayMs(attempt - 1), options.signal, timeoutMs);
          continue;
        }

        throw mapHttpError({
          status: response.status,
          statusText: response.statusText,
          body,
          ...(retryAfter !== undefined ? { retryAfter } : {}),
        });
      } catch (cause) {
        // Already a correctly-classified SuqoError (from mapHttpError just above, or a caller
        // cancellation/timeout from #sleepOrAbort) — pass it through unchanged, don't reclassify
        // an already-final decision as a fresh network failure.
        if (cause instanceof SuqoError) throw cause;

        // An explicit caller cancellation is never retried, even for a normally-retryable read —
        // continuing after the caller said "stop" would ignore what they asked for.
        const callerCancelled = options.signal?.aborted === true;
        // Routed through isRetryableFailure (not inlined) so the retry policy for a network-level
        // failure lives in exactly one place — retry.ts — the same as the HTTP-status decision
        // below. Found in review: an earlier version inlined this as "always true" for
        // readability, which let this decision and retry.ts's own copy of it silently drift apart
        // if the policy ever changed in only one of the two places.
        if (!callerCancelled && !isLastAttempt && retryable && isRetryableFailure({ networkError: true })) {
          await this.#sleepOrAbort(backoffDelayMs(attempt - 1), options.signal, timeoutMs);
          continue;
        }
        throw toNetworkError(cause, timeoutMs, callerCancelled);
      }
    }
  }

  /**
   * Sleeps for `ms`, but rejects immediately with a "cancelled" `NetworkError` if `signal` aborts
   * *during* the wait — a caller cancelling mid-backoff doesn't have to wait for the sleep to
   * finish first (found in review: the previous version ignored `signal` here entirely).
   */
  async #sleepOrAbort(ms: number, signal: AbortSignal | undefined, timeoutMs: number): Promise<void> {
    if (!signal) {
      await this.#sleep(ms);
      return;
    }
    if (signal.aborted) {
      throw toNetworkError(signal.reason, timeoutMs, true);
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(toNetworkError(signal.reason, timeoutMs, true));
      signal.addEventListener("abort", onAbort, { once: true });
      // Clean up on BOTH branches, not just the fulfillment one (found in review) — an injected
      // `sleep` that rejects for a reason unrelated to cancellation would otherwise leave
      // `onAbort` attached to `signal` forever, since `{ once: true }` only self-removes when the
      // "abort" event actually fires.
      this.#sleep(ms).then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (sleepError: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(sleepError);
        },
      );
    });
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

    // `body` only exists on the POST branch of the HttpRequestOptions union — a GET can't carry
    // one even at the type level (found in review: a GET-with-body used to be constructible,
    // reach fetch, throw there, and get silently retried/masked as a generic NetworkError).
    const body = options.method === "POST" ? options.body : undefined;

    const { signal, cleanup } = combineSignals([AbortSignal.timeout(timeoutMs), options.signal]);
    try {
      const init: FetchInit = {
        method: options.method,
        headers,
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(this.#config.dispatcher !== undefined ? { dispatcher: this.#config.dispatcher } : {}),
      };

      return await fetch(url, init);
    } finally {
      // Without this, a long-lived caller-supplied signal shared across many calls/attempts
      // (e.g. paginating, each retried) accumulates one never-removed listener per attempt — a
      // real leak found in review, not hypothetical.
      cleanup();
    }
  }
}
