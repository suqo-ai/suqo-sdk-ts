# Checkout sessions

The recommended way to collect payment. A session charges one to ten items in a single checkout: you open it, send the buyer to the `checkoutUrl` it returns, SUQO runs the whole payment flow, and you learn the outcome from a webhook. It replaces [`subscriptions.create()`](subscriptions.md), which stays supported for integrations already built on it.

## Opening one

```ts
const session = await suqo.checkoutSessions.create({
  returnUrl: 'https://your-app.example/orders/1234',
  customerId: 'cus_1ce18d624', // optional — see below
  items: [
    { pbpId: billingPeriod.pbpId }, // a catalogue item, from products.list()
    { name: 'Onboarding setup', amount: '2500.00', intervalType: 'one_time', intervalCount: 0 },
  ],
});

session.publicId;    // "cks_…" — also the session_id on the checkout webhooks
session.checkoutUrl; // send the buyer here
session.expiresAt;   // when the URL stops working — about 30 minutes out
```

**`checkoutUrl` is not proof of payment, and neither is the buyer landing back on `returnUrl`.** Learn the real outcome from `checkout.succeeded`/`checkout.failed` (see [`webhooks.md`](webhooks.md)), matched back to this session by `session_id`, which is the `publicId` above. The session stops working at `expiresAt`, so open a fresh one rather than caching it.

### Items

Each element of `items` is one of two shapes — never a mix within one item:

| Shape | Fields | Charges |
|---|---|---|
| `CatalogueItemInput` | `pbpId` | An existing billing period, at its catalogue price |
| `PartnerPricedItemInput` | `name`, `amount`, `intervalType`, `intervalCount` | A price you set, with no billing period behind it |

- **`amount` is a decimal string** (e.g. `"2500.00"`), never a `number`, and it must already include any discount — SUQO charges exactly what you send. There's no separate discount field.
- **`intervalType`** is `day`, `week`, `month`, `year` or `one_time`. `intervalCount` multiplies it (`1` with `month` bills monthly): 1–1095 for `day`, 1–156 for `week`, 1–36 for `month`, 1–3 for `year`, and `0` for `one_time`.
- **One to ten items.** Fewer or more is a `ValidationError`.
- **One item per product — the last one wins, silently.** Two items resolving to the same product (e.g. two billing periods of one product) keep only the last, with no error. Collapse that choice in your own cart first.
- **Prices are snapshotted when the session opens**, so editing a plan afterwards can't change what the buyer was shown.

### `customerId`

| `customerId` | What the buyer sees |
|---|---|
| Sent | Goes straight to payment. Their details are already known and can't be edited at checkout — fix a typo with [`customers.update()`](customers.md) and open a new session. |
| Omitted | Fills in their full name, email, phone and address at checkout. |

Record a buyer with [`customers.create()`](customers.md) and pass the `id` it returns.

### Rate limit

This is the API's one rate-limited endpoint: **20 sessions a minute per account.** Past that it throws `RateLimitError`, with `retryAfter` set to the wait the API named. Like every write, it's never retried automatically — catch it and retry yourself, and open a session when the buyer commits to paying, not when a page loads. See [`rate-limiting.md`](rate-limiting.md).

## Reading one back

```ts
const open = await suqo.checkoutSessions.retrieve('cks_3n9k2xQ7m');
open.lineItems; // CheckoutLineItem[]
```

Only an **open** session can be read. Once it's paid or past `expiresAt` — or the id is unknown or another account's — `retrieve()` throws `NotFoundError`. The error's `rawBody` carries the session's `return_url` when it existed.

## Shape

```ts
interface CheckoutSession {
  publicId: string;
  lineItems: CheckoutLineItem[];
  customerId: string | null;     // null when the buyer enters their own details
  sellerDetails: CheckoutSeller;
  returnUrl: string;
  expiresAt: string;             // kept as sent — may carry a +05:45 offset
  completedAt: string | null;
  isExpired: boolean;
}

interface CheckoutLineItem {
  name: string;                  // the product name, or the name you sent
  amount: string;                // decimal string
  pbpId: string | null;          // null for a partner-priced item
  currency: string;
  vatType: 'inclusive' | 'exclusive' | null;
  vatPercentage: string | null;  // decimal string
  discountAmount: string | null; // decimal string
  intervalType: string;          // day | week | month | year | one_time
  intervalCount: number;
  displayLabel: string;          // e.g. "Monthly", "Every 2 months"
  currentPeriodEnd: string | null;
  extendsTo: string | null;      // YYYY-MM-DD
  nextPaymentDue: string | null; // YYYY-MM-DD
  imageUrls?: string[];          // catalogue items only
  planName?: string | null;      // partner-priced items only
}

interface CheckoutSeller {
  id: string;
  phone: string;                 // the seller's own number — personal data, don't log it
  businessLogo: string | null;
  businessName: string;
}
```

`imageUrls` appears only on catalogue items and `planName` only on partner-priced ones — each is absent, not `null`, on the other kind. Every other nullable field comes back `null`, never `undefined`.

## Retries

`create()` is a write, so it's never retried automatically — a retried timeout could open a second session. `retrieve()` is a read and retries on `NetworkError`, `429` and `5xx` like every read. See [`errors.md`](errors.md#writes-arent-automatically-retried).
