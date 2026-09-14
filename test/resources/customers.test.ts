import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { CustomersResource, deserializeCustomer } from "../../src/resources/customers.js";
import { SuqoConfigError } from "../../src/errors/SuqoError.js";

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

// id is an opaque prefixed string (e.g. "cus_1ce18d624"), not an integer — bug #42, found in
// review against the live sandbox. address is also real, previously silently dropped.
const wireCustomer = {
  id: "cus_1ce18d624",
  buyer_phone: "9800000000",
  buyer_email: "jane@example.com",
  full_name: "Jane Doe",
  address: "Shankhamul, Kathmandu 44600, Nepal",
  created_at: "2026-01-01T00:00:00Z",
};

describe("deserializeCustomer", () => {
  it("maps every field from snake_case to camelCase, id kept as a string (bug #42)", () => {
    expect(deserializeCustomer(wireCustomer)).toEqual({
      id: "cus_1ce18d624",
      buyerPhone: "9800000000",
      buyerEmail: "jane@example.com",
      fullName: "Jane Doe",
      address: "Shankhamul, Kathmandu 44600, Nepal",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("preserves null for buyerPhone/buyerEmail/fullName/address rather than coercing to undefined or empty string", () => {
    const customer = deserializeCustomer({
      id: "cus_1ce18d624",
      buyer_phone: null,
      buyer_email: null,
      full_name: null,
      address: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(customer.buyerPhone).toBeNull();
    expect(customer.buyerEmail).toBeNull();
    expect(customer.fullName).toBeNull();
    expect(customer.address).toBeNull();
  });

  it("an entirely omitted address key degrades to null instead of undefined (found in review)", () => {
    const { address: _address, ...withoutAddress } = wireCustomer;
    const customer = deserializeCustomer(withoutAddress);
    expect(customer.address).toBeNull();
  });

  it("an entirely omitted buyer_phone key degrades to null instead of undefined (found in review, closing the class address's fix opened)", () => {
    const { buyer_phone: _phone, ...withoutPhone } = wireCustomer;
    expect(deserializeCustomer(withoutPhone).buyerPhone).toBeNull();
  });

  it("an entirely omitted buyer_email key degrades to null instead of undefined (found in review, closing the class address's fix opened)", () => {
    const { buyer_email: _email, ...withoutEmail } = wireCustomer;
    expect(deserializeCustomer(withoutEmail).buyerEmail).toBeNull();
  });

  it("an entirely omitted full_name key degrades to null instead of undefined (found in review, closing the class address's fix opened)", () => {
    const { full_name: _fullName, ...withoutFullName } = wireCustomer;
    expect(deserializeCustomer(withoutFullName).fullName).toBeNull();
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
      "https://test-be.suqo.ai/api/v1/customers/?page=2&page_size=50",
      expect.anything(),
    );
  });

  it("list() deserializes the wire (snake_case) response into camelCase Customer objects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ count: 1, next: null, previous: null, results: [wireCustomer] }),
    );

    const result = await customers().list();
    expect(result.results[0]?.buyerPhone).toBe("9800000000");
    expect(result.results[0]?.id).toBe("cus_1ce18d624");
    // Proves this is a real conversion, not a type-level assertion over the untouched wire body.
    expect(result.results[0]).not.toHaveProperty("buyer_phone");
  });

  it("autoPaging() yields every customer across every page, following next until null, fully deserialized", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://test-be.suqo.ai/api/v1/customers/?page=2",
          previous: null,
          results: [wireCustomer],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ count: 2, next: null, previous: null, results: [{ ...wireCustomer, id: "cus_2af90b103" }] }),
      );

    const ids: string[] = [];
    for await (const customer of customers().autoPaging()) {
      ids.push(customer.id);
    }

    expect(ids).toEqual(["cus_1ce18d624", "cus_2af90b103"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retrieve(id) hits GET /api/v1/customers/{id}/ and deserializes the response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireCustomer));

    const result = await customers().retrieve("cus_1ce18d624");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/customers/cus_1ce18d624/",
      expect.anything(),
    );
    expect(result).toEqual({
      id: "cus_1ce18d624",
      buyerPhone: "9800000000",
      buyerEmail: "jane@example.com",
      fullName: "Jane Doe",
      address: "Shankhamul, Kathmandu 44600, Nepal",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("retrieve() URL-encodes an id containing reserved characters (same risk as subscriptions.cancel/resume, now that id is a real string)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...wireCustomer, id: "cus?1#a/b" }));

    await customers().retrieve("cus?1#a/b");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/customers/cus%3F1%23a%2Fb/",
      expect.anything(),
    );
  });

  it("retrieve('') throws SuqoConfigError instead of silently colliding with list()'s endpoint (found in review)", async () => {
    // Regression test: encodeURIComponent("") is "", so an unguarded retrieve("") would build
    // exactly list()'s own URL and get back a 200 pagination envelope that deserializeCustomer
    // would silently turn into a Customer of all-undefined fields, with no error at all.
    await expect(customers().retrieve("")).rejects.toBeInstanceOf(SuqoConfigError);
    await expect(customers().retrieve("")).rejects.toThrow(/non-empty id/);

    // The critical part: no request is ever attempted, so there's no chance of it silently
    // succeeding against the wrong endpoint.
    expect(fetch).not.toHaveBeenCalled();
  });
});
