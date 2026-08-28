# Rate limiting

> **Status: Planned.** The API does not enforce rate limits yet and returns no
> rate-limit headers today. This page describes the intended model so it's
> published ahead of the feature, not bolted on after the fact — see
> [`SDK-SPEC.md` §10](../../specs/SDK-SPEC.md).

## Current behaviour

No rate limiting is enforced by the API today. Requests are not throttled and
no `429` responses are returned for exceeding a rate. Nothing about how you
call the SDK needs to change in anticipation of this — the SDK is already
built forward-ready (see below).

## Intended model

Once enabled, rate limiting is expected to work as a **token bucket, per API
key**:

- Each API key is allotted a bucket of request tokens that refills over time.
- Exceeding the bucket returns an HTTP `429`, with a `Retry-After` header
  indicating how long to wait before the bucket has room again.

Exact bucket size and refill rate are not yet finalized and aren't published
here to avoid documenting numbers that could change before launch.

## SDK behaviour

The SDK is already built to handle this without a breaking change when it
ships:

- **`RateLimitError`** already exists in the SDK's error hierarchy, reserved
  for `429` responses. It is never thrown today, since the API never returns
  a `429`.
- The retry path for read operations already honours a `Retry-After` header
  when present, with exponential backoff and jitter. No SDK update will be
  required for read retries to respect rate-limit backoff once it arrives.

## Quota metadata — named, not yet built

Beyond `Retry-After`, the SDK Naming Map (v1.3 §8) already reserves names for
quota metadata, following the [IETF `RateLimit-*` draft][ratelimit-draft] that
GitHub and Cloudflare have converged on:

| Response header | SDK field |
|---|---|
| `RateLimit-Limit` | `rateLimitLimit` |
| `RateLimit-Remaining` | `rateLimitRemaining` |
| `RateLimit-Reset` | `rateLimitReset` |

None of these exist in the SDK today — the API doesn't send the headers, and
no code reads them. They're listed here only so the names are settled ahead of
time, the same reasoning as the rest of this page. Where exactly they'll
surface (on every response, only on `RateLimitError`, or something else) is
still open — this page will be updated with the real shape once that's
decided and the headers actually start arriving.

[ratelimit-draft]: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/

## Recommended client backoff

Once rate limiting is live, catch `RateLimitError` and back off using its
`retryAfter` (milliseconds, derived from the response's `Retry-After` header
when present) before retrying:

```ts
import { RateLimitError } from '@suqo/sdk';

try {
  await client.products.list();
} catch (err) {
  if (err instanceof RateLimitError) {
    // err.retryAfter is the suggested backoff in milliseconds, if the
    // response included a Retry-After header.
  }
}
```

This page will be updated with concrete bucket limits and any additional
guidance once rate limiting ships.
