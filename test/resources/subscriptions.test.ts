import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import {
  deserializeCreateSubscriptionResponse,
  deserializeSubscription,
  deserializeSubscriptionPage,
  SubscriptionsResource,
} from "../../src/resources/subscriptions.js";
import { SuqoConfigError, ValidationError } from "../../src/errors/SuqoError.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function subscriptions(): SubscriptionsResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new SubscriptionsResource(http);
}

const wireClientRead = {
  phone: "9800000000",
  full_name: "Jane Doe",
  email: "jane@example.com",
  address: "Kathmandu",
  billing: { business_name: "Doe Traders", email: "billing@example.com", address: "Lalitpur", pan_vat: "123456789" },
  shipping: null,
};

const wireSubscriptionProduct = {
  product_id: "prod_1",
  name: "Widget",
  plan_name: "Standard",
  pbp_id: "pbp_1",
  label: "Monthly",
  price: "500.00",
  currency: "NPR",
};

const wireSubscription = {
  subscription_id: "sub_1",
  status: "active",
  is_active: true,
  client: wireClientRead,
  product: wireSubscriptionProduct,
  current_period_start: "2026-01-01T00:00:00Z",
  current_period_end: "2026-02-01T00:00:00Z",
  next_billing_cycle: "2026-02-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

describe("deserializeSubscription", () => {
  it("maps every field, renaming client to customer via the serialization boundary", () => {
    const subscription = deserializeSubscription(wireSubscription);
    expect(subscription.subscriptionId).toBe("sub_1");
    expect(subscription.status).toBe("active");
    expect(subscription.customer.fullName).toBe("Jane Doe");
    expect(subscription.customer.billing).toEqual({
      businessName: "Doe Traders",
      email: "billing@example.com",
      address: "Lalitpur",
      panVat: "123456789",
    });
    expect(subscription.customer.shipping).toBeNull();
    expect(subscription.product).toEqual({
      productId: "prod_1",
      name: "Widget",
      planName: "Standard",
      pbpId: "pbp_1",
      label: "Monthly",
      price: "500.00",
      currency: "NPR",
    });
    expect(subscription).not.toHaveProperty("client");
  });

  it("a null product stays null rather than being passed to the product deserializer", () => {
    const subscription = deserializeSubscription({ ...wireSubscription, product: null });
    expect(subscription.product).toBeNull();
  });

  it("an entirely omitted product key degrades to null instead of crashing (found in review)", () => {
    const { product: _product, ...withoutProduct } = wireSubscription;
    const subscription = deserializeSubscription(withoutProduct);
    expect(subscription.product).toBeNull();
  });
});

describe("deserializeSubscriptionPage", () => {
  it("maps the four extra counts alongside the deserialized results", () => {
    const page = deserializeSubscriptionPage({
      count: 1,
      next: null,
      previous: null,
      total_subscriptions: 5,
      active_subscriptions: 3,
      due_subscriptions: 1,
      inactive_subscriptions: 1,
      results: [wireSubscription],
    });
    expect(page.totalSubscriptions).toBe(5);
    expect(page.activeSubscriptions).toBe(3);
    expect(page.dueSubscriptions).toBe(1);
    expect(page.inactiveSubscriptions).toBe(1);
    expect(page.results[0]?.subscriptionId).toBe("sub_1");
  });
});

describe("deserializeCreateSubscriptionResponse", () => {
  it("maps every field, status carried through as-is", () => {
    const response = deserializeCreateSubscriptionResponse({
      subscription_id: "sub_1",
      pbp_id: "pbp_1",
      status: "pending_checkout",
      checkout_url: "https://pay.example/sub_1",
      next_billing_cycle: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(response).toEqual({
      subscriptionId: "sub_1",
      pbpId: "pbp_1",
      status: "pending_checkout",
      checkoutUrl: "https://pay.example/sub_1",
      nextBillingCycle: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
});

describe("SubscriptionsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() hits GET /api/v1/subscriptions/ and deserializes the envelope with its extra counts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        total_subscriptions: 1,
        active_subscriptions: 1,
        due_subscriptions: 0,
        inactive_subscriptions: 0,
        results: [wireSubscription],
      }),
    );

    const page = await subscriptions().list({ page: 1, pageSize: 20 });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/?page=1&page_size=20",
      expect.anything(),
    );
    expect(page.activeSubscriptions).toBe(1);
    expect(page.results[0]?.customer.fullName).toBe("Jane Doe");
  });

  it("autoPaging() follows next across pages, fully deserialized", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://test-be.suqo.ai/api/v1/subscriptions/?page=2",
          previous: null,
          total_subscriptions: 2,
          active_subscriptions: 2,
          due_subscriptions: 0,
          inactive_subscriptions: 0,
          results: [wireSubscription],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: null,
          previous: null,
          total_subscriptions: 2,
          active_subscriptions: 2,
          due_subscriptions: 0,
          inactive_subscriptions: 0,
          results: [{ ...wireSubscription, subscription_id: "sub_2" }],
        }),
      );

    const ids: string[] = [];
    for await (const subscription of subscriptions().autoPaging()) {
      ids.push(subscription.subscriptionId);
    }
    expect(ids).toEqual(["sub_1", "sub_2"]);
  });

  it("create() sends pbp_id/return_url/client (customer, serialized) and deserializes the response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          subscription_id: "sub_1",
          pbp_id: "pbp_1",
          status: "pending_checkout",
          checkout_url: "https://pay.example/sub_1",
          next_billing_cycle: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        { status: 201 },
      ),
    );

    const response = await subscriptions().create({
      pbpId: "pbp_1",
      returnUrl: "https://example.com/return",
      customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      pbp_id: "pbp_1",
      return_url: "https://example.com/return",
      client: { phone: "9800000000", full_name: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
    });
    expect(response.checkoutUrl).toBe("https://pay.example/sub_1");
  });

  it("create() surfaces the duplicate-active-subscription 400 as ValidationError.message, not fieldErrors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "An active subscription already exists for this buyer, product, and billing period.",
        }),
        { status: 400 },
      ),
    );

    await expect(
      subscriptions().create({
        pbpId: "pbp_1",
        returnUrl: "https://example.com/return",
        customer: { phone: "9800000000", fullName: "Jane Doe", email: "jane@example.com", address: "Kathmandu" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cancel() posts to /{id}/cancel/ with no body and returns the message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: "Subscription will be cancelled at the end of the current billing period." }),
    );

    const result = await subscriptions().cancel("sub_1");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/sub_1/cancel/",
      expect.anything(),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.body).toBeUndefined();
    expect(result.message).toBe("Subscription will be cancelled at the end of the current billing period.");
  });

  it("cancel() URL-encodes an id containing reserved characters (found in review)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "Subscription cancelled." }));

    await subscriptions().cancel("sub?1#a/b");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/sub%3F1%23a%2Fb/cancel/",
      expect.anything(),
    );
  });

  it("updateBillingCycle() posts subscription_id/next_billing_cycle to the collection-level route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "Billing cycle updated." }));

    await subscriptions().updateBillingCycle({ subscriptionId: "sub_1", nextBillingCycle: "2026-03-01" });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/update-billing-cycle/",
      expect.anything(),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      subscription_id: "sub_1",
      next_billing_cycle: "2026-03-01",
    });
  });

  it("resume() posts to /{id}/resume/ with no body and returns the message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "Subscription resumed." }));

    const result = await subscriptions().resume("sub_1");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/sub_1/resume/",
      expect.anything(),
    );
    expect(result.message).toBe("Subscription resumed.");
  });

  it("resume() URL-encodes an id containing reserved characters (found in review)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: "Subscription resumed." }));

    await subscriptions().resume("sub?1#a/b");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/sub%3F1%23a%2Fb/resume/",
      expect.anything(),
    );
  });

  it("retrieve(id) GETs /api/v1/subscriptions/{id}/ and deserializes the Subscription", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireSubscription));

    const result = await subscriptions().retrieve("30b0af58-c8bc-4f79-9917-51208b73a0ed");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/subscriptions/30b0af58-c8bc-4f79-9917-51208b73a0ed/",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual(deserializeSubscription(wireSubscription));
  });

  it.each(["", ".", ".."])("retrieve(%j) throws SuqoConfigError before any request (would hit list()'s URL)", async (id) => {
    await expect(subscriptions().retrieve(id)).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renew(subscriptionId) POSTs { subscription_id } to the singular /api/v1/subscription/renew/ and returns the checkout link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { public_id: "cks_1", expires_at: "2026-10-05T10:38:16+05:45", checkout_url: "https://stage.suqo.ai/checkout/cks_1" },
        { status: 201 },
      ),
    );

    const result = await subscriptions().renew("30b0af58-c8bc-4f79-9917-51208b73a0ed");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://test-be.suqo.ai/api/v1/subscription/renew/");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ subscription_id: "30b0af58-c8bc-4f79-9917-51208b73a0ed" });
    expect(result).toEqual({
      publicId: "cks_1",
      expiresAt: "2026-10-05T10:38:16+05:45",
      checkoutUrl: "https://stage.suqo.ai/checkout/cks_1",
    });
  });

  it("renew() surfaces the API's bare-list 400 message (e.g. a cancelled subscription) and never retries", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(["This subscription was cancelled and cannot be renewed."], { status: 400 }),
    );

    const err = await subscriptions().renew("sub").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe("This subscription was cancelled and cannot be renewed.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cancel", (id: string) => subscriptions().cancel(id)],
    ["resume", (id: string) => subscriptions().resume(id)],
  ] as const)("%s() rejects an empty, \".\" or \"..\" id before any request (found in review: cancel('..') POSTed to /api/v1/cancel/)", async (_name, call) => {
    for (const id of ["", ".", ".."]) {
      await expect(call(id)).rejects.toBeInstanceOf(SuqoConfigError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancel() on a one-time purchase surfaces the bare-list 400 message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(["This is a one-time purchase, so there is nothing to cancel."], { status: 400 }),
    );

    await expect(subscriptions().cancel("sub")).rejects.toThrow("This is a one-time purchase, so there is nothing to cancel.");
  });
});
