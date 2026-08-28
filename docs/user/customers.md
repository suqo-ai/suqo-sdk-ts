# Customers

Read-only — `list()` and `retrieve()` only. There's no `create`/`update`/`delete`; a customer record is created implicitly the first time someone subscribes, via [`subscriptions.create()`](subscriptions.md)'s `customer` field.

## Listing

```ts
const page = await suqo.customers.list();
page.results; // Customer[]
```

Paginated like every other list endpoint — see [`docs/user/pagination.md`](pagination.md).

## Retrieving one

```ts
const customer = await suqo.customers.retrieve(42);
```

`id` is a **plain integer** here — the one resource in this SDK that breaks from the UUID convention everything else uses. Don't quote it, and don't expect it to look like `de337e17-59a1-...`.

## Shape

```ts
interface Customer {
  id: number;
  buyerPhone: string | null;
  buyerEmail: string | null;
  fullName: string | null;
  createdAt: string;
}
```

Every field except `id`/`createdAt` can be `null` — a customer record doesn't guarantee it has a phone or email on file.

This is a genuinely different shape from the `customer` object embedded on a `Subscription` (see [`docs/user/subscriptions.md`](subscriptions.md)) — that one uses `phone`/`fullName`/`email` with no `buyer` prefix, plus nested `billing`/`shipping`. They're related concepts (both describe a buyer) but not the same type, and the SDK never conflates them.
