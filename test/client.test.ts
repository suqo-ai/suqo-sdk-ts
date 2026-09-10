import { describe, expect, it, vi } from "vitest";
import { SuqoClient } from "../src/client.js";
import { SuqoConfigError } from "../src/errors/SuqoError.js";
import { ProductsResource } from "../src/resources/products.js";
import { SubscriptionsResource } from "../src/resources/subscriptions.js";
import { CustomersResource } from "../src/resources/customers.js";
import { WebhooksResource } from "../src/resources/webhooks.js";

describe("SuqoClient", () => {
  it("resolves sandbox for a su_test_key_ key and never throws for a well-formed key", () => {
    const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
    expect(suqo.environment).toBe("sandbox");
    expect(suqo.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("resolves live for a su_key_ key", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect(suqo.environment).toBe("live");
    expect(suqo.baseUrl).toBe("https://be.suqo.ai");
  });

  it("throws SuqoConfigError before any request on a malformed key", () => {
    expect(() => new SuqoClient({ apiKey: "not_a_suqo_key" })).toThrow(SuqoConfigError);
  });

  it("throws SuqoConfigError when baseUrl override disagrees with the key prefix", () => {
    expect(
      () => new SuqoClient({ apiKey: "su_test_key_abc123", baseUrl: "https://be.suqo.ai" }),
    ).toThrow(SuqoConfigError);
  });

  it("accepts a matching baseUrl override", () => {
    const suqo = new SuqoClient({
      apiKey: "su_test_key_abc123",
      baseUrl: "https://test-be.suqo.ai",
    });
    expect(suqo.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("defaults timeout to 30_000 and maxRetries to 2", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect(suqo.timeout).toBe(30_000);
    expect(suqo.maxRetries).toBe(2);
  });

  it("honors explicit timeout and maxRetries", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123", timeout: 5000, maxRetries: 5 });
    expect(suqo.timeout).toBe(5000);
    expect(suqo.maxRetries).toBe(5);
  });

  it("attaches .products/.subscriptions/.customers (sharing one HttpClient) and .webhooks (independent, no HttpClient needed)", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect(suqo.products).toBeInstanceOf(ProductsResource);
    expect(suqo.subscriptions).toBeInstanceOf(SubscriptionsResource);
    expect(suqo.customers).toBeInstanceOf(CustomersResource);
    expect(suqo.webhooks).toBeInstanceOf(WebhooksResource);
  });

  it("a resource attached to the client actually makes requests through it (end-to-end wiring proof)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    try {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
      await suqo.products.list();
      expect(fetch).toHaveBeenCalledWith(
        "https://test-be.suqo.ai/api/v1/products/",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer su_test_key_abc123" }) }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("suqo.webhooks.verify() actually works when reached through the client (end-to-end wiring proof)", () => {
    const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
    // Deliberately using a bogus signature -- this isn't testing verify()'s own logic (that's
    // webhooks.test.ts), just that it's genuinely reachable and callable off the client.
    expect(suqo.webhooks.verify({ rawBody: "{}", signature: "sha256=bad", timestamp: "0", secret: "x" })).toBe(
      false,
    );
  });

  it("each SuqoClient instance gets its own resources, not shared across instances", () => {
    const a = new SuqoClient({ apiKey: "su_key_abc123" });
    const b = new SuqoClient({ apiKey: "su_key_def456" });
    expect(a.products).not.toBe(b.products);
  });

  it("the key never appears in JSON.stringify output", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    const serialized = JSON.stringify(suqo);
    expect(serialized).not.toContain("su_key_super_secret_value");
    expect(JSON.parse(serialized)).toMatchObject({ apiKey: "[redacted]" });
  });

  it("the key never appears in a plain util.inspect/console.log-style rendering", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");
    const withInspect = suqo as unknown as Record<symbol, (() => unknown) | undefined>;
    const inspected = withInspect[inspectSymbol]?.call(suqo);
    expect(JSON.stringify(inspected)).not.toContain("su_key_super_secret_value");
  });

  it("the key is not an enumerable own property of the client either", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    expect(Object.keys(suqo)).not.toContain("apiKey");
    for (const key in suqo) {
      expect(key).not.toBe("apiKey");
    }
  });
});
