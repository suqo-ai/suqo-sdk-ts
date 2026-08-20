import { describe, expect, it, vi } from "vitest";
import {
  listAll,
  toPageQuery,
  type PaginationEnvelope,
  type SubscriptionPaginationEnvelope,
} from "../src/pagination.js";

function envelope<T>(results: T[], next: string | null): PaginationEnvelope<T> {
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
});

describe("PaginationEnvelope / SubscriptionPaginationEnvelope shape", () => {
  it("a plain envelope (e.g. Products) works fine with no extra counts present", () => {
    const products: PaginationEnvelope<{ productId: string }> = envelope(
      [{ productId: "p1" }, { productId: "p2" }],
      null,
    );
    expect(products.results).toHaveLength(2);
    expect("totalSubscriptions" in products).toBe(false);
  });

  it("the Subscriptions extension surfaces the four extra counts alongside the common envelope, unbroken", () => {
    const subscriptions: SubscriptionPaginationEnvelope<{ subscriptionId: string }> = {
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
    const subscriptionsPage: SubscriptionPaginationEnvelope<number> = {
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
