# Design Doc — Ticket 2: HTTP Client (Retries, Timeouts, Cancellation)

**Status:** Draft — backfilled after implementation.
**Audience:** any language SDK team (TypeScript, Python, PHP, …). Nothing below is TypeScript-specific;
where the current implementation makes a TS-specific choice, it's called out separately so another
language can make its own idiomatic equivalent.

---

## 1. Spec alignment

This ticket implements:

- **SDK-SPEC.md §3** — the trailing-slash guarantee on every built URL.
- **SDK-SPEC.md §4** — the `Authorization`/`Content-Type` headers on every request.
- **SDK-SPEC.md §8** — timeouts, and the read-only retry policy (backoff, `Retry-After`).
- **SDK-SPEC.md §12** — the idempotency backlog note: writes are not retried today, and the retry
  policy must be a single, clearly-marked switch so it flips in one place once idempotency ships.
- **typescript-addendum.md §2** — the concrete choice of `fetch` + `AbortSignal.timeout` (TS-specific
  mechanism; every language SDK picks its own equivalent HTTP client and cancellation primitive).

Cancellation support and the exact bug list below were **not** originally in the spec — they were
added during this ticket in response to review feedback, then folded back into this design as the
correct, final shape. `mapHttpError` and the `SuqoError` hierarchy are Ticket 1's design; this
ticket only consumes them, it doesn't redefine them.

---

## 2. Decomposition

Four independently designable pieces, in dependency order:

| Step | Piece | Depends on |
|---|---|---|
| A | URL building | nothing |
| B | Retry policy | nothing |
| C | Signal combining (cancellation primitive) | nothing |
| D | The HTTP client itself | A, B, C, and Ticket 1's error hierarchy |

A, B, and C are deliberately pure and independent of each other and of any networking — they're
the kind of piece a language team can design and test in isolation before touching D at all.

---

## Step A — URL building

### Function contract

```
function buildUrl(baseUrl, path, query?) -> string
```

| Rule | Detail |
|---|---|
| Trailing slash | If the *path portion* doesn't already end in `/`, one is added. Never assume the caller got it right — this is the SDK's last line of defense for SDK-SPEC.md §3, not a courtesy. **Must be checked against the parsed path, not the raw input string** — see the correction below. |
| Query placement | Query parameters are appended **after** the trailing slash: `.../products/?page=2`. |
| Omitted values | A query value that is absent/null is skipped entirely, not sent as an empty parameter — so a caller can pass `{ page, pageSize }` straight through without pre-filtering. |
| Absolute-URL input | `path` may also be an already-complete absolute URL with its own query string attached (e.g. a pagination `next` link, Ticket 3). `baseUrl` is then ignored, and any existing query string is preserved untouched; additional `query` params are merged in on top rather than replacing what's there. |

**Correction (2026-08-21, found while building Ticket 3):** the original implementation checked
"does the *raw input string* end in `/`" before parsing it as a URL. That's only safe when `path`
is a bare relative path with no query string. The moment `path` is an already-complete URL with a
query string attached (exactly `listAll`'s `fetchNext` contract), checking the raw string is wrong
— it appends `/` after the query string instead of after the path, silently corrupting whichever
query parameter happens to be last (`page_size=50` became `page_size=50/`, reproduced and
confirmed). **The fix, and the rule any language's equivalent must follow: parse into a URL object
first, then check/fix the trailing slash on the parsed path component specifically — never on the
raw input string.**

### Conformance checklist — Step A

- [ ] `buildUrl(base, "/api/v1/products")` → ends in `/api/v1/products/`.
- [ ] `buildUrl(base, "/api/v1/products/")` → unchanged, not doubled to `//`.
- [ ] Query parameters land after the slash, in the order given.
- [ ] A query value that's absent produces no parameter at all for that key.
- [ ] An already-complete absolute URL with an existing query string (e.g.
      `.../subscriptions/?page=2&page_size=50`) passes through **unchanged** — no query parameter
      is corrupted by a stray trailing slash.
- [ ] Additional query params merge onto an absolute URL's existing ones rather than replacing them.

---

## Step B — Retry policy

Three pure decisions plus one pure calculation — no networking, no classes, just functions and a
couple of named constants.

### Function contracts

```
function isRetryableMethod(method) -> boolean
function isRetryableFailure(networkError: boolean, status?: integer) -> boolean
function backoffDelayMs(attempt: integer) -> integer
function parseRetryAfterMs(headerValue: string or null) -> integer or undefined
```

| Function | Rule |
|---|---|
| `isRetryableMethod` | **Single switch** (SDK-SPEC.md §8, §12): only `GET` returns `true` today. Every read in this API is `GET`, every write is `POST`; writes never retry because the backend has no idempotency keys yet. The moment it does, this is the one function that flips. |
| `isRetryableFailure` | `true` if there was no response at all (network failure), or if the response status is `429`, or a `5xx`. `false` for everything else (400/401/403/404). |
| `backoffDelayMs(attempt)` | "Full jitter": a random value between `0` and `min(MAX_DELAY_MS, BASE_DELAY_MS × 2^attempt)`. `BASE_DELAY_MS = 500`, `MAX_DELAY_MS = 8000` (SDK Naming Map v1.1 — corrected from an earlier 200/5000, a value mismatch, not a naming one). `attempt` is 0-indexed (0 = the first retry). |
| `parseRetryAfterMs` | Parses a `Retry-After` header into milliseconds, clamped to `MAX_RETRY_AFTER_MS = 60000`. Accepts **both** forms RFC 7231 §7.1.3 allows: the numeric seconds-delta form (`"5"`) and the HTTP-date form (`"Wed, 21 Oct 2026 07:28:00 GMT"`) — accepting only the former was a real functional gap, flagged by SDK Naming Map v1.1 as "a common bug," since real servers and the load balancers in front of them send either form. An HTTP-date already in the past resolves to `0` (retry now), never negative. Returns "unparseable" (not `0`) for: a `null`/missing header, a negative numeric value, a value that's neither a valid number nor a valid date, **and an empty or whitespace-only value** — a naive `string-to-number` cast in several languages (JavaScript included) turns `""` into `0`, which must be special-cased explicitly rather than trusted. |

### Conformance checklist — Step B

- [ ] `isRetryableMethod("GET")` is `true`; `isRetryableMethod("POST")` is `false`.
- [ ] A network failure (no response) is always retryable.
- [ ] `429` and every `5xx` are retryable; `400`/`401`/`403`/`404` are not.
- [ ] `backoffDelayMs(0)` never exceeds `500`; `backoffDelayMs` at a high attempt number never
      exceeds `8000` regardless of how large the exponent grows.
- [ ] `parseRetryAfterMs("5")` → `5000`. `parseRetryAfterMs("86400")` → clamped to `60000`, not the
      literal day-long value. `parseRetryAfterMs("")`, `parseRetryAfterMs("   ")`, and
      `parseRetryAfterMs(null)` all → "unparseable," never `0`.
- [ ] `parseRetryAfterMs` also accepts the HTTP-date form: a date 10s in the future → `~10000`; a
      date already in the past → `0`, not negative or "unparseable"; a date far enough out clamps
      to `60000` exactly like the numeric form does.

---

## Step C — Signal combining (the cancellation primitive)

Every language needs *some* way to say "stop this in-flight operation." This step defines the
shape of that primitive independently of HTTP.

### Function contract

```
function combineSignals(signals: list of Signal-or-null) -> { signal: Signal, cleanup: () -> void }
```

| Rule | Detail |
|---|---|
| Combining | The returned `signal` fires as soon as **any** input signal fires. If one is already fired at call time, the returned signal is immediately in the fired state too. |
| Cleanup is mandatory | Every listener this function attaches to an input signal **must** be removed once the combined signal is no longer needed — call `cleanup()` when the operation it was guarding finishes, on every exit path (success, failure, or the signal firing). Skipping this leaks one listener per call on any long-lived signal a caller reuses across multiple operations (e.g. one signal shared across a paginated series of calls). |

This exact shape exists because of a real bug: an earlier version of Step D combined signals
inline without a cleanup step, and leaked a listener on the caller's signal every single retry
attempt.

### Conformance checklist — Step C

- [ ] The combined signal fires when any one input fires, and carries that input's reason/cause.
- [ ] An already-fired input signal produces an already-fired combined signal, not a delayed one.
- [ ] `undefined`/`null` entries in the input list are ignored, not errors.
- [ ] After `cleanup()` is called, firing an input signal that didn't already fire has **no**
      further effect — precisely provable by asserting the listener count on that input signal is
      `0` after cleanup, not just "the program didn't crash."

---

## Step D — The HTTP client

### Class diagram

```mermaid
classDiagram
  class HttpClient {
    -config: SdkConfig  «hidden»
    -sleep: function(ms) -> Promise  «hidden, injectable for tests»
    +request(options) Promise~TResponse~
  }
  HttpClient --> SdkConfig : reads baseUrl, apiKey, timeout, maxRetries, dispatcher
```

### Constructor input contract

| Input field | Type | Required? |
|---|---|---|
| `config` | `SdkConfig` (Ticket 1) | yes |
| `sleep` | function, `(ms) -> Promise/void` | no — defaults to a real timed wait; overridable so tests don't wait through real delays |

### `request()`'s input contract

`request()` takes one options object per call:

| Field | Type | Required? | Notes |
|---|---|---|---|
| `method` | `"GET"` or `"POST"` | yes | Every route in this API is one of these two. |
| `path` | string | yes | Passed through `buildUrl` (Step A) — never pre-slash it yourself. |
| `query` | map of string to scalar, optional | no | Same omission rule as Step A. |
| `body` | request-shape, generic | **only on `POST`** | A `GET` cannot carry a body — enforced at the type level where the language supports it (a union/variant type with two cases, one per method), and defensively at runtime regardless, so a caller that bypasses the type system still fails loudly and immediately rather than the request reaching the network layer malformed. |
| `timeoutMs` | integer, optional | no | Defaults to `SdkConfig.timeout`. Bounds each individual attempt, not the whole call including retries. Per-call option keeps the `Ms` suffix (it's an override parameter, not the resolved config field the naming map's rename targets) — see Ticket 1's design doc for the `SdkConfig.timeout` rename. |
| `signal` | Signal, optional | no | Caller-supplied cancellation (Step C). Combined with the per-attempt timeout signal. |

### The request algorithm

```
function request(options) -> TResponse:
  reject immediately if options.method == "GET" and options.body is present

  url = buildUrl(config.baseUrl, options.path, options.query)
  retryable = isRetryableMethod(options.method)
  maxAttempts = retryable ? config.maxRetries + 1 : 1
  timeoutMs = options.timeoutMs ?? config.timeout

  for attempt = 1, 2, 3, ... :
    isLastAttempt = attempt >= maxAttempts

    try:
      response = doFetch(url, options, timeoutMs)   # see below

      if response.ok:
        return parse(response.body)

      body = parse(response.body)                    # a read failure here is treated as a
                                                       # network failure below, not swallowed
      retryAfter = response.status == 429 ? parseRetryAfterMs(header) : undefined

      if not isLastAttempt and retryable and isRetryableFailure(false, response.status):
        sleepOrAbort(retryAfter ?? backoffDelayMs(attempt - 1), options.signal)
        continue

      throw mapHttpError(response.status, response.statusText, body, retryAfter)  # Ticket 1

    catch cause:
      if cause is already a mapped SDK error: rethrow unchanged   # don't reclassify a final decision
      callerCancelled = options.signal is fired
      if not callerCancelled and not isLastAttempt and retryable and isRetryableFailure(true):
        sleepOrAbort(backoffDelayMs(attempt - 1), options.signal)
        continue
      throw toNetworkError(cause, timeoutMs, callerCancelled)

doFetch(url, options, timeoutMs):
  headers = { Authorization: "Bearer " + config.apiKey }
  if options.method != "GET": headers["Content-Type"] = "application/json"
  { signal, cleanup } = combineSignals([timeout-signal(timeoutMs), options.signal])
  try:
    return http_call(url, options.method, headers, options.body, signal, config.dispatcher)
  finally:
    cleanup()   # always, on every exit path — see Step C
```

`sleepOrAbort(ms, signal)` waits `ms`, but rejects immediately — before the full wait elapses — if
`signal` fires during the wait. A caller cancelling mid-backoff does not have to wait for the
sleep to finish first.

### Conformance checklist — Step D

- [ ] Every request carries `Authorization: Bearer <key>`.
- [ ] Every non-`GET` request carries `Content-Type: application/json`, **even when it has no
      body** (e.g. a bodyless write) — the header is tied to the method, not to body presence.
- [ ] A `GET` with a body is rejected before any network call is attempted, both when caught by
      the type system and when the type system is bypassed.
- [ ] A read that fails with a network error, `429`, or `5xx` is retried up to
      `config.maxRetries` additional times; a write never retries regardless of the failure.
- [ ] A response-body read failure (the connection succeeds, then dies while streaming the body)
      is retried/mapped exactly like a `doFetch` failure — it never escapes as an unmapped error.
- [ ] A `429` with a valid `Retry-After` sleeps that value instead of the computed backoff; an
      invalid/absent one falls back to computed backoff.
- [ ] Cancelling via `options.signal` — whether before the call starts, during the network call,
      or during a retry's backoff wait — always ends the call with a "cancelled" error and never
      triggers a further retry attempt.
- [ ] `cleanup()` (Step C) runs after every single attempt, success or failure, so a signal reused
      across many calls never accumulates listeners.

---

## Design decisions & rationale

1. **Timeout bounds each attempt, not the whole call.** With defaults (30s timeout, 2 retries), a
   slow backend could make one `request()` call take well over a minute end to end. This was a
   deliberate choice, not an oversight — each retry attempt needs its own full timeout budget, the
   same way most HTTP client libraries handle it — but it's worth stating explicitly since the
   alternative (an overall deadline across all attempts) is an equally reasonable design a
   language team might otherwise default to without realizing there's a choice here at all.

2. **A caller cancellation is never retried, even for an otherwise-retryable read.** Retrying
   after the caller explicitly asked to stop would silently ignore what they asked for. This is
   treated as categorically different from a network failure, even though both surface as the
   same error class (`NetworkError`).

3. **The retry-eligibility decision always routes through `isRetryableFailure`, never inlined.**
   Even the "a network failure is always retryable" case — which looks like a constant — must
   call through the function rather than hardcode `true` at the call site. Two code paths encoding
   the same policy independently will eventually drift if the policy ever changes in only one of
   them.

4. **Renamed `RateLimitError.retryAfterMs`→`retryAfter` and `SdkConfig`/`SuqoClientOptions.
   timeoutMs`→`timeout` (2026-08-21).** SDK Naming Map v1.1: SDK-surface fields drop the `Ms`
   suffix (the unit is documented, not encoded in the name). Purely renames — no field, no wire
   shape changed. The per-call `request()` option `timeoutMs` is unaffected — it's an override
   parameter, not the resolved config field the map's rule targets. Also corrected `BASE_DELAY_MS`/
   `MAX_DELAY_MS` from `200`/`5000` to `500`/`8000` (a value fix, not a naming one), and taught
   `parseRetryAfterMs` to accept the HTTP-date form of `Retry-After`, not just delta-seconds — a
   real functional gap the map flagged as "a common bug." Applied retroactively to already-shipped
   Ticket 1/2 code, since this document and the map are both meant to be the same source of truth
   going forward.

---

## What's intentionally not in this doc

- The `SuqoError` hierarchy and `mapHttpError` — Ticket 1's design doc.
- Resource methods that will call `HttpClient.request()` (`products.list()`, etc.) — Ticket 4.
- Contract/mock-server testing strategy — Ticket 7.
