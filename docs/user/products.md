# Products

Read-only — the only resource that works before your seller account completes KYC verification, since there's no seller action involved in just browsing your own catalog.

## Listing products

```ts
const page = await suqo.products.list();
page.results; // Product[]
```

`list()` is paginated — see [`docs/user/pagination.md`](pagination.md) for `page`/`pageSize` and `.autoPaging()`. It takes the same `{ page?, pageSize? }` params every paginated resource does:

```ts
await suqo.products.list({ page: 2, pageSize: 50 });
```

## Finding a billing period to subscribe to

A `Product` carries its `plan[]`, and each `Plan` carries its `billingPeriods[]`. The `pbpId` on a billing period is what you pass to [`checkoutSessions.create()`](checkout-sessions.md) (or the legacy [`subscriptions.create()`](subscriptions.md)) — it's the one identifier that ties "what a buyer is browsing" to "what they pay for":

```ts
const product = page.results[0];
const billingPeriod = product?.plan[0]?.billingPeriods[0];
if (!billingPeriod) throw new Error('no billing period available');

await suqo.checkoutSessions.create({
  returnUrl: 'https://your-app.example/return',
  items: [{ pbpId: billingPeriod.pbpId }],
});
```

Check a billing period's `intervalType` before offering cancel or resume: `one_time` is a single purchase, and what it creates can't be cancelled, resumed, rescheduled or renewed (see [`subscriptions.md`](subscriptions.md#one-time-purchases)).

## Fields worth knowing about

- **`vat`** can be `null` — not every product has VAT configured. Inside it, `vatType` (`"inclusive"` or `"exclusive"`) and `vatPercentage` can each be `null` too.
- **`price`, `vatPercentage`, `totalSubscribers`** are decimal-shaped values sent as strings on the wire (e.g. `"500.00"`) and kept as strings end to end — never coerced to `number`. Format or parse them yourself if you need arithmetic; the SDK won't silently round anything.
- **`description`, `termsAndConditions`, `featuresAndBenefits`** (and a plan's `description`) can be `null`.
- **`type`** is `"simple"` or `"tiered"`; **`intervalType`** is `"day"`, `"week"`, `"month"`, `"year"` or `"one_time"`. A value the API adds later passes through as a plain string rather than breaking your code.
- **`offers`** lists a billing period's discounts. `discountAmount` is a whole number of rupees (a `number`, not a decimal string), and it's **already applied** to `price` while the offer is active — don't subtract it again.
- **`plan`** and a plan's **`billingPeriods`** can both come back empty — a product with no plans configured yet is spec-legal, not a bug in your integration.

```ts
interface Product {
  productId: string;
  name: string;
  description: string | null;
  type: 'simple' | 'tiered';
  isActive: boolean;
  termsAndConditions: string | null;
  featuresAndBenefits: string | null;
  vat: ProductVat | null; // { isVatActive, vatType: 'inclusive' | 'exclusive' | null, vatPercentage: string | null }
  productImage: ProductImage[]; // { image: string; imageOrder: number }
  plan: Plan[];
  totalSubscribers: string; // decimal string
  createdAt: string;
  updatedAt: string;
}
```

```ts
interface BillingPeriod {
  pbpId: string;
  intervalType: 'day' | 'week' | 'month' | 'year' | 'one_time';
  intervalCount: number;
  label: string;
  price: string; // decimal string, active offer already applied
  currency: string;
  isCurrent: boolean;
  isLimited: boolean;
  isArchived: boolean;
  offers: Offer[];
}

interface Offer {
  id: string;
  discountAmount: number;    // whole rupees — already applied to price
  startsAt: string | null;   // YYYY-MM-DD
  validUntil: string | null; // YYYY-MM-DD
  isActive: boolean;
}
```
