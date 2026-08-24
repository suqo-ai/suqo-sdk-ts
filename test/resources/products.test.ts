import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { ProductsResource } from "../../src/resources/products.js";

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
      "https://test.be.suqo.ai/api/v1/products/?page=2&page_size=50",
      expect.anything(),
    );
  });

  it("list() returns the parsed Page<Product> unchanged", async () => {
    const page = {
      count: 1,
      next: null,
      previous: null,
      results: [{ productId: "p1", name: "Widget" }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page));

    const result = await products().list();
    expect(result).toEqual(page);
  });

  it("autoPaging() yields every product across every page, following next until null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 3,
          next: "https://test.be.suqo.ai/api/v1/products/?page=2",
          previous: null,
          results: [{ productId: "p1" }, { productId: "p2" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ count: 3, next: null, previous: null, results: [{ productId: "p3" }] }),
      );

    const ids: string[] = [];
    for await (const product of products().autoPaging()) {
      ids.push((product as { productId: string }).productId);
    }

    expect(ids).toEqual(["p1", "p2", "p3"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("autoPaging() never calls fetch a second time for a single-page result", async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: null, previous: null, results: [{ productId: "p1" }] }));

    const ids: string[] = [];
    for await (const product of products().autoPaging()) {
      ids.push((product as { productId: string }).productId);
    }

    expect(ids).toEqual(["p1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
