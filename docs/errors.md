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
| `SuqoConfigError` | Constructing `SuqoClient` with a malformed key, or a `baseUrl` that disagrees with it | Thrown synchronously, before any request — see [`docs/authentication.md`](authentication.md) |
| `AuthenticationError` | `401` | Key is missing, malformed, or inactive |
| `KycRequiredError` | `403` | Seller hasn't completed KYC. Carries `kycStatus`, if the response included one |
| `ValidationError` | `400` | See below — two different body shapes, normalized into one class |
| `NotFoundError` | `404` | Resource doesn't exist, or doesn't belong to your account |
| `RateLimitError` | `429` | **Reserved** — see [`docs/rate-limiting.md`](rate-limiting.md); never thrown until the API enforces limits |
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

## `ValidationError` — two wire shapes, one class

A `400` comes back in one of two shapes on the wire; the SDK normalizes both so you only ever need `instanceof ValidationError`, never a shape check of your own:

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
      // detail-shaped body instead — e.g. the duplicate-active-subscription case
      console.error(err.message);
    }
  }
}
```

`fieldErrors` is always a plain object (never `undefined`) — empty when the failure used the `detail` shape instead. Nested validation (e.g. on `subscriptions.create()`'s `customer` payload) comes through as dot-path keys like `customer.phone`, already renamed from the wire's `client.phone`.

## Writes aren't automatically retried

Reads (`list`, `retrieve`) retry on `NetworkError`, `429`, and `5xx` with backoff. Writes (`create`, `cancel`, `updateBillingCycle`, `resume`) never retry automatically — a blindly-retried write could double-act (e.g. a duplicate subscription) since the API has no idempotency-key support yet. See [`docs/idempotency.md`](idempotency.md) for what changes once it does, and [`docs/rate-limiting.md`](rate-limiting.md) for `RateLimitError`'s `retryAfter` field once `429` responses start arriving.
