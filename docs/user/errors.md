# Errors

Every error the SDK throws is an instance of `SuqoError`. The base class itself is never thrown directly — always one of the subclasses below. Check `instanceof`, never the error's `message` string or the raw response shape — those aren't part of the contract and can change wording without notice.

```ts
import { SuqoError } from '@suqo/sdk';

try {
  await suqo.subscriptions.create({ ... });
} catch (err) {
  if (err instanceof SuqoError) {
    console.error(err.name, err.message, err.status);
  }
}
```

## The hierarchy

| Class | When | Notes |
|---|---|---|
| `SuqoConfigError` | Constructing `SuqoClient` with a malformed key or a disagreeing `baseUrl` (see [`docs/user/authentication.md`](authentication.md)) — or a call-time argument that would otherwise silently misdirect a request, e.g. an empty `customers.retrieve(id)` | Always before any request is attempted, but not always synchronous — the constructor case throws synchronously, a call-time case rejects the returned promise like any other SDK error |
| `AuthenticationError` | `401` | Key is missing, malformed, or inactive |
| `KycRequiredError` | `403` with a `status_code` in the body | Seller hasn't completed KYC. Carries `kycStatus` (`KYC_INCOMPLETE` or `KYC_VERIFICATION_PENDING`) |
| `PermissionDeniedError` | `403` with only `detail` in the body | The key may not perform this action for a reason other than KYC — e.g. it doesn't belong to the account. New in 2.0.0 |
| `ValidationError` | `400` | See below — three different body shapes, normalized into one class |
| `NotFoundError` | `404` | Resource doesn't exist, or doesn't belong to your account |
| `RateLimitError` | `429` | Only from `checkoutSessions.create()` today. Carries `retryAfter` — see [`docs/user/rate-limiting.md`](rate-limiting.md) |
| `ServerError` | `5xx` (and any unmapped status) | Unexpected failure on SUQO's side |
| `NetworkError` | No response at all | Covers both a genuine network failure and a timeout — there's no separate timeout class |

Every subclass carries whatever the base class does:

```ts
interface SuqoErrorOptions {
  status?: number;      // HTTP status, if there was a response
  rawBody?: unknown;     // the raw parsed response body, if any
  requestId?: string;    // SUQO's request id for this call, if the response included one
}
```

## Two kinds of `403`

A `403` is told apart by its body, never the status alone:

- **KYC not cleared** — `{ "status_code": "KYC_VERIFICATION_PENDING", "message": "…" }` → `KycRequiredError`. Resolved in the seller dashboard, not through the API.
- **Anything else** — `{ "detail": "You do not have permission to perform this action." }` → `PermissionDeniedError`.

**Changed in 2.0.0:** in 1.x every `403` was a `KycRequiredError`. If you catch `KycRequiredError` to prompt the seller to finish KYC, that's still right — it just no longer fires for permission problems that KYC wouldn't fix.

KYC is never enforced on the sandbox, and `products.list()` and every `webhooks` management method work before KYC on live too — on those, only `PermissionDeniedError` can occur.

## `ValidationError` — three wire shapes, one class

A `400` comes back in one of three shapes on the wire; the SDK normalizes them so you only ever need `instanceof ValidationError`, never a shape check of your own:

- **Field-keyed** — `{ "phone": ["…"] }` → `fieldErrors` populated.
- **`detail`** — `{ "detail": "…" }` → `message`, `fieldErrors` empty.
- **A bare list** — `["This is a one-time purchase, so there is nothing to cancel."]` → the messages become `message`, `fieldErrors` empty. Sent by `cancel`, `resume` and `renew` (no request body to key a field on), and by `subscriptions.create()`'s one-subscription-per-product error.

```ts
import { ValidationError } from '@suqo/sdk';

try {
  await suqo.subscriptions.create({ ... });
} catch (err) {
  if (err instanceof ValidationError) {
    if (Object.keys(err.fieldErrors).length > 0) {
      // field-keyed body — e.g. { phone: ["This field is required."] }
      console.error(err.fieldErrors);
    } else {
      // a detail-shaped or bare-list body instead — e.g. the one-subscription-per-product case
      console.error(err.message);
    }
  }
}
```

`fieldErrors` is always a plain object (never `undefined`) — empty when the failure used the `detail` or bare-list shape instead. Nested validation (e.g. on `subscriptions.create()`'s `customer` payload) comes through as dot-path keys like `customer.phone`, already renamed from the wire's `client.phone`.

## Writes aren't automatically retried

Reads (`list`, `retrieve`, `retrieveSecret`) retry on `NetworkError`, `429`, and `5xx` with backoff. Writes — every `POST`, `PATCH`, `PUT` and `DELETE`: `create`, `update`, `replace`, `delete`, `cancel`, `updateBillingCycle`, `resume`, `renew`, `testDelivery` — never retry automatically. A blindly-retried write could double-act (e.g. a second checkout session or subscription) since the API has no idempotency-key support yet. See [`docs/user/idempotency.md`](idempotency.md) for what changes once it does, and [`docs/user/rate-limiting.md`](rate-limiting.md) for `RateLimitError`'s `retryAfter`.
