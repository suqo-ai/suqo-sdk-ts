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

A `Product` carries its `plan[]`, and each `Plan` carries its `billingPeriods[]`. The `pbpId` on a billing period is what you pass to [`subscriptions.create()`](subscriptions.md) — it's the one identifier that ties "what a buyer is browsing" to "what they subscribe to":

```ts
const product = page.results[0];
const billingPeriod = product?.plan[0]?.billingPeriods[0];
if (!billingPeriod) throw new Error('no billing period available');

await suqo.subscriptions.create({
  pbpId: billingPeriod.pbpId,
  returnUrl: 'https://your-app.example/return',
  customer: { phone: '9800000000', fullName: 'Jane Doe', email: 'jane@example.com', address: 'Kathmandu' },
});
```

## Fields worth knowing about

- **`vat`** can be `null` — not every product has VAT configured.
- **`price`, `vatPercentage`, `totalSubscribers`** are decimal-shaped values sent as strings on the wire (e.g. `"500.00"`) and kept as strings end to end — never coerced to `number`. Format or parse them yourself if you need arithmetic; the SDK won't silently round anything.
- **`plan`** and a plan's **`billingPeriods`** can both come back empty — a product with no plans configured yet is spec-legal, not a bug in your integration.

```ts
interface Product {
  productId: string;
  name: string;
  description: string;
  type: string;
  isActive: boolean;
  termsAndConditions: string;
  featuresAndBenefits: string;
  vat: ProductVat | null;
  productImage: string[];
  plan: Plan[];
  totalSubscribers: string; // decimal string
  createdAt: string;
  updatedAt: string;
}
```
