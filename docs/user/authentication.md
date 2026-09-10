# Authentication

## Getting a key

Every request needs your SUQO API key, from your seller dashboard. There are two kinds:

- `su_test_key_...` — **sandbox**. Talks to `https://test-be.suqo.ai`, safe to use while integrating.
- `su_key_...` — **live**. Talks to `https://be.suqo.ai`, moves real money.

Pass it once, when you construct the client:

```ts
import { SuqoClient } from '@suqo/sdk';

const suqo = new SuqoClient({ apiKey: process.env.SUQO_API_KEY! });
```

## There's no separate environment flag

The SDK reads the key's prefix and infers everything from it — which base URL to call, and whether `suqo.environment` reports `"sandbox"` or `"live"`. There's nothing else to set:

```ts
suqo.environment; // "sandbox" | "live" — never chosen explicitly
suqo.baseUrl;      // the base URL that inference resolved to
```

Swapping a sandbox key for a live key (or back) is the only thing that changes which environment your calls hit.

## How the key is sent

Every request carries it as `Authorization: Bearer <apiKey>`, attached automatically — there's no separate header to set yourself, and no `X-Api-Key` header (an older, now-incorrect assumption worth calling out explicitly since it doesn't match what's actually sent on the wire).

## `baseUrl` — leave it alone unless you have a reason not to

`baseUrl` exists as an escape hatch, not something to set day-to-day. If you do pass one, it must agree with what the key's prefix already implies — a `su_key_...` (live) key with a sandbox `baseUrl`, for example, is treated as a configuration mistake, not a redirect:

```ts
new SuqoClient({
  apiKey: 'su_key_...',
  baseUrl: 'https://test-be.suqo.ai', // disagrees with the live key → throws
});
```

## Other constructor options

| Option | Default | What it does |
|---|---|---|
| `timeout` | `30_000` (30s) | Per-request timeout, in milliseconds. Aborts a call that takes longer than this. |
| `maxRetries` | `2` (3 attempts total) | Max retry attempts for **reads only** — `list`/`retrieve` calls retry on `NetworkError`, `429`, and `5xx` with backoff. Writes never retry regardless of this value; see [`docs/user/errors.md`](errors.md#writes-arent-automatically-retried). |

```ts
const suqo = new SuqoClient({
  apiKey: process.env.SUQO_API_KEY!,
  timeout: 10_000,  // fail faster than the 30s default
  maxRetries: 0,    // disable automatic retries on reads entirely
});
```

Both apply to every call made through this client — there's no way to override either on a per-call basis today; construct a second `SuqoClient` with different values if you need that.

## Errors thrown before any request is made

Both of these are thrown synchronously, from the constructor, as `SuqoConfigError` — you'll never see them wrapped in a rejected promise:

| Cause | Message shape |
|---|---|
| Key doesn't start with `su_key_` or `su_test_key_` | `Malformed SUQO API key: expected prefix "su_key_" (live) or "su_test_key_" (sandbox).` |
| `baseUrl` override disagrees with the key's inferred URL | `Environment mismatch: key implies <url> but baseUrl was set to <url>. Remove baseUrl or use a matching key.` |

```ts
import { SuqoConfigError } from '@suqo/sdk';

try {
  new SuqoClient({ apiKey: 'not-a-real-key' });
} catch (err) {
  if (err instanceof SuqoConfigError) {
    // fix the key before doing anything else — no request was ever attempted
  }
}
```

## The key is never exposed by accident

`console.log(suqo)`, `JSON.stringify(suqo)`, and Node's `util.inspect` all print `apiKey: "[redacted]"` instead of the real value — including when you log the client itself rather than something derived from it. Nothing about how you use the SDK will accidentally leak the key into a log line.

See [`docs/user/errors.md`](errors.md) for the rest of the error hierarchy, and [`docs/user/rate-limiting.md`](rate-limiting.md) for the (planned) `429` behavior once the API enforces limits.
