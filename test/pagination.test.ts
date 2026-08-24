import { describe, expect, it, vi } from "vitest";
import {
  bridgeAutoPaging,
  deserializePage,
  listAll,
  toPageQuery,
  type Page,
  type SubscriptionPage,
} from "../src/pagination.js";

function envelope<T>(results: T[], next: string | null): Page<T> {
  return { count: results.length, next, previous: null, results };
}

describe("toPageQuery", () => {
  it("maps camelCase pageSize to snake_case page_size", () => {
    expect(toPageQuery({ page: 2, pageSize: 50 })).toEqual({ page: 2, page_size: 50 });
  });

  it("omits both when called with no params — buildUrl (Ticket 2) skips the undefined values", () => {
    expect(toPageQuery()).toEqual({ page: undefined, page_size: undefined });
  });

  it("passes a partial params object through without requiring the caller to pre-filter", () => {
    expect(toPageQuery({ page: 3 })).toEqual({ page: 3, page_size: undefined });
  });
});

describe("listAll", () => {
  it("yields every item on a single page and never calls fetchNext when next is null", async () => {
    const firstPage = envelope([1, 2, 3], null);
    const fetchNext = vi.fn();

    const items: number[] = [];
    for await (const item of listAll(firstPage, fetchNext)) {
      items.push(item);
    }

    expect(items).toEqual([1, 2, 3]);
    expect(fetchNext).not.toHaveBeenCalled();
  });

  it("follows next across a multi-page mock sequence and stops correctly at next: null", async () => {
    const firstPage = envelope([1, 2], "https://api.example/?page=2");
    const fetchNext = vi
      .fn()
      .mockResolvedValueOnce(envelope([3, 4], "https://api.example/?page=3"))
      .mockResolvedValueOnce(envelope([5], null));

    const items: number[] = [];
    for await (const item of listAll(firstPage, fetchNext)) {
      items.push(item);
    }

    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fetchNext).toHaveBeenCalledTimes(2);
    expect(fetchNext).toHaveBeenNthCalledWith(1, "https://api.example/?page=2");
    expect(fetchNext).toHaveBeenNthCalledWith(2, "https://api.example/?page=3");
  });

  it("yields nothing for an empty page and stops without calling fetchNext", async () => {
    const firstPage = envelope<number>([], null);
    const fetchNext = vi.fn();

    const items: number[] = [];
    for await (const item of listAll(firstPage, fetchNext)) {
      items.push(item);
    }

    expect(items).toEqual([]);
    expect(fetchNext).not.toHaveBeenCalled();
  });

  it("throws instead of hanging forever if fetchNext never reaches next: null (found in review)", async () => {
    // A stuck loop: every page claims there's a next one, so without the maxPages guard this
    // would iterate forever. maxPages is overridden small so the test itself stays fast.
    const firstPage = envelope([1], "https://api.example/?page=2");
    const fetchNext = vi.fn(async () => envelope([2], "https://api.example/?page=2"));

    await expect(async () => {
      const items: number[] = [];
      for await (const item of listAll(firstPage, fetchNext, 5)) {
        items.push(item);
      }
    }).rejects.toThrow(/exceeded 5 pages/);
  });

  it("a legitimate multi-page sequence well under maxPages completes normally, no false positive", async () => {
    const firstPage = envelope([1], "https://api.example/?page=2");
    const fetchNext = vi.fn().mockResolvedValueOnce(envelope([2], null));

    const items: number[] = [];
    for await (const item of listAll(firstPage, fetchNext, 5)) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
  });
});

describe("bridgeAutoPaging", () => {
  it("awaits the first-page promise, then delegates to listAll unchanged", async () => {
    const firstPage = Promise.resolve(envelope([1, 2], "https://api.example/?page=2"));
    const fetchNext = vi.fn().mockResolvedValueOnce(envelope([3], null));

    const items: number[] = [];
    for await (const item of bridgeAutoPaging(firstPage, fetchNext)) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });

  it("returns an iterator immediately without starting work — nothing runs before the caller iterates", async () => {
    // Proof, not assumption: the first-page promise is intentionally never awaited by the test
    // before iterating. If bridgeAutoPaging() itself kicked off work eagerly instead of only when
    // iteration starts, `resolved` would already be true here.
    let resolved = false;
    const firstPage = Promise.resolve(envelope([1], null)).then((page) => {
      resolved = true;
      return page;
    });

    const iterator = bridgeAutoPaging(firstPage, vi.fn());
    expect(resolved).toBe(false);

    const items: number[] = [];
    for await (const item of iterator) items.push(item);
    expect(items).toEqual([1]);
    expect(resolved).toBe(true);
  });

  it("propagates maxPages through to the underlying listAll", async () => {
    const firstPage = Promise.resolve(envelope([1], "https://api.example/?page=2"));
    const fetchNext = vi.fn(async () => envelope([2], "https://api.example/?page=2"));

    await expect(async () => {
      const items: number[] = [];
      for await (const item of bridgeAutoPaging(firstPage, fetchNext, 3)) items.push(item);
    }).rejects.toThrow(/exceeded 3 pages/);
  });
});

describe("deserializePage", () => {
  it("maps each result item through deserializeItem, leaving count/next/previous untouched", () => {
    const wire = envelope([{ product_id: "p1" }, { product_id: "p2" }], "https://api.example/?page=2");
    const page = deserializePage(wire, (item) => ({ productId: item.product_id }));

    expect(page).toEqual({
      count: 2,
      next: "https://api.example/?page=2",
      previous: null,
      results: [{ productId: "p1" }, { productId: "p2" }],
    });
  });

  it("an empty results array maps to an empty array, not an error", () => {
    const wire = envelope<{ product_id: string }>([], null);
    const page = deserializePage(wire, (item) => ({ productId: item.product_id }));
    expect(page.results).toEqual([]);
  });
});

describe("Page / SubscriptionPage shape", () => {
  it("a plain envelope (e.g. Products) works fine with no extra counts present", () => {
    const products: Page<{ productId: string }> = envelope(
      [{ productId: "p1" }, { productId: "p2" }],
      null,
    );
    expect(products.results).toHaveLength(2);
    expect("totalSubscriptions" in products).toBe(false);
  });

  it("the Subscriptions extension surfaces the four extra counts alongside the common envelope, unbroken", () => {
    const subscriptions: SubscriptionPage<{ subscriptionId: string }> = {
      ...envelope([{ subscriptionId: "s1" }], null),
      totalSubscriptions: 85,
      activeSubscriptions: 60,
      dueSubscriptions: 10,
      inactiveSubscriptions: 15,
    };

    // The common envelope shape still works...
    expect(subscriptions.count).toBe(1);
    expect(subscriptions.results).toEqual([{ subscriptionId: "s1" }]);
    // ...with the extra counts surfaced alongside it, not replacing anything.
    expect(subscriptions.totalSubscriptions).toBe(85);
    expect(subscriptions.activeSubscriptions).toBe(60);
    expect(subscriptions.dueSubscriptions).toBe(10);
    expect(subscriptions.inactiveSubscriptions).toBe(15);
  });

  it("listAll works identically whether or not the envelope carries the extra Subscription counts", async () => {
    const subscriptionsPage: SubscriptionPage<number> = {
      ...envelope([1, 2], null),
      totalSubscriptions: 2,
      activeSubscriptions: 2,
      dueSubscriptions: 0,
      inactiveSubscriptions: 0,
    };

    const items: number[] = [];
    for await (const item of listAll(subscriptionsPage, vi.fn())) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
  });
});
