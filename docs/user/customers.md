# Customers

`list()`, `retrieve()`, `create()` and `update()`. There's no `delete`. A customer record is also created implicitly the first time someone subscribes, via [`subscriptions.create()`](subscriptions.md)'s `customer` field — `create()` is for recording one without opening a subscription.

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

## Creating one

```ts
const customer = await suqo.customers.create({
  phone: "9800000000", // required
  fullName: "Ram Bahadur",
  email: "ram@example.com",
  address: "Kathmandu",
});
```

- `phone` identifies the buyer and can't be changed later. It must be a Nepali mobile number (10 digits starting with 96, 97 or 98); a `+977` country code, a leading 0, spaces and dashes are accepted and stripped.
- If you already have a customer with that phone, `create()` updates that customer instead of making a second one, and returns it. That makes `create()` safe for you to retry — though the SDK never retries it automatically, like every write.
- The name, email and address are your account's own copy of the buyer's details and aren't shared with other sellers.
- **Write vs. read names:** you send `phone`/`email`, and they come back on the `Customer` as `buyerPhone`/`buyerEmail`.

## Updating one

```ts
const updated = await suqo.customers.update("cus_1ce18d624", { fullName: "Ram Bahadur" });
```

Send only the fields you're changing — anything you leave out stays as it is. Pass `""` to clear a field. The phone can't be changed, so it isn't an option here.

A validation problem (a bad phone or email) throws `ValidationError` with `fieldErrors` — see [`errors.md`](errors.md).

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
