import { describe, expect, it } from "vitest";
import { buildUrl } from "../../src/http/urlBuilder.js";

describe("buildUrl", () => {
  it("adds a trailing slash when the path is missing one", () => {
    expect(buildUrl("https://be.suqo.ai", "/api/v1/products")).toBe(
      "https://be.suqo.ai/api/v1/products/",
    );
  });

  it("doesn't double the trailing slash when the path already has one", () => {
    expect(buildUrl("https://be.suqo.ai", "/api/v1/products/")).toBe(
      "https://be.suqo.ai/api/v1/products/",
    );
  });

  it("appends query params after the trailing slash", () => {
    expect(
      buildUrl("https://be.suqo.ai", "/api/v1/subscriptions", { page: 2, page_size: 50 }),
    ).toBe("https://be.suqo.ai/api/v1/subscriptions/?page=2&page_size=50");
  });

  it("appends query params even when the path already had its trailing slash", () => {
    expect(buildUrl("https://be.suqo.ai", "/api/v1/subscriptions/", { page: 2 })).toBe(
      "https://be.suqo.ai/api/v1/subscriptions/?page=2",
    );
  });

  it("omits undefined query values entirely, without requiring the caller to pre-filter", () => {
    expect(
      buildUrl("https://be.suqo.ai", "/api/v1/products", { page: 1, page_size: undefined }),
    ).toBe("https://be.suqo.ai/api/v1/products/?page=1");
  });

  it("produces no query string at all when query is omitted", () => {
    expect(buildUrl("https://be.suqo.ai", "/api/v1/products")).not.toContain("?");
  });

  it("works for a nested write path (e.g. cancel) the same way", () => {
    expect(buildUrl("https://be.suqo.ai", "/api/v1/subscriptions/abc-123/cancel")).toBe(
      "https://be.suqo.ai/api/v1/subscriptions/abc-123/cancel/",
    );
  });

  it("works against the sandbox base URL too", () => {
    expect(buildUrl("https://test.be.suqo.ai", "/api/v1/products")).toBe(
      "https://test.be.suqo.ai/api/v1/products/",
    );
  });

  it("passes an already-complete absolute URL (e.g. a pagination next link) through untouched, without corrupting its trailing query param (found in review)", () => {
    const nextUrl = "https://test.be.suqo.ai/api/v1/subscriptions/?page=2&page_size=50";
    const result = buildUrl("https://test.be.suqo.ai", nextUrl);
    expect(result).toBe(nextUrl);
    expect(new URL(result).searchParams.get("page_size")).toBe("50");
  });

  it("baseUrl is ignored when path is already absolute — matches URL(path, base) semantics", () => {
    const nextUrl = "https://test.be.suqo.ai/api/v1/products/?page=3";
    // A deliberately different/wrong baseUrl to prove it has no effect once path is absolute.
    expect(buildUrl("https://be.suqo.ai", nextUrl)).toBe(nextUrl);
  });

  it("still adds the trailing slash to an absolute URL's path portion if it's missing one", () => {
    const result = buildUrl("https://test.be.suqo.ai", "https://test.be.suqo.ai/api/v1/products");
    expect(result).toBe("https://test.be.suqo.ai/api/v1/products/");
  });

  it("merges additional query params onto an absolute URL without clearing its existing ones", () => {
    const nextUrl = "https://test.be.suqo.ai/api/v1/products/?page=2";
    expect(buildUrl("https://test.be.suqo.ai", nextUrl, { page_size: 10 })).toBe(
      "https://test.be.suqo.ai/api/v1/products/?page=2&page_size=10",
    );
  });
});
