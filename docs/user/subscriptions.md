# Subscriptions

> **Collecting payment?** Use [checkout sessions](checkout-sessions.md) — the recommended way, with up to ten items in one checkout. `subscriptions.create()` below is **legacy**: still supported, and existing integrations keep working, but new ones should use checkout sessions.

## Creating one (legacy)

```ts
const response = await suqo.subscriptions.create({
  pbpId: billingPeriod.pbpId, // from products.list() — see docs/user/products.md
  returnUrl: 'https://your-app.example/return',
  customer: {
    phone: '9800000000',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    address: 'Kathmandu',
  },
});

response.checkoutUrl; // redirect the buyer here to pay
```

**`checkoutUrl` is not proof of payment.** A newly created subscription comes back in `pending_checkout` status — redirecting the buyer there starts checkout, it doesn't confirm it succeeded. Learn the real outcome from the `checkout.succeeded`/`checkout.failed` webhooks (see [`docs/user/webhooks.md`](webhooks.md)), not from this response.

### One live subscription per product

`customer.email` identifies the buyer. A buyer may hold only **one live recurring subscription per product**: creating a second one — on any billing period of that same product — throws `ValidationError` (`"You already have a subscription to this product."`). See [`docs/user/errors.md`](errors.md).

To restart an **inactive** subscription, [renew it](#renewing) — don't create a new one.

### The `customer` field

Optional nested `billing`/`shipping` objects. When `billing` is omitted, billing details are filled from the buyer's own profile server-side.

```ts
interface CustomerInput {
  phone: string;
  fullName: string;
  email: string;
  address: string;
  billing?: { businessName: string; email: string; address: string; panVat?: string };
  shipping?: { phone: string; fullName: string; email: string; address?: string };
}
```

## Listing

```ts
const page = await suqo.subscriptions.list();
page.results;              // Subscription[]
page.activeSubscriptions;  // plus 4 extra counts alongside the usual envelope
```

Paginated like every list endpoint — see [`docs/user/pagination.md`](pagination.md). `SubscriptionPage` adds `totalSubscriptions`/`activeSubscriptions`/`dueSubscriptions`/`inactiveSubscriptions` on top of the common `count`/`next`/`previous`/`results` shape.

Those four counts cover **recurring** subscriptions only. One-time purchases appear in `results` but not in the counts, which is why `totalSubscriptions` can be lower than `count`.

## Retrieving one

```ts
const subscription = await suqo.subscriptions.retrieve('30b0af58-c8bc-4f79-9917-51208b73a0ed');
```

Returns the same `Subscription` shape as `list()`'s results. An empty, `"."` or `".."` id throws `SuqoConfigError` before any request. The response shape is built from Swagger and hasn't yet been checked against a captured response.

## Cancelling

```ts
await suqo.subscriptions.cancel(subscriptionId);
```

This schedules cancellation for the **end of the current billing period** — it is not immediate. Status moves to `pending_cancellation`; the subscription stays active until the period actually ends. Cancelling one that's already cancelled or pending cancellation returns it unchanged, so calling it again is safe.

## Changing the billing date

```ts
await suqo.subscriptions.updateBillingCycle({
  subscriptionId: '30b0af58-c8bc-4f79-9917-51208b73a0ed',
  nextBillingCycle: '2026-03-01', // YYYY-MM-DD, today or a future date
});
```

This is a collection-level call — the subscription id travels in the request body, not the URL path, mirroring how the API itself models this action.

## Resuming

```ts
await suqo.subscriptions.resume(subscriptionId);
```

Undoes a scheduled cancellation and returns the subscription to `active`; an already-active one is returned unchanged. Once a subscription is `cancelled` there's nothing to resume — [renew](#renewing) it instead.

## Renewing

```ts
const renewal = await suqo.subscriptions.renew(subscriptionId);
renewal.checkoutUrl; // send the buyer here to pay the next payment
```

Opens a checkout session for the next payment on one of your own subscriptions, reusing its existing customer and billing period (or partner-priced item) — this is how an inactive subscription is restarted. It returns the same `CheckoutSessionResponse` as [`checkoutSessions.create()`](checkout-sessions.md) (`publicId`, `expiresAt`, `checkoutUrl`), and the outcome arrives on the same `checkout.*` webhooks, keyed by that `publicId`.

A cancelled or archived subscription, or a paid one-time purchase, can't be renewed — that throws `ValidationError`. (The API route is the singular `/api/v1/subscription/renew/`; the SDK handles that for you.)

## One-time purchases

A billing period whose `intervalType` is `one_time` (see [`products.md`](products.md)) is a single purchase, not a cadence. A subscription opened on one has no next billing date, is left out of `list()`'s counts, and **can't be cancelled, resumed, rescheduled or renewed** — each of those throws `ValidationError`. Nothing on the `Subscription` itself says it's one-time: match its `product.pbpId` against `products.list()` to find out.

## Status values

`Subscription.status` is one of:

| Status | Meaning |
|---|---|
| `pending_checkout` | Newly created; the buyer hasn't paid yet |
| `active` | Currently active |
| `due` | `nextBillingCycle` passed with no payment yet |
| `cancelled` | Cancelled immediately (user-prompted) |
| `pending_cancellation` | Scheduled to cancel at the end of the current billing cycle — see [Cancelling](#cancelling) above |
| `inactive` | Auto-ended after a grace period without payment |

`isActive` on a `Subscription` is `true` iff `status === "active"`.

## Decimal fields

`Subscription.product.price` stays a string end to end — never coerced to `number`, same as `products.md`'s pricing fields. See [`docs/user/products.md`](products.md) for the same convention on the product side.

## Retries

None of the write methods above (`create`, `cancel`, `updateBillingCycle`, `resume`, `renew`) are automatically retried on failure — see [`docs/user/errors.md`](errors.md#writes-arent-automatically-retried) and [`docs/user/idempotency.md`](idempotency.md) for why, and what changes once the backend supports idempotency keys.
