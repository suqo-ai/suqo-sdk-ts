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

function client(config: Partial<{ maxRetries: number; timeoutMs: number }> = {}): HttpClient {
  const sdkConfig = new SdkConfig({
    apiKey: "su_test_key_abc123",
    maxRetries: config.maxRetries ?? 2,
    timeoutMs: config.timeoutMs ?? 30_000,
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
      "https://test.be.suqo.ai/api/v1/products/",
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
      "https://test.be.suqo.ai/api/v1/subscriptions/?page=2&page_size=50",
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

  it("still maps to RateLimitError with retryAfterMs when 429 persists past maxRetries", async () => {
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
    expect((error as RateLimitError).retryAfterMs).toBe(2000);
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

    const sdkConfig = new SdkConfig({ apiKey: "su_key_abc123", maxRetries: 0, timeoutMs: 5 });
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

    const sdkConfig = new SdkConfig({ apiKey: "su_key_abc123", maxRetries: 0, timeoutMs: 30_000 });
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
});
