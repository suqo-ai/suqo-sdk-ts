import type { QueryParams } from "./http/urlBuilder.js";

/**
 * The common paginated-list envelope every list endpoint returns (SDK-SPEC.md §6).
 *
 * @packageDocumentation
 */

/**
 * The page-number pagination envelope common to every list endpoint (SDK-SPEC.md §6).
 * Named `Page` per the cross-language SDK Naming Map v1.1 §06 (mirrors `openapi.yaml`'s
 * `PaginationEnvelope` schema, renamed on the SDK surface only — the wire shape is unaffected).
 */
export interface Page<T> {
  /** Total row count across every page, not just this one. */
  count: number;
  /** URL of the next page, or `null` on the last page. */
  next: string | null;
  /** URL of the previous page, or `null` on the first page. */
  previous: string | null;
  results: T[];
}

/**
 * The four extra status counts the Subscriptions list adds on top of the common envelope
 * (SDK-SPEC.md §6, `openapi.yaml`'s `SubscriptionListEnvelope`).
 */
export interface SubscriptionStatusCounts {
  totalSubscriptions: number;
  activeSubscriptions: number;
  dueSubscriptions: number;
  inactiveSubscriptions: number;
}

/**
 * The Subscriptions list envelope: the common shape plus the four extra counts, surfaced
 * alongside `results` rather than replacing the common envelope shape (SDK-SPEC.md §6). Generic
 * over `T` so this file doesn't need to know about the `Subscription` type — Ticket 4 supplies it.
 * Named `SubscriptionPage` per the Naming Map §06 (mirrors `openapi.yaml`'s
 * `SubscriptionListEnvelope`, renamed on the SDK surface only).
 */
export type SubscriptionPage<T> = Page<T> & SubscriptionStatusCounts;

/** Manual pagination params a caller can pass instead of using `listAll`. */
export interface PageParams {
  /** 1-indexed page number. Server default is 1 if omitted. */
  page?: number;
  /** Results per page (server max 100, server default 20 if omitted). */
  pageSize?: number;
}

/**
 * Maps {@link PageParams}' camelCase fields to the wire's snake_case query params
 * (`pageSize` → `page_size`), so every future paginated resource method shares one mapping
 * instead of re-deriving it. `undefined` fields are omitted, matching `buildUrl`'s own
 * omission rule (Ticket 2) — a caller can pass `{ page, pageSize }` straight through unfiltered.
 */
export function toPageQuery(params?: PageParams): QueryParams {
  return {
    page: params?.page,
    page_size: params?.pageSize,
  };
}

/**
 * Maps a {@link Page}'s `results` through `deserializeItem`, leaving `count`/`next`/`previous`
 * untouched — those three field names already match the wire exactly (`openapi.yaml`
 * `PaginationEnvelope`), only `results`' items need any per-resource field mapping. Shared by
 * every paginated resource so each one only has to supply its own item deserializer, not
 * re-implement unwrapping the envelope.
 */
export function deserializePage<TWireItem, T>(
  wire: Page<TWireItem>,
  deserializeItem: (item: TWireItem) => T,
): Page<T> {
  return {
    count: wire.count,
    next: wire.next,
    previous: wire.previous,
    results: wire.results.map(deserializeItem),
  };
}

/**
 * Auto-iterates every row across every page, following `next` until it's `null` (SDK-SPEC.md §6),
 * without requiring manual page math. Deliberately decoupled from `HttpClient`/any resource: the
 * caller supplies the already-fetched first page and a `fetchNext` callback that turns a `next`
 * URL into the following page. This keeps pagination testable and reusable across every future
 * paginated resource (Ticket 4) without this file needing to know how HTTP requests are made.
 *
 * Manual `page`/`pageSize` access (via {@link toPageQuery}) remains available independently —
 * this iterator is additive, not a replacement (SDK-SPEC.md §6 requires both to keep working).
 *
 * Guards against a `fetchNext` (or a server) that never reaches `next: null` — a real bug caught
 * in review, not hypothetical, since the loop would otherwise trust the sequence to terminate
 * forever. After `maxPages` pages, throws instead of hanging silently.
 *
 * @param maxPages - Safety cap on how many pages to follow before giving up. Defaults to a limit
 * generous enough for any realistic result set (10,000 pages — millions of rows at the max page
 * size) while still catching a genuine stuck loop quickly.
 *
 * @example
 * ```ts
 * const firstPage = await suqo.subscriptions.list({ pageSize: 100 });
 * for await (const subscription of listAll(firstPage, fetchNextPage)) {
 *   // subscription: Subscription
 * }
 * ```
 */
export async function* listAll<T>(
  firstPage: Page<T>,
  fetchNext: (nextUrl: string) => Promise<Page<T>>,
  maxPages = 10_000,
): AsyncIterableIterator<T> {
  let page: Page<T> = firstPage;
  let pagesSeen = 0;

  while (true) {
    pagesSeen++;
    if (pagesSeen > maxPages) {
      throw new Error(
        `listAll exceeded ${maxPages} pages without reaching next: null. This usually means the ` +
          "server or the fetchNext callback isn't advancing — check for a stuck loop.",
      );
    }

    for (const item of page.results) {
      yield item;
    }

    if (page.next === null) {
      return;
    }

    page = await fetchNext(page.next);
  }
}

/**
 * Bridges {@link listAll} to a resource's public `.autoPaging()` method (SDK Naming Map v1.1 §04
 * — the public name is `.autoPaging()`; `listAll` stays this file's own internal engine name, per
 * Ticket 3's design doc). Named `bridgeAutoPaging`, not `autoPaging`, specifically so it never
 * shares a name with the public method that calls it — the two would still resolve correctly
 * either way (a class method name isn't a lexical binding inside its own body), but a distinct
 * name means nobody has to reason through that to be sure.
 *
 * The only difference from calling {@link listAll} directly is accepting the first page as a
 * `Promise` rather than an already-resolved value — a resource method's `.autoPaging()` has to
 * kick off that first request itself (e.g. `this.list(params)`), and returning an
 * `AsyncIterableIterator` immediately (instead of `async function` + `await`) means nothing runs
 * until the caller actually starts iterating, matching every other async generator's behavior.
 *
 * Still fully decoupled from `HttpClient`/any resource, same as {@link listAll} — this file never
 * imports anything from the HTTP layer.
 *
 * @example
 * ```ts
 * autoPaging(params?: PageParams): AsyncIterableIterator<Product> {
 *   return bridgeAutoPaging(this.list(params), (nextUrl) =>
 *     this.#http.request<Page<Product>>({ method: "GET", path: nextUrl }),
 *   );
 * }
 * ```
 */
export function bridgeAutoPaging<T>(
  firstPage: Promise<Page<T>>,
  fetchNext: (nextUrl: string) => Promise<Page<T>>,
  maxPages = 10_000,
): AsyncIterableIterator<T> {
  return (async function* () {
    yield* listAll(await firstPage, fetchNext, maxPages);
  })();
}
