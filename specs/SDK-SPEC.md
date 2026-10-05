# SUQO SDK — Build Specification

**Status:** Draft · **Version:** 1.0.0 · **Spec target:** SUQO External API `v1`

This document is the language-agnostic contract every SUQO SDK must satisfy. It
sits on top of [`openapi.yaml`](./openapi.yaml), which is the machine-readable
source of truth for endpoints, request/response schemas, and errors. Where this
document and the OpenAPI file overlap, the OpenAPI file wins for *wire shapes*;
this document governs *SDK behaviour* (config, retries, errors, iteration,
versioning).

A correct SDK in any language behaves identically: same resource namespaces,
same method names, same error taxonomy, same environment inference. A developer
who reads the TypeScript reference can predict the Python behaviour.

---

## 1. Scope

The SDK wraps exactly the documented API surface:

| Resource         | Operations                                                                                          | Status          |
| ---------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| Products         | `list`                                                                                              | Specified       |
| Checkout sessions | `create`, `retrieve`                                                                               | Specified       |
| Subscriptions    | `list`, `retrieve`, `create` (legacy), `cancel`, `resume`, `renew`, `updateBillingCycle`            | Specified       |
| Customers        | `list`, `retrieve`, `create`, `update`                                                              | Specified (§11) |
| Webhooks         | `verify` (local, no HTTP); `list`, `create`, `retrieve`, `replace`, `update`, `delete`, `retrieveSecret`, `testDelivery` | Specified       |

The SDK is **server-side only**. The API key is full-access and scoped to a
seller account; it must never reach a browser. Every language package states
this prominently in its README.

---

## 2. Environments & key-prefix inference

The SDK selects the environment **from the API key prefix** — the developer does
not pass an environment flag in the normal case.

| Key prefix     | Environment | Base URL                    |
| -------------- | ----------- | --------------------------- |
| `su_test_key_` | Sandbox     | `https://test-be.suqo.ai`   |
| `su_key_`      | Live        | `https://be.suqo.ai`        |

Rules:

1. **Infer by prefix.** On construction, inspect the key and set the base URL
   accordingly. This is the whole configuration in the common case.
2. **Malformed key → fail at construction.** A key matching *neither* prefix is a
   configuration error, not a runtime API error. The SDK MUST throw a dedicated
   **configuration/validation error** (see §7, `SuqoConfigError`) *before any
   request is made*, with a message that names the problem clearly, e.g.
   `Malformed SUQO API key: expected prefix "su_key_" (live) or "su_test_key_"
   (sandbox).` Fail fast; never guess an environment.
3. **Explicit override is allowed but must agree.** The constructor MAY accept an
   explicit `baseUrl`/environment. If it is supplied *and conflicts* with the key
   prefix (e.g. a `su_test_key_` pointed at the live host), the SDK MUST throw
   `SuqoConfigError`. Agreement passes; silence-and-trust-one is forbidden — a
   mismatch is almost always a mistake and the class of bug it prevents
   (test traffic hitting live) is expensive.
4. **Prefix→environment is a stable, enforced contract** (confirmed by SUQO). The
   SDK may rely on it. If SUQO ever introduces a new prefix, that is a spec change
   handled by a new SDK release, not silent inference.

> Prefix parsing looks only at the leading marker. Order matters: check
> `su_test_key_` **before** `su_key_`, since the live prefix is a substring
> consideration for naive matchers. Treat the match as "starts with".

---

## 3. Trailing slash — mandatory

Every route ends in `/`. The SDK MUST always send the trailing slash on every
request path.

- A `GET` without it 301-redirects (recoverable but wasteful).
- A `POST`/write without it **fails** — the redirect cannot preserve the body.

The SDK builds URLs so the trailing slash is structurally guaranteed, not
left to the caller. Query strings attach after the slash:
`/api/v1/subscriptions/?page=2&page_size=50`.

---

## 4. Authentication

Single mechanism: `Authorization: Bearer <api_key>`, set once at construction and
attached to every request. There is **no** `X-Api-Key` header. `Content-Type:
application/json` is sent on write operations.

The SDK never logs, prints, or serializes the key. When the client is
inspected/stringified for debugging, the key is redacted.

---

## 5. Public surface (identical across languages)

Namespaced resource objects hang off a single client. Concept names are constant
across languages; only casing/idiom adapts.

```
client.products.list({ page?, pageSize? })
                 -> paginated Product list

client.checkoutSessions.create({ items, returnUrl, customerId? })
                 -> CheckoutSessionResponse { publicId, expiresAt, checkoutUrl }
                    (recommended way to collect payment; 1-10 items; rate-limited, §10)
client.checkoutSessions.retrieve(id)
                 -> CheckoutSession   (open sessions only; 404 once paid/expired)

client.subscriptions.list({ page?, pageSize? })
                 -> paginated Subscription list + status counts
client.subscriptions.retrieve(id)
                 -> Subscription
client.subscriptions.create({ pbpId, returnUrl, customer })
                 -> CreateSubscriptionResponse (status: pending_checkout, checkout_url)
                    (legacy — prefer checkoutSessions.create)
client.subscriptions.cancel(id)
                 -> { message }
client.subscriptions.resume(id)
                 -> { message }
client.subscriptions.renew(subscriptionId)
                 -> CheckoutSessionResponse   (POST /subscription/renew/, singular)
client.subscriptions.updateBillingCycle({ subscriptionId, nextBillingCycle })
                 -> { message }

client.customers.list({ page?, pageSize? })
                 -> paginated Customer list
client.customers.retrieve(id)
                 -> Customer
client.customers.create({ email, phone?, fullName?, address? })
                 -> Customer   (an existing email or phone updates that customer instead)
client.customers.update(id, { fullName?, email?, address? })
                 -> Customer   (PATCH; only the given fields change, "" clears)

client.webhooks.verify({ rawBody, signature, timestamp, secret })
                 -> boolean   (no network call; see §9)
client.webhooks.list() / .create(params) / .retrieve(id)
client.webhooks.replace(id, params)   (PUT — full overwrite)
client.webhooks.update(id, params)    (PATCH — only the given fields)
client.webhooks.delete(id)            (204, resolves void)
client.webhooks.retrieveSecret()      -> { signingSecret }
client.webhooks.testDelivery(id)      (202, resolves void)
```

- **Decimal fields are strings.** `price`, `amount`, `total_subscribers`, etc.
  arrive as strings to avoid float rounding. The SDK MUST NOT coerce them to
  floats. Expose them as strings (or a decimal type), never `number`.
- **`client` on the wire is `customer` on the SDK surface.** The API's create
  payload and every subscription's embedded record use the key `client`
  (`specs/openapi.yaml`) — the SDK renames it to `customer` at the
  serialization boundary in both directions, since `client` collides with the
  SDK's own client object. `rawBody` is never translated. See SDK Naming Map
  v1.1's rename register and Customer-boundary section for the full rule,
  including the three distinct customer-shaped types this implies.
- **Do not treat `return_url`/`checkout_url` as payment confirmation.** The
  `create` result gives a `checkout_url` to redirect the buyer to; the true
  outcome arrives via webhooks (§9). SDK docs must say so at the `create` method.

---

## 6. Pagination

Page-number pagination. Query params `page` (default 1) and `page_size`
(default 20, max 100). Envelope:

```json
{ "count": 150, "next": "…?page=2", "previous": null, "results": [ … ] }
```

The Subscriptions list extends the envelope with `total_subscriptions`,
`active_subscriptions`, `due_subscriptions`, `inactive_subscriptions`. The SDK
surfaces those extra counts on the returned list object without breaking the
common envelope shape.

The SDK SHOULD provide an **auto-iterator** that walks pages by following `next`
until it is null, so callers can stream all rows without manual page math. Manual
`page`/`pageSize` access remains available.

---

## 7. Error taxonomy

The mapper MUST accept every shape the API sends, and decide by the body,
never the status alone:

- Field validation: `{ "field": ["msg"] }` (value may be a string or an array).
- General: `{ "detail": "msg" }`.
- Bare list (400 on endpoints with no body to key on — cancel, resume, renew —
  and the duplicate-subscription error): `["msg", …]`.
- KYC 403: `{ "status_code": "KYC_INCOMPLETE" | "KYC_VERIFICATION_PENDING", "message": "…" }`, no `detail`.
- Any other 403: `{ "detail": "msg" }` alone.

Normalized hierarchy (same names, idiomatic casing per language):

| Class                 | Raised on                                         | Notes                                              |
| --------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `SuqoError`           | base — never thrown directly                      | carries `status`, `rawBody`, best-effort `message` |
| `SuqoConfigError`     | a mistake caught before any request is attempted  | **malformed key**, env/prefix conflict (§2); also a bad call-time argument that would otherwise silently misdirect a request, e.g. an empty `customers.retrieve(id)` |
| `AuthenticationError` | `401` (`detail: "Invalid or inactive API key."`)  |                                                    |
| `KycRequiredError`    | `403` whose body carries `status_code`            | exposes `kycStatus` (the KYC status)               |
| `PermissionDeniedError` | `403` any other body (`detail` alone)           | not `PermissionError` — a Python builtin (Naming Map R2) |
| `ValidationError`     | `400`                                             | exposes `fieldErrors: Record<string,string[]>`     |
| `NotFoundError`       | `404`                                             |                                                    |
| `RateLimitError`      | `429`                                             | live on `checkoutSessions.create` (§10); exposes `retryAfter` |
| `ServerError`         | `5xx`                                             |                                                    |
| `NetworkError`        | transport failure / timeout                       |                                                    |

`ValidationError` normalizes all three 400 shapes: field-keyed bodies populate
`fieldErrors`; a `detail`-shaped or bare-list 400 (e.g. the duplicate
subscription case, or cancelling a one-time purchase) populates `message`
with `fieldErrors` empty. Consumers can rely on the class, not the wire shape.

`SuqoConfigError` is deliberately distinct from the HTTP errors: it signals a
programmer/config mistake caught before any request is attempted — whether that's
at `SuqoClient` construction, or a call-time argument that would otherwise silently
misdirect a request — analogous to a syntax error in the integration.

---

## 8. Retries, timeouts, reliability

- **Connection reuse / keep-alive** on by default.
- **Configurable timeout**, sane default (e.g. 30s).
- **Retry policy:**
  - **Reads** (every `GET`: `list`, `retrieve`, `retrieveSecret`) are
    naturally idempotent → retry on `NetworkError`, `429` and `5xx`, with
    exponential backoff + jitter, bounded attempts.
  - **Writes** (every `POST`, `PATCH`, `PUT` and `DELETE` — `create`, `cancel`,
    `resume`, `renew`, `updateBillingCycle`, `update`, `replace`, `delete`,
    `testDelivery`) are **NOT retried** automatically. The API does not yet
    support idempotency keys, so a retried write could double-act (a retried
    `subscriptions.create` opens a second subscription and checkout). See §12
    (backlog). This restriction is a single, clearly-marked switch in the retry
    layer so it flips to "retry with idempotency key" in one place once the
    backend ships it.
- Respect `Retry-After` when present. The API's own rate limit sends none and
  names the wait inside `detail` ("…available in 41 seconds"); the SDK reads
  that as a fallback, capped at 60 s, and surfaces it as
  `RateLimitError.retryAfter`.

---

## 9. Webhooks (verification helper)

The SDK ships a signature-verification helper. It makes **no** network calls — it
validates an inbound delivery from SUQO.

Delivery headers: `X-SUQO-Signature: sha256=<hex>`, `X-SUQO-Timestamp: <unix
seconds>`, `Content-Type: application/json`, `User-Agent: SUQO-Webhooks/1.0`.

Signature = `HMAC-SHA256(key = signing secret, message = "<timestamp>" + "." +
<raw body bytes>)`, hex-encoded, prefixed `sha256=`.

The helper MUST:

1. Operate on the **raw request-body bytes** — never a parsed-and-reserialized
   body. SDK docs warn about JSON body-parser middleware mounted ahead of the
   webhook route (the usual "signature never matches" cause).
2. **Constant-time compare** (`crypto.timingSafeEqual` / `hmac.compare_digest`).
3. Support a caller-supplied **max-age** (default ~5 minutes) and reject stale
   timestamps to defeat replay.

Event payloads (`checkout.succeeded`, `checkout.failed`,
`subscription.status_changed`, and the `api_key.*` events — `api_key.created`,
`api_key.deleted`, `api_key.expiring_soon`, `api_key.expired`) are documented
as types. `amount` is a **decimal
string** — never parse to float. Note the test-delivery body differs (fields
under `data`); the helper verifies signatures for it but callers should not use
it to exercise payload parsing.

**Checkout events (changed in 2.0.0).** `checkout.succeeded` and
`checkout.failed` are sent once per checkout session, not once per
subscription: `{ event, session_id, amount, status, items }`. `session_id` is
the `cks_…` returned as `publicId` when the session was opened; `amount` is the
session total; each entry in `items` echoes what was sent — `{ pbp_id }` for a
catalogue item, `{ name, amount, interval_type, interval_count }` for a
partner-priced one. They no longer carry `subscription_id`. Payments taken
through the legacy `subscriptions.create` report through the same payload.

Registrations are managed over HTTP by the `webhooks` resource (§5): one
webhook per event per account, `https` endpoints resolving only to public
addresses. The signing secret comes from `webhooks.retrieveSecret()`.

The SDK never stores the signing secret; it is passed into the verify call by the
host application.

---

## 10. Rate limiting

Rate limiting is enforced on **one** endpoint: `POST /checkout-sessions/`
(`checkoutSessions.create`), 20 sessions a minute per account. Every other
endpoint is unlimited.

- Past the limit the API answers `429` with the wait inside `detail`
  (`"Request was throttled. Expected available in 41 seconds."`) and no
  `Retry-After` or `RateLimit-*` headers. The SDK throws `RateLimitError`
  (§7) with `retryAfter` read from the header if present, otherwise from that
  text.
- `checkoutSessions.create` is a write, so the SDK never retries it (§8): the
  caller decides whether and when to retry, using `retryAfter`.
- The read-retry path still honours `Retry-After`, so a future limit on a read
  needs no behavioural change.

---

## 11. Customers

Specified in `openapi.yaml` (`listCustomers`, `retrieveCustomer`,
`createCustomer`, `updateCustomer`). The resource was reserved as a stub until
`list`/`retrieve` were confirmed, then un-stubbed; `create`/`update` followed
once the API documented them. No delete exists.

- `id` is an opaque prefixed string (`cus_…`), never a number.
- **`email` identifies the buyer (2.0.0).** `create` requires `email`; `phone`
  is optional. An email or phone the seller already holds updates that
  customer.
- **Write names differ from read names.** `create`/`update` send `phone` and
  `email`; the `Customer` reads them back as `buyer_phone`/`buyer_email`. The
  SDK keeps each side's own names rather than forcing one onto the other.
- `create` on an email or phone the seller already holds updates that
  customer (`200` instead of `201`), so it's safe for the caller to retry. The
  SDK still never retries it automatically (§8).
- A customer's `id` can be passed to `checkoutSessions.create` as `customerId`,
  which sends the buyer straight to payment.
- `update` is the API's one `PATCH` route: send only the changed fields; `""`
  clears one. The phone can't be changed.

Adding a resource like this is **additive**: add the paths + schemas to
`openapi.yaml`, add the methods, ship a minor version. No existing path, schema,
or method changes. This is the extension pattern for any future resource.

---

## 12. Backlog — idempotency (documented now, built later)

Idempotency is **cancelled for v1** but recorded here so it drops in cleanly:

- **Intended header:** `X-Idempotency-Key` on write operations (`create`,
  `cancel`, `updateBillingCycle`).
- **Intended SDK behaviour:** auto-generate a UUID key per write if the caller
  doesn't supply one; expose an override param; once present, flip writes to
  retryable in the §8 retry switch.
- **Blocking dependency:** the backend must honour the header (dedup on key)
  before the SDK may retry writes. Until then, writes stay non-retryable.
- **Docs:** a `docs/user/idempotency.md` stub ships from v1, marked *Planned*, so the
  concept and header name are published ahead of implementation.

---

## 13. Versioning (from day one)

- The SDK follows **SemVer**.
- **Major** = any breaking change: the API's wire contract breaking (with a new
  path version such as `/api/v2/`, or within the existing one — as in SDK
  `2.0.0`, still on `/api/v1/`), or the SDK breaking its own contract. The SDK
  major number therefore doesn't equal the API path version; see
  `specs/versioning.md` for the policy and the compatibility table.
- **Minor** = additive, backward-compatible (new resource like Customers, new
  optional param).
- **Patch** = fixes, no contract change.
- **Deprecation policy:** anything removed is deprecated one minor ahead with a
  documented warning, removed only at the next major.
- Every release ships a **CHANGELOG** entry. The published docs carry a version
  selector. v1 line starts at `1.0.0`.

---

## 14. Self-documenting requirement

- `openapi.yaml` is the single source. The `suqo.ai/docs/api` site and every
  per-language reference are **generated** from it, so human docs cannot drift
  from the wire contract.
- Every SDK method carries an inline docstring/TSDoc mirroring its OpenAPI
  `description`, including the trailing-slash and decimal-string caveats and the
  "checkout_url is not payment confirmation" note.
- The *Planned* stubs (rate limiting §10, idempotency §12) ship in the docs tree
  from v1 so those sections exist before the features do.

---

## 15. Testing

- **Contract tests:** each SDK runs against a mock server generated from
  `openapi.yaml`; request/response shapes are asserted against the spec so a wire
  drift fails CI.
- **Unit tests** for the behaviour this document owns: prefix→env inference
  (incl. malformed-key throw and env/prefix-conflict throw), trailing-slash
  construction, dual-shape error mapping, decimal-string preservation, pagination
  auto-iteration, webhook signature verification (positive, tampered-body,
  stale-timestamp, and the body-reserialization trap).
- **CI matrix** per supported runtime version; publish to the language's standard
  registry on tagged release.

---

## 16. Logging & observability

Added 2026-08-21, in response to a gap flagged in review (no logging existed anywhere in the SDK
or this spec — a genuine omission carried over from retiring the old RFC-based plan, not a
deliberate decision).

- **Opt-in, silent by default.** No log output of any kind unless the caller explicitly configures
  a log level at construction. A library that logs unprompted is a bad citizen inside a host
  application's own logging setup.
- **Levels:** `error` < `warn` < `info` < `debug`, each level including everything the levels below
  it log:
  - `error` — the final failure, right before it's thrown to the caller.
  - `warn` — adds retry attempts (a retry means something's not going smoothly and is worth
    surfacing, even if the overall call eventually succeeds).
  - `info` — adds a one-line summary per request: method, path, resulting status, duration.
  - `debug` — adds full detail per attempt: the outgoing request, each retry's computed backoff
    delay, cancellations.
- **Single hook point.** All logging originates from the HTTP layer (the fetch wrapper) — the one
  place every request, retry, timeout, and error already passes through. No other part of the SDK
  needs its own logging logic.
- **Metadata only — never the request/response body.** Even at `debug`, log lines carry method,
  path, status, timing, and retry counters — never the actual JSON payload. This SDK's requests
  routinely carry a buyer's name, phone, email, and address, plus financial amounts; logging full
  bodies at any level risks leaking that into a host application's own logs.
- **The API key is never logged, at any level** — this is the existing §4 rule, restated here
  because it's the one absolute exception the "even `debug` shows everything" idea does not
  override.
- **Pluggable output (optional, may land as a later addition to this same capability):** beyond a
  simple level setting that writes to the language's standard console/stderr, a caller may supply
  their own logger implementation (e.g. an app's existing Winston/Pino instance) so output routes
  wherever their application already sends logs. This is additive — a plain level setting must
  work correctly with zero extra configuration before this exists.
