import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { CustomersResource, deserializeCustomer } from "../../src/resources/customers.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function customers(): CustomersResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new CustomersResource(http);
}

const wireCustomer = {
  id: 42,
  buyer_phone: "9800000000",
  buyer_email: "jane@example.com",
  full_name: "Jane Doe",
  created_at: "2026-01-01T00:00:00Z",
};

describe("deserializeCustomer", () => {
  it("maps every field from snake_case to camelCase, id kept as a number", () => {
    expect(deserializeCustomer(wireCustomer)).toEqual({
      id: 42,
      buyerPhone: "9800000000",
      buyerEmail: "jane@example.com",
      fullName: "Jane Doe",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("preserves null for buyerPhone/buyerEmail/fullName rather than coercing to undefined or empty string", () => {
    const customer = deserializeCustomer({
      id: 1,
      buyer_phone: null,
      buyer_email: null,
      full_name: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(customer.buyerPhone).toBeNull();
    expect(customer.buyerEmail).toBeNull();
    expect(customer.fullName).toBeNull();
  });
});

describe("CustomersResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() hits GET /api/v1/customers/ with the mapped page params", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }));

    await customers().list({ page: 2, pageSize: 50 });

    expect(fetch).toHaveBeenCalledWith(
      "https://test.be.suqo.ai/api/v1/customers/?page=2&page_size=50",
      expect.anything(),
    );
  });

  it("list() deserializes the wire (snake_case) response into camelCase Customer objects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ count: 1, next: null, previous: null, results: [wireCustomer] }),
    );

    const result = await customers().list();
    expect(result.results[0]?.buyerPhone).toBe("9800000000");
    // Proves this is a real conversion, not a type-level assertion over the untouched wire body.
    expect(result.results[0]).not.toHaveProperty("buyer_phone");
  });

  it("autoPaging() yields every customer across every page, following next until null, fully deserialized", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://test.be.suqo.ai/api/v1/customers/?page=2",
          previous: null,
          results: [wireCustomer],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ count: 2, next: null, previous: null, results: [{ ...wireCustomer, id: 43 }] }),
      );

    const ids: number[] = [];
    for await (const customer of customers().autoPaging()) {
      ids.push(customer.id);
    }

    expect(ids).toEqual([42, 43]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retrieve(id) hits GET /api/v1/customers/{id}/ and deserializes the response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireCustomer));

    const result = await customers().retrieve(42);

    expect(fetch).toHaveBeenCalledWith("https://test.be.suqo.ai/api/v1/customers/42/", expect.anything());
    expect(result).toEqual({
      id: 42,
      buyerPhone: "9800000000",
      buyerEmail: "jane@example.com",
      fullName: "Jane Doe",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
});
