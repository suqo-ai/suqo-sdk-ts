import { describe, expect, it } from "vitest";
import {
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
});
