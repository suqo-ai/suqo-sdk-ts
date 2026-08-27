import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import {
  deserializeBillingPeriod,
  deserializePlan,
  deserializeProduct,
  ProductsResource,
} from "../../src/resources/products.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function products(): ProductsResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new ProductsResource(http);
}

const wireBillingPeriod = {
  pbp_id: "pbp_1",
  interval_type: "month",
  interval_count: 1,
  label: "Monthly",
  price: "500.00",
  currency: "NPR",
  is_current: true,
  is_limited: false,
  is_archived: false,
  offers: [],
};

const wirePlan = {
  plan_id: "plan_1",
  plan_name: "Standard",
  description: "Standard plan",
  billing_periods: [wireBillingPeriod],
};

const wireProduct = {
  product_id: "prod_1",
  name: "Widget",
  description: "A widget",
  type: "physical",
  is_active: true,
  terms_and_conditions: "...",
  features_and_benefits: "...",
  vat: { is_vat_active: true, vat_type: "standard", vat_percentage: "13.00" },
  product_image: ["https://cdn.example/1.png"],
  plan: [wirePlan],
  total_subscribers: "42",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

describe("deserializeBillingPeriod", () => {
  it("maps every field from snake_case to camelCase, unchanged in value", () => {
    expect(deserializeBillingPeriod(wireBillingPeriod)).toEqual({
      pbpId: "pbp_1",
      intervalType: "month",
      intervalCount: 1,
      label: "Monthly",
      price: "500.00",
      currency: "NPR",
      isCurrent: true,
      isLimited: false,
      isArchived: false,
      offers: [],
    });
  });
});

describe("deserializePlan", () => {
  it("maps its own fields and recursively deserializes billingPeriods", () => {
    expect(deserializePlan(wirePlan)).toEqual({
      planId: "plan_1",
      planName: "Standard",
      description: "Standard plan",
      billingPeriods: [
        {
          pbpId: "pbp_1",
          intervalType: "month",
          intervalCount: 1,
          label: "Monthly",
          price: "500.00",
          currency: "NPR",
          isCurrent: true,
          isLimited: false,
          isArchived: false,
          offers: [],
        },
      ],
    });
  });
});

describe("deserializeProduct", () => {
  it("maps every field, including recursively deserializing plan and vat", () => {
    const product = deserializeProduct(wireProduct);
    expect(product.productId).toBe("prod_1");
    expect(product.isActive).toBe(true);
    expect(product.totalSubscribers).toBe("42");
    expect(product.vat).toEqual({ isVatActive: true, vatType: "standard", vatPercentage: "13.00" });
    expect(product.plan).toEqual([
      {
        planId: "plan_1",
        planName: "Standard",
        description: "Standard plan",
        billingPeriods: [
          {
            pbpId: "pbp_1",
            intervalType: "month",
            intervalCount: 1,
            label: "Monthly",
            price: "500.00",
            currency: "NPR",
            isCurrent: true,
            isLimited: false,
            isArchived: false,
            offers: [],
          },
        ],
      },
    ]);
  });

  it("a null vat stays null rather than being passed to the vat deserializer", () => {
    const product = deserializeProduct({ ...wireProduct, vat: null });
    expect(product.vat).toBeNull();
  });

  it("an entirely omitted vat key degrades to null instead of crashing (found in review)", () => {
    const { vat: _vat, ...withoutVat } = wireProduct;
    const product = deserializeProduct(withoutVat);
    expect(product.vat).toBeNull();
  });

  it("an entirely omitted plan key degrades to an empty array instead of crashing (found in review)", () => {
    const { plan: _plan, ...withoutPlan } = wireProduct;
    const product = deserializeProduct(withoutPlan);
    expect(product.plan).toEqual([]);
  });

  it("an entirely omitted billing_periods key degrades to an empty array instead of crashing (found in review)", () => {
    const { billing_periods: _billingPeriods, ...planWithoutBillingPeriods } = wirePlan;
    const plan = deserializePlan(planWithoutBillingPeriods);
    expect(plan.billingPeriods).toEqual([]);
  });
});

describe("ProductsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() hits GET /api/v1/products/ with the mapped page params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }));

    await products().list({ page: 2, pageSize: 50 });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/products/?page=2&page_size=50",
      expect.anything(),
    );
  });

  it("list() deserializes the wire (snake_case) response into camelCase Product objects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ count: 1, next: null, previous: null, results: [wireProduct] }),
    );

    const result = await products().list();
    expect(result.results[0]?.productId).toBe("prod_1");
    expect(result.results[0]?.plan[0]?.billingPeriods[0]?.pbpId).toBe("pbp_1");
    // The raw wire keys must NOT survive onto the returned object — proves this is a real
    // conversion, not just a type-level assertion over the untouched wire body.
    expect(result.results[0]).not.toHaveProperty("product_id");
  });

  it("autoPaging() yields every product across every page, following next until null, fully deserialized", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://test-be.suqo.ai/api/v1/products/?page=2",
          previous: null,
          results: [wireProduct],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: null,
          previous: null,
          results: [{ ...wireProduct, product_id: "prod_2" }],
        }),
      );

    const ids: string[] = [];
    for await (const product of products().autoPaging()) {
      ids.push(product.productId);
    }

    expect(ids).toEqual(["prod_1", "prod_2"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("autoPaging() never calls fetch a second time for a single-page result", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: null, previous: null, results: [wireProduct] }));

    const ids: string[] = [];
    for await (const product of products().autoPaging()) {
      ids.push(product.productId);
    }

    expect(ids).toEqual(["prod_1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
