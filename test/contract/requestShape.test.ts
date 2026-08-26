import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SuqoClient } from "../../src/client.js";
import { getCapturedRequests, getLastRequest, resetCapturedRequests, server } from "./support.js";

/**
 * Contract tests: outgoing request shape (SDK-SPEC.md §15, addendum §11 must-cover list) — every
 * request the SDK actually builds, asserted against a real mock server, not a stubbed `fetch`.
 * Covers every documented operation in `specs/openapi.yaml`, one at a time.
 */
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetCapturedRequests();
});
afterAll(() => server.close());

function client(): SuqoClient {
  return new SuqoClient({ apiKey: "su_test_key_abc123" });
}

describe("contract: outgoing request shape", () => {
  beforeEach(() => resetCapturedRequests());

  describe("trailing slash — every built URL, including with query params", () => {
    it("products.list() with no params", async () => {
      await client().products.list();
      expect(getLastRequest()?.url).toBe("https://test.be.suqo.ai/api/v1/products/");
    });

    it("products.list() with query params — slash lands before the ?, not after", async () => {
      await client().products.list({ page: 2, pageSize: 50 });
      expect(getLastRequest()?.url).toBe(
        "https://test.be.suqo.ai/api/v1/products/?page=2&page_size=50",
      );
    });

    it("subscriptions.list() with query params", async () => {
      await client().subscriptions.list({ page: 1, pageSize: 20 });
      expect(getLastRequest()?.url).toBe(
        "https://test.be.suqo.ai/api/v1/subscriptions/?page=1&page_size=20",
      );
    });

    it("subscriptions.create()", async () => {
      await client().subscriptions.create({
        pbpId: "pbp_a1104f81b",
        returnUrl: "https://example.com/return",
        customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
      });
      expect(getLastRequest()?.url).toBe("https://test.be.suqo.ai/api/v1/subscriptions/");
    });

    it("subscriptions.cancel(id) — path-templated route", async () => {
      await client().subscriptions.cancel("30b0af58-c8bc-4f79-9917-51208b73a0ed");
      expect(getLastRequest()?.url).toBe(
        "https://test.be.suqo.ai/api/v1/subscriptions/30b0af58-c8bc-4f79-9917-51208b73a0ed/cancel/",
      );
    });

    it("subscriptions.updateBillingCycle() — collection-level route", async () => {
      await client().subscriptions.updateBillingCycle({
        subscriptionId: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
        nextBillingCycle: "2026-03-01",
      });
      expect(getLastRequest()?.url).toBe(
        "https://test.be.suqo.ai/api/v1/subscriptions/update-billing-cycle/",
      );
    });

    it("subscriptions.resume(id)", async () => {
      await client().subscriptions.resume("30b0af58-c8bc-4f79-9917-51208b73a0ed");
      expect(getLastRequest()?.url).toBe(
        "https://test.be.suqo.ai/api/v1/subscriptions/30b0af58-c8bc-4f79-9917-51208b73a0ed/resume/",
      );
    });

    it("customers.list()", async () => {
      await client().customers.list();
      expect(getLastRequest()?.url).toBe("https://test.be.suqo.ai/api/v1/customers/");
    });

    it("customers.retrieve(id)", async () => {
      await client().customers.retrieve(42);
      expect(getLastRequest()?.url).toBe("https://test.be.suqo.ai/api/v1/customers/42/");
    });
  });

  describe("Bearer header — present on every request", () => {
    it("on a GET (products.list)", async () => {
      await client().products.list();
      expect(getLastRequest()?.headers["authorization"]).toBe("Bearer su_test_key_abc123");
    });

    it("on a POST (subscriptions.cancel)", async () => {
      await client().subscriptions.cancel("30b0af58-c8bc-4f79-9917-51208b73a0ed");
      expect(getLastRequest()?.headers["authorization"]).toBe("Bearer su_test_key_abc123");
    });
  });

  describe("Content-Type — every write, even one with no body", () => {
    it("subscriptions.create() (has a body)", async () => {
      await client().subscriptions.create({
        pbpId: "pbp_a1104f81b",
        returnUrl: "https://example.com/return",
        customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
      });
      expect(getLastRequest()?.headers["content-type"]).toBe("application/json");
    });

    it("subscriptions.cancel() (no body at all)", async () => {
      await client().subscriptions.cancel("30b0af58-c8bc-4f79-9917-51208b73a0ed");
      expect(getLastRequest()?.headers["content-type"]).toBe("application/json");
      expect(getLastRequest()?.body).toBeUndefined();
    });

    it("a GET never sends Content-Type", async () => {
      await client().products.list();
      expect(getLastRequest()?.headers["content-type"]).toBeUndefined();
    });
  });

  describe("request bodies are snake_case, matching openapi.yaml exactly", () => {
    it("subscriptions.create() — top-level fields and the customer->client rename", async () => {
      await client().subscriptions.create({
        pbpId: "pbp_a1104f81b",
        returnUrl: "https://example.com/return",
        customer: {
          phone: "9800000000",
          fullName: "Jane Doe",
          email: "jane@example.com",
          address: "Kathmandu",
          billing: { businessName: "Doe Traders", email: "billing@example.com", address: "Lalitpur", panVat: "123456789" },
        },
      });
      expect(getLastRequest()?.body).toEqual({
        pbp_id: "pbp_a1104f81b",
        return_url: "https://example.com/return",
        client: {
          phone: "9800000000",
          full_name: "Jane Doe",
          email: "jane@example.com",
          address: "Kathmandu",
          billing: {
            billing_business_name: "Doe Traders",
            billing_email: "billing@example.com",
            billing_address: "Lalitpur",
            billing_pan_vat: "123456789",
          },
        },
      });
    });

    it("subscriptions.updateBillingCycle()", async () => {
      await client().subscriptions.updateBillingCycle({
        subscriptionId: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
        nextBillingCycle: "2026-03-01",
      });
      expect(getLastRequest()?.body).toEqual({
        subscription_id: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
        next_billing_cycle: "2026-03-01",
      });
    });
  });

  it("a full walkthrough (product -> subscription -> cancel) captures every request in call order", async () => {
    const suqo = client();
    await suqo.products.list();
    await suqo.subscriptions.create({
      pbpId: "pbp_a1104f81b",
      returnUrl: "https://example.com/return",
      customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
    });
    await suqo.subscriptions.cancel("30b0af58-c8bc-4f79-9917-51208b73a0ed");

    const requests = getCapturedRequests();
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /api/v1/products/",
      "POST /api/v1/subscriptions/",
      "POST /api/v1/subscriptions/30b0af58-c8bc-4f79-9917-51208b73a0ed/cancel/",
    ]);
  });
});
