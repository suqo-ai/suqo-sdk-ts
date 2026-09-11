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
const customer = await suqo.customers.retrieve("cus_1ce18d624");
```

`id` is an **opaque prefixed string** here (e.g. `cus_1ce18d624`) — like `pbp_...` on billing periods, not an integer and not a UUID. (Prior to a fix for [#42](https://github.com/suqo-ai/suqo-sdk-ts/issues/42), this was incorrectly documented and typed as a plain integer — that never actually matched what the API returns.)

## Shape

```ts
interface Customer {
  id: string;
  buyerPhone: string | null;
  buyerEmail: string | null;
  fullName: string | null;
  address: string | null;
  createdAt: string;
}
```

Every field except `id`/`createdAt` can be `null` — a customer record doesn't guarantee it has a phone, email, or address on file.

This is a genuinely different shape from the `customer` object embedded on a `Subscription` (see [`docs/user/subscriptions.md`](subscriptions.md)) — that one uses `phone`/`fullName`/`email` with no `buyer` prefix, plus nested `billing`/`shipping`. They're related concepts (both describe a buyer) but not the same type, and the SDK never conflates them.
