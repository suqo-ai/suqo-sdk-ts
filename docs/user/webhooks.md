# Webhooks

`suqo.webhooks.verify()` confirms an inbound delivery genuinely came from SUQO and hasn't been tampered with or replayed. It makes **no network call** and stores no secret — you pass your own webhook signing secret into every call, and it's never logged or cached by the SDK.

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
    // event.amount — decimal string, e.g. "500.00" — never coerced to a number
    break;
  case 'checkout.failed':
    break;
  case 'subscription.status_changed':
    // event.previous_status / event.current_status — snake_case, not previousStatus/currentStatus (see below)
    break;
}
```

The three confirmed event shapes:

| Event | Fields |
|---|---|
| `checkout.succeeded` | `subscription_id`, `amount` (decimal string), `status: "succeeded"` |
| `checkout.failed` | `subscription_id`, `amount` (decimal string), `status: "failed"` |
| `subscription.status_changed` | `subscription_id`, `previous_status`, `current_status`, `changed_at` |

**These stay snake_case on purpose** — unlike every other model in this SDK. `verify()` only checks the signature; it never parses or transforms the body. Whatever `JSON.parse(rawBody)` gives you is exactly what's on the wire, snake_case included. Typing these as camelCase would describe a shape that doesn't actually exist at runtime.

This list isn't exhaustive of everything SUQO might ever send — always check `event.event` before trusting the rest of the shape, the same way you'd handle any external tagged union.

## Test deliveries look different

If you trigger a "send test event" from the SUQO dashboard, its signature verifies the same way, but the body shape isn't the same as a real delivery — test payloads nest their fields under a `data` key instead of matching the shapes above. Use test deliveries to confirm `verify()` and your route wiring work end to end, not to exercise your actual payload-parsing logic — write that against the real shapes documented above.
