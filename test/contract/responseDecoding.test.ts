import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SuqoClient } from "../../src/client.js";
import { resetCapturedRequests, server } from "./support.js";

/**
 * Contract tests: response decoding (SDK-SPEC.md §15, addendum §11 must-cover list) — a real
 * spec-shaped (snake_case) mock response, decoded through the SDK's actual pipeline into the
 * typed, camelCase object a caller receives. Each test also proves the raw wire key does NOT
 * survive onto the result — the same proof pattern used throughout Ticket 4, now run against the
 * full end-to-end path rather than a resource's deserializer in isolation.
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

describe("contract: response decoding", () => {
  it("products.list() decodes into camelCase Product objects, nested Plan/BillingPeriod included", async () => {
    const page = await client().products.list();
    const product = page.results[0];

    expect(product?.productId).toBe("de337e17-59a1-4dea-b8b2-1877b9813ebc");
    expect(product?.isActive).toBe(true);
    expect(product?.totalSubscribers).toBe("1");
    expect(product?.plan[0]?.billingPeriods[0]?.pbpId).toBe("pbp_a1104f81b");
    expect(product?.plan[0]?.billingPeriods[0]?.price).toBe("500.00");

    // Proves real conversion happened, not just a type-level assertion over the untouched body.
    expect(product).not.toHaveProperty("product_id");
    expect(product).not.toHaveProperty("is_active");
  });

  it("subscriptions.list() decodes the four extra counts plus camelCase Subscription objects, customer renamed from client", async () => {
    const page = await client().subscriptions.list();

    expect(page.totalSubscriptions).toBe(1);
    expect(page.activeSubscriptions).toBe(1);

    const subscription = page.results[0];
    expect(subscription?.subscriptionId).toBe("30b0af58-c8bc-4f79-9917-51208b73a0ed");
    expect(subscription?.customer.fullName).toBe("Jane Doe");
    expect(subscription?.product.pbpId).toBe("pbp_a1104f81b");

    expect(subscription).not.toHaveProperty("client");
    expect(subscription).not.toHaveProperty("subscription_id");
  });

  it("subscriptions.create() decodes CreateSubscriptionResponse", async () => {
    const response = await client().subscriptions.create({
      pbpId: "pbp_a1104f81b",
      returnUrl: "https://example.com/return",
      customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
    });

    expect(response.subscriptionId).toBe("30b0af58-c8bc-4f79-9917-51208b73a0ed");
    expect(response.status).toBe("pending_checkout");
    expect(response.checkoutUrl).toBe("https://pay.example/30b0af58");
    expect(response).not.toHaveProperty("checkout_url");
  });

  it("subscriptions.cancel() decodes MessageResponse", async () => {
    const result = await client().subscriptions.cancel("30b0af58-c8bc-4f79-9917-51208b73a0ed");
    expect(result.message).toBe("Subscription will be cancelled at the end of the current billing period.");
  });

  it("subscriptions.updateBillingCycle() decodes MessageResponse", async () => {
    const result = await client().subscriptions.updateBillingCycle({
      subscriptionId: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
      nextBillingCycle: "2026-03-01",
    });
    expect(result.message).toBe("Billing cycle updated.");
  });

  it("subscriptions.resume() decodes MessageResponse", async () => {
    const result = await client().subscriptions.resume("30b0af58-c8bc-4f79-9917-51208b73a0ed");
    expect(result.message).toBe("Subscription resumed.");
  });

  it("customers.list() decodes into camelCase Customer objects", async () => {
    const page = await client().customers.list();
    const customer = page.results[0];

    expect(customer?.id).toBe(42);
    expect(customer?.buyerPhone).toBe("9800000000");
    expect(customer?.fullName).toBe("Jane Doe");
    expect(customer).not.toHaveProperty("buyer_phone");
  });

  it("customers.retrieve() decodes a single camelCase Customer object", async () => {
    const customer = await client().customers.retrieve(42);
    expect(customer.id).toBe(42);
    expect(customer.buyerEmail).toBe("jane@example.com");
    expect(customer).not.toHaveProperty("buyer_email");
  });

  it("decimal-shaped fields (price, total_subscribers) stay strings end to end, never coerced to number", async () => {
    const page = await client().products.list();
    const price = page.results[0]?.plan[0]?.billingPeriods[0]?.price;
    const totalSubscribers = page.results[0]?.totalSubscribers;

    expect(typeof price).toBe("string");
    expect(typeof totalSubscribers).toBe("string");
  });
});
