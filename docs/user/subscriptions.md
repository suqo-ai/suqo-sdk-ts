# Subscriptions

## Creating one

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

### Reuse behavior

If the same buyer already has an inactive/expired subscription for the same product + billing period, `create()` reactivates it instead of creating a duplicate. Only a currently **active** subscription for that same combination triggers a `ValidationError` for a duplicate-active-subscription attempt — see [`docs/user/errors.md`](errors.md).

### The `customer` field

Optional nested `billing`/`shipping` objects. When `billing` is omitted, billing details are filled from the buyer's own profile server-side; on a reused subscription, only the fields you actually send overwrite the existing ones.

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

## Cancelling

```ts
await suqo.subscriptions.cancel(subscriptionId);
```

This schedules cancellation for the **end of the current billing period** — it is not immediate. Status moves to `pending_cancellation`; the subscription stays active until the period actually ends.

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

## What's not here yet

There's no `retrieve(id)` on this resource — fetching a single subscription by id isn't implemented, pending a real sample response from the backend. Use `.list()` (or `.autoPaging()`) and filter client-side if you need to find a specific one today.

## Decimal fields

`Subscription.product.price` stays a string end to end — never coerced to `number`, same as `products.md`'s pricing fields. See [`docs/user/products.md`](products.md) for the same convention on the product side.

## Retries

None of the write methods above (`create`, `cancel`, `updateBillingCycle`, `resume`) are automatically retried on failure — see [`docs/user/errors.md`](errors.md#writes-arent-automatically-retried) and [`docs/user/idempotency.md`](idempotency.md) for why, and what changes once the backend supports idempotency keys.
