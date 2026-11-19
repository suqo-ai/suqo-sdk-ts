# Webhooks

`suqo.webhooks` does two jobs:

- **`verify()`** confirms an inbound delivery genuinely came from SUQO and hasn't been tampered with or replayed. It makes **no network call** and stores no secret — you pass your own webhook signing secret into every call, and it's never logged or cached by the SDK.
- **The management methods** — `list`, `create`, `retrieve`, `replace`, `update`, `delete`, `retrieveSecret`, `testDelivery` — call the API to control which endpoint receives which event. See [Managing webhook registrations](#managing-webhook-registrations).

## Mounting the route

The one thing this consistently trips people up on: **verification needs the raw, unparsed request body.** If a JSON body-parser middleware (like Express's commonly-used `express.json()`) already ran on this route, the signature will never match — parsing and re-serializing JSON can silently change whitespace or key order even when the actual content didn't change.

```ts
// Express: mount express.raw() on this route specifically, so req.body is a Buffer.
app.post('/hooks/suqo', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = suqo.webhooks.verify({
    rawBody: req.body,
    signature: req.header('X-SUQO-Signature')!,
    timestamp: req.header('X-SUQO-Timestamp')!,
    secret: process.env.SUQO_WEBHOOK_SECRET!,
  });

  if (!ok) return res.sendStatus(400); // not genuinely from SUQO, or tampered/replayed
  res.sendStatus(200);                  // ack fast; do the real work async
});
```

`verify()` never throws — every failure mode (malformed signature, expired timestamp, an actual mismatch, or a missing header) returns `false`. You never need a `try`/`catch` just to check a delivery.

## Replay protection

A delivery older than `toleranceSec` (default `300`, ~5 minutes) is rejected regardless of whether the signature is otherwise valid:

```ts
suqo.webhooks.verify({ rawBody, signature, timestamp, secret, toleranceSec: 600 });
```

## Event payloads

Once `verify()` returns `true`, parse the body yourself and narrow on `event`:

```ts
const event = JSON.parse(req.body.toString()) as WebhookEvent;

switch (event.event) {
  case 'checkout.succeeded':
    // event.session_id — the publicId checkoutSessions.create() returned; match the order on it
    // event.amount — the session total, a decimal string, e.g. "500.00" — never coerced to a number
    break;
  case 'checkout.failed':
    break;
  case 'subscription.status_changed':
    // event.previous_status / event.current_status — snake_case, not previousStatus/currentStatus (see below)
    break;
}
```

The event shapes:

| Event | Fields |
|---|---|
| `checkout.succeeded` | `session_id`, `amount` (decimal string), `status: "succeeded"`, `line_items` |
| `checkout.failed` | `session_id`, `amount` (decimal string), `status: "failed"`, `line_items` |
| `subscription.status_changed` | `subscription_id`, `previous_status`, `current_status`, `changed_at` |
| `api_key.created` / `api_key.expired` / `api_key.expiring_soon` | `api_key_id`, `name`, `masked_key`, `expires_at` (`null` if the key never expires), `created_at` |
| `api_key.deleted` | The same, plus `deleted_at` |

### Checkout events — changed in 2.0.0

`checkout.succeeded` and `checkout.failed` now arrive **once per checkout session**, whatever the item count, keyed by `session_id` (the `publicId` from [`checkoutSessions.create()`](checkout-sessions.md)) — not once per subscription keyed by `subscription_id`. Payments taken through the legacy [`subscriptions.create()`](subscriptions.md) report through the same payload.

```json
{
  "event": "checkout.succeeded",
  "session_id": "cks_3n9k2xQ7m",
  "amount": "5000.00",
  "status": "succeeded",
  "line_items": [
    {
      "name": "Capture Pro",
      "amount": "1000.00",
      "pbp_id": "pbp_dd4876956363ad3",
      "currency": "NPR",
      "vat_type": null,
      "vat_percentage": null,
      "discount_amount": null,
      "interval_type": "month",
      "interval_count": 1,
      "image_urls": []
    }
  ]
}
```

- **`amount`** is the session total; each line item's `amount` is that item's price. All amounts are decimal strings.
- **`line_items`** has one entry per item charged, each with `name`, `amount`, `pbp_id`, `currency`, `vat_type`, `vat_percentage`, `discount_amount`, `interval_type` and `interval_count`. A catalogue item also has `image_urls`. A partner-priced item has `pbp_id: null` and a `plan_name`.
- **Renewals:** when the session was opened by [`subscriptions.renew()`](subscriptions.md), each line item also carries `subscription_id`, the subscription being renewed.
- **`checkout.failed`** is final — SUQO retries pending or transient failures internally and only sends it once the outcome is settled. The specific cause isn't in the payload.

These shapes match delivery samples captured by the backend team on 2026-11-19.

**These stay snake_case on purpose** — unlike every other model in this SDK. `verify()` only checks the signature; it never parses or transforms the body. Whatever `JSON.parse(rawBody)` gives you is exactly what's on the wire, snake_case included. Typing these as camelCase would describe a shape that doesn't actually exist at runtime.

This list isn't exhaustive of everything SUQO might ever send — always check `event.event` before trusting the rest of the shape, the same way you'd handle any external tagged union.

## Managing webhook registrations

An account holds **one webhook per event**, each pointing at one `https` endpoint. These methods call the API with your key; unlike most of the API, they work before KYC verification.

```ts
const webhook = await suqo.webhooks.create({
  event: 'checkout.succeeded',
  endpointUrl: 'https://your-app.example/hooks/suqo',
});

await suqo.webhooks.list();                                  // Webhook[] — every registration, not paginated
await suqo.webhooks.retrieve(webhook.id);                    // one, by its "whk_…" id
await suqo.webhooks.update(webhook.id, { isActive: false }); // PATCH — only what you send changes
await suqo.webhooks.replace(webhook.id, {                    // PUT — event and endpointUrl both required
  event: 'checkout.failed',
  endpointUrl: 'https://your-app.example/hooks/suqo',
});
await suqo.webhooks.delete(webhook.id);                      // past delivery records are kept

const { signingSecret } = await suqo.webhooks.retrieveSecret(); // pass as `secret` to verify()
await suqo.webhooks.testDelivery(webhook.id);                // queues a signed test delivery
```

| Method | HTTP | Notes |
|---|---|---|
| `list()` | `GET` | Every registration, as a plain array |
| `create(params)` | `POST` | A second webhook for the same event, or an endpoint that isn't `https` or resolves to a non-public address, is a `ValidationError` |
| `retrieve(id)` | `GET` | |
| `replace(id, params)` | `PUT` | Full overwrite — `event` and `endpointUrl` are required |
| `update(id, params)` | `PATCH` | Partial — `{ isActive: false }` pauses deliveries without deleting the webhook |
| `delete(id)` | `DELETE` | Resolves to `undefined` |
| `retrieveSecret()` | `GET` | Creates the secret on the first call; it can't be rotated through the API. Treat it like a password — never log it |
| `testDelivery(id)` | `POST` | Resolves once queued; the delivery itself arrives asynchronously |

`replace` and `update` follow the same rule as the rest of the SDK: `update` is always a partial change (as on [`customers.update()`](customers.md)), and `replace` is the full overwrite. Every method that takes an id throws `SuqoConfigError` for an empty, `"."` or `".."` id, before any request. None of the writes are retried automatically.

```ts
interface Webhook {
  id: string;          // "whk_…"
  event: string;       // one of the event names above
  endpointUrl: string;
  isActive: boolean;
  createdAt: string;
}
```

## Test deliveries look different

If you trigger a "send test event" from the SUQO dashboard or `webhooks.testDelivery()`, its signature verifies the same way, but the body shape isn't the same as a real delivery — test payloads nest their fields under a `data` key instead of matching the shapes above. Use test deliveries to confirm `verify()` and your route wiring work end to end, not to exercise your actual payload-parsing logic — write that against the real shapes documented above.
