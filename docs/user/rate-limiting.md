# Rate limiting

> **Status: Live, on one endpoint.** As of 2.0.0, the API rate-limits
> `checkoutSessions.create()` only. Every other call is unlimited. See
> [`SDK-SPEC.md` §10](../../specs/SDK-SPEC.md).

## What's limited

| Call | Limit | Over the limit |
|---|---|---|
| `checkoutSessions.create()` | 20 sessions a minute, per account | `429` → `RateLimitError` |

Every other endpoint is unlimited today.

The API names the wait **inside the response's `detail` text**
(`"Request was throttled. Expected available in 41 seconds."`) — it sends no
`Retry-After` header. The SDK reads it for you.

## SDK behaviour

- **`RateLimitError`** is thrown for a `429`. Its `retryAfter` is the
  suggested wait in **milliseconds**: taken from a `Retry-After` header when
  one is present, otherwise parsed from the `detail` text, and capped at 60
  seconds. It's `undefined` only if the API named no wait at all.
- **`checkoutSessions.create()` is never retried automatically.** It's a
  write, and writes don't retry until idempotency ships (see
  [`idempotency.md`](idempotency.md)) — a retried timeout could open a second
  session. Catch the error and retry yourself.
- **Reads** still retry on `429` with exponential backoff and jitter, honouring
  `retryAfter` when the API gives one — no read is rate-limited today, but
  that path is ready if one ever is.

## Recommended client backoff

```ts
import { RateLimitError } from '@suqo/sdk';

try {
  await suqo.checkoutSessions.create({ returnUrl, items });
} catch (err) {
  if (err instanceof RateLimitError) {
    // err.retryAfter — milliseconds to wait before trying again (41_000 for the example above)
    await new Promise((resolve) => setTimeout(resolve, err.retryAfter ?? 60_000));
    // …then retry, or tell the buyer to try again shortly
  } else {
    throw err;
  }
}
```

Open a session when the buyer commits to paying, not when they load a page —
that keeps a busy catalogue well inside the limit.

## Quota metadata — named, not yet built

Beyond `Retry-After`, the SDK Naming Map (§8) reserves names for quota
metadata, following the [IETF `RateLimit-*` draft][ratelimit-draft] that
GitHub and Cloudflare have converged on:

| Response header | SDK field |
|---|---|
| `RateLimit-Limit` | `rateLimitLimit` |
| `RateLimit-Remaining` | `rateLimitRemaining` |
| `RateLimit-Reset` | `rateLimitReset` |

None of these exist in the SDK today — the API doesn't send the headers, and
no code reads them. They're listed here only so the names are settled ahead of
time. Where exactly they'll surface (on every response, only on
`RateLimitError`, or something else) is still open.

[ratelimit-draft]: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
