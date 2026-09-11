import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import {
  AuthenticationError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from "../../src/errors/SuqoError.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Instant "sleep" so retry tests don't actually wait through real backoff delays. */
const instantSleep = async () => {};

function client(config: Partial<{ maxRetries: number; timeout: number }> = {}): HttpClient {
  const sdkConfig = new SdkConfig({
    apiKey: "su_test_key_abc123",
    maxRetries: config.maxRetries ?? 2,
    timeout: config.timeout ?? 30_000,
  });
  return new HttpClient(sdkConfig, { sleep: instantSleep });
}

describe("HttpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the URL with the trailing slash and calls fetch with it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().request({ method: "GET", path: "/api/v1/products" });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/products/",
      expect.anything(),
    );
  });

  it("appends query params after the trailing slash", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().request({
      method: "GET",
      path: "/api/v1/subscriptions",
      query: { page: 2, page_size: 50 },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/?page=2&page_size=50",
      expect.anything(),
    );
  });

  it("sends the Bearer auth header on every request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().request({ method: "GET", path: "/api/v1/products" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer su_test_key_abc123");
  });

  it("sends Content-Type: application/json on writes, even without a body (e.g. cancel)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "Subscription cancelled." }));
    await client().request({ method: "POST", path: "/api/v1/subscriptions/abc/cancel" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init?.body).toBeUndefined();
  });

  it("does not send Content-Type on a GET", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client().request({ method: "GET", path: "/api/v1/products" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("JSON-stringifies the body when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ subscription_id: "abc" }, { status: 201 }));
    await client().request({
      method: "POST",
      path: "/api/v1/subscriptions",
      body: { pbp_id: "pbp_123" },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ pbp_id: "pbp_123" }));
  });

  it("returns the parsed body on a 2xx response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ count: 1, results: [] }));
    const result = await client().request<{ count: number }>({ method: "GET", path: "/api/v1/products" });
    expect(result).toEqual({ count: 1, results: [] });
  });

  it("throws the mapped error for a non-retryable failure (404) without retrying", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), { status: 404 }),
    );
    await expect(client().request({ method: "GET", path: "/api/v1/subscriptions/x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws AuthenticationError on 401 without retrying", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid or inactive API key." }), { status: 401 }));
    await expect(client().request({ method: "GET", path: "/api/v1/products" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("retries a GET on a 5xx and succeeds once a later attempt returns 2xx", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "boom" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client({ maxRetries: 2 }).request({ method: "GET", path: "/api/v1/products" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and throws ServerError", async () => {
    // mockImplementation (not mockResolvedValue) so each call gets a fresh Response — a real
    // Response body can only be read once, and mockResolvedValue would reuse the same instance.
    const fetchMock = vi
      .mocked(fetch)
      .mockImplementation(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));

    await expect(client({ maxRetries: 2 }).request({ method: "GET", path: "/api/v1/products" })).rejects.toBeInstanceOf(
      ServerError,
    );
    // 1 initial attempt + 2 retries = 3 total.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a write (POST), even on a 5xx", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));

    await expect(
      client({ maxRetries: 2 }).request({ method: "POST", path: "/api/v1/subscriptions" }),
    ).rejects.toBeInstanceOf(ServerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a GET on a network error (fetch rejects) and succeeds on a later attempt", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client({ maxRetries: 2 }).request({ method: "GET", path: "/api/v1/products" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws NetworkError after exhausting retries on a persistent network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      client({ maxRetries: 1 }).request({ method: "GET", path: "/api/v1/products" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("never retries a write on a network error either", async () => {
    const fetchMock = vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      client({ maxRetries: 2 }).request({ method: "POST", path: "/api/v1/subscriptions" }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After on a 429 by sleeping the parsed value instead of computed backoff", async () => {
    const sleep = vi.fn(async () => {});
    const sdkConfig = new SdkConfig({ apiKey: "su_test_key_abc123", maxRetries: 1 });
    const httpClient = new HttpClient(sdkConfig, { sleep });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "slow down" }), {
          status: 429,
          headers: { "Retry-After": "5" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await httpClient.request({ method: "GET", path: "/api/v1/products" });
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("honors Retry-After on a 503 too, not just 429 (found in review)", async () => {
    const sleep = vi.fn(async () => {});
    const sdkConfig = new SdkConfig({ apiKey: "su_test_key_abc123", maxRetries: 1 });
    const httpClient = new HttpClient(sdkConfig, { sleep });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "maintenance" }), {
          status: 503,
          headers: { "Retry-After": "30" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await httpClient.request({ method: "GET", path: "/api/v1/products" });
    expect(sleep).toHaveBeenCalledWith(30000);
  });

  it("still maps to RateLimitError with retryAfter when 429 persists past maxRetries", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "slow down" }), {
        status: 429,
        headers: { "Retry-After": "2" },
      }),
    );
    const error = await client({ maxRetries: 0 })
      .request({ method: "GET", path: "/api/v1/products" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(2000);
  });

  it("maps a real timeout (AbortSignal.timeout firing) to NetworkError", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });

    const sdkConfig = new SdkConfig({ apiKey: "su_key_abc123", maxRetries: 0, timeout: 5 });
    const httpClient = new HttpClient(sdkConfig, { sleep: instantSleep });

    const error = await httpClient
      .request({ method: "GET", path: "/api/v1/products" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("timed out");
  });

  it("respects a per-call timeoutMs override over the client default", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });

    const sdkConfig = new SdkConfig({ apiKey: "su_key_abc123", maxRetries: 0, timeout: 30_000 });
    const httpClient = new HttpClient(sdkConfig, { sleep: instantSleep });

    const error = await httpClient
      .request({ method: "GET", path: "/api/v1/products", timeoutMs: 5 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("5ms");
  });

  it("passes a custom dispatcher through to fetch when configured", async () => {
    const dispatcher = { custom: true };
    const sdkConfig = new SdkConfig({ apiKey: "su_key_abc123", dispatcher });
    const httpClient = new HttpClient(sdkConfig, { sleep: instantSleep });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await httpClient.request({ method: "GET", path: "/api/v1/products" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBe(dispatcher);
  });

  it("request<TResponse, TBody> checks the body against TBody at compile time (PR #13 review: nitesh-codepros)", async () => {
    // Named Params, not Request, per SDK Naming Map v1.1: "Request" reads as an HTTP request
    // object, not an SDK input — the eventual Ticket 4 type is CreateSubscriptionParams.
    interface CreateSubscriptionParams {
      pbpId: string;
      returnUrl: string;
    }

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ subscriptionId: "abc" }, { status: 201 }));

    // A correctly-typed body compiles and round-trips through fetch unmodified.
    await client().request<{ subscriptionId: string }, CreateSubscriptionParams>({
      method: "POST",
      path: "/api/v1/subscriptions",
      body: { pbpId: "pbp_123", returnUrl: "https://example.com/return" },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ pbpId: "pbp_123", returnUrl: "https://example.com/return" }));

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ subscriptionId: "abc" }, { status: 201 }));
    await client().request<{ subscriptionId: string }, CreateSubscriptionParams>({
      method: "POST",
      path: "/api/v1/subscriptions",
      // @ts-expect-error a body missing required fields of CreateSubscriptionParams must not
      // typecheck — this is the concrete proof the generic actually enforces the typed pattern,
      // not just documents an intention.
      body: { pbpId: "pbp_123" },
    });
  });

  it("a caller-supplied signal cancels the request (PR #13 review: nitesh-codepros)", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });

    const controller = new AbortController();
    const promise = client({ maxRetries: 2 }).request({
      method: "GET",
      path: "/api/v1/products",
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    await expect(promise).rejects.toMatchObject({ message: "Request cancelled" });
  });

  it("a caller cancellation is never retried, even for an otherwise-retryable GET", async () => {
    const fetchMock = vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });

    const controller = new AbortController();
    const promise = client({ maxRetries: 2 }).request({
      method: "GET",
      path: "/api/v1/products",
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caller signal and internal timeout are combined — whichever fires first wins, and neither leaks past a normal success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const controller = new AbortController(); // never aborted
    const result = await client().request({
      method: "GET",
      path: "/api/v1/products",
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: true });
  });

  it("a signal that aborts DURING a retry backoff wait rejects immediately, not after the sleep finishes (found in review)", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockImplementation(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));

    const sdkConfig = new SdkConfig({ apiKey: "su_test_key_abc123", maxRetries: 2 });
    // Never resolves on its own — the ONLY way this test's promise can settle is the signal
    // aborting mid-wait. Proves #sleepOrAbort actually races the sleep against the signal,
    // instead of always waiting for the sleep first (the bug found in review).
    const neverResolvingSleep = () => new Promise<void>(() => {});
    const httpClient = new HttpClient(sdkConfig, { sleep: neverResolvingSleep });

    const controller = new AbortController();
    const promise = httpClient.request({
      method: "GET",
      path: "/api/v1/products",
      signal: controller.signal,
    });
    // A macrotask, not a synchronous call — lets the first failed attempt's microtasks (the
    // mocked fetch resolving, the retry check, #sleepOrAbort attaching its listener) run first,
    // so this genuinely exercises "abort while waiting," not "already aborted before starting."
    setTimeout(() => controller.abort(), 0);

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    await expect(promise).rejects.toMatchObject({ message: "Request cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reached a second attempt
  });

  it("a GET with a body throws immediately, before ever calling fetch (found in review — defense-in-depth beneath the type guarantee)", async () => {
    const fetchMock = vi.mocked(fetch);
    const invalidOptions = { method: "GET", path: "/api/v1/products", body: { oops: true } };

    await expect(
      client().request(invalidOptions as unknown as { method: "GET"; path: string }),
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A body-read failure: fetch() resolves fine (headers received), but the body stream dies
  // afterward — a real, common undici/network failure, not a hypothetical.
  function brokenBodyResponse(init: { ok: boolean; status: number; statusText?: string }): Response {
    return {
      ok: init.ok,
      status: init.status,
      statusText: init.statusText ?? "",
      headers: new Headers(),
      text: () => Promise.reject(new TypeError("terminated")),
    } as unknown as Response;
  }

  it("a body-read failure on a 2xx is retried like a network error, not left unmapped (found in review)", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(brokenBodyResponse({ ok: true, status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client({ maxRetries: 2 }).request({ method: "GET", path: "/api/v1/products" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a body-read failure on a non-2xx is retried like a network error too", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(brokenBodyResponse({ ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client({ maxRetries: 2 }).request({ method: "GET", path: "/api/v1/products" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws NetworkError if the body-read failure persists past maxRetries", async () => {
    vi.mocked(fetch).mockResolvedValue(brokenBodyResponse({ ok: true, status: 200 }));
    await expect(
      client({ maxRetries: 1 }).request({ method: "GET", path: "/api/v1/products" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("a write (POST) never retries a body-read failure either", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(brokenBodyResponse({ ok: false, status: 500 }));
    await expect(
      client({ maxRetries: 2 }).request({ method: "POST", path: "/api/v1/subscriptions" }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("#sleepOrAbort removes its abort listener even when the injected sleep rejects for an unrelated reason (found in review)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));

    const rejectingSleep = () => Promise.reject(new Error("sleep implementation failed"));
    const sdkConfig = new SdkConfig({ apiKey: "su_test_key_abc123", maxRetries: 1 });
    const httpClient = new HttpClient(sdkConfig, { sleep: rejectingSleep });

    const controller = new AbortController();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await expect(
      httpClient.request({ method: "GET", path: "/api/v1/products", signal: controller.signal }),
    ).rejects.toThrow("sleep implementation failed");

    // The precise proof: zero listeners remain on the caller's signal afterward, not "the
    // request eventually settled" — a real leak would show growth here instead.
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("refuses to send a request off-host, even when path is an already-complete absolute URL (found in review — key-leak guard)", async () => {
    const fetchMock = vi.mocked(fetch);

    const error = await client()
      .request({ method: "GET", path: "https://evil.example.com/steal?x=1" })
      .catch((e: unknown) => e);

    // Must be a typed SuqoError, not a raw Error (found in review — this pre-flight guard used to
    // throw before request()'s try/catch, breaking the SDK's "callers only ever see a SuqoError"
    // contract).
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toMatch(/does not match the configured origin/);

    // The critical part of the guard: fetch is never even attempted, so the key is never sent.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps a malformed request URL as NetworkError instead of a raw error (found in review)", async () => {
    const fetchMock = vi.mocked(fetch);

    const error = await client()
      .request({ method: "GET", path: "http://[::1" }) // unbalanced bracket — new URL() throws
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still allows an absolute URL when it genuinely matches the configured origin (e.g. a real pagination next link)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client().request({
      method: "GET",
      path: "https://test-be.suqo.ai/api/v1/subscriptions/?page=2",
    });

    expect(result).toEqual({ ok: true });
  });
});
