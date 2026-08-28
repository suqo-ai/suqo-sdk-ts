# Pagination

Every list endpoint (`products.list()`, `subscriptions.list()`, `customers.list()`) returns the same envelope shape, and offers two ways to walk it.

## The envelope

```ts
interface Page<T> {
  count: number;         // total rows across every page, not just this one
  next: string | null;   // URL of the next page, or null on the last page
  previous: string | null;
  results: T[];
}
```

`subscriptions.list()` returns a superset of this — `SubscriptionPage<T>` — with four extra counts alongside `results`:

```ts
interface SubscriptionPage<T> extends Page<T> {
  totalSubscriptions: number;
  activeSubscriptions: number;
  dueSubscriptions: number;
  inactiveSubscriptions: number;
}
```

## Manual paging

Pass `page`/`pageSize` yourself:

```ts
const page1 = await suqo.products.list({ page: 1, pageSize: 50 });
const page2 = await suqo.products.list({ page: 2, pageSize: 50 });
```

`pageSize` maps to the wire's `page_size` query param — the SDK handles that translation, you never write `page_size` yourself. Server default is `pageSize: 20` if omitted, with a server-side max of 100.

## `.autoPaging()` — walk every row without page math

Every paginated resource also exposes `.autoPaging()`, which follows `next` until it's `null` and yields items one at a time:

```ts
for await (const product of suqo.products.autoPaging()) {
  // product: Product — every product across every page, no manual page tracking
}
```

It takes the same params as `.list()`:

```ts
for await (const subscription of suqo.subscriptions.autoPaging({ pageSize: 100 })) {
  // ...
}
```

`.autoPaging()` is additive, not a replacement — manual `page`/`pageSize` access via `.list()` keeps working exactly as before, for the cases where you genuinely want one page at a time (e.g. paging controls in a UI).

`.autoPaging()` returns an `AsyncIterableIterator`, so it also works with `for await...of` in any async context, or by calling `.next()` on it directly if you're not in a `for await` loop.
