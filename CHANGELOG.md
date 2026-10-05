# Changelog

All notable changes to `@suqo/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/) per [`specs/versioning.md`](specs/versioning.md).

## [Unreleased]

## [2.0.0] - 2026-10-05

**Why a major:** the API changed its wire contract within `/api/v1/` — the checkout webhook
payload and the customer create body — which `specs/versioning.md` says always forces a new SDK
major. This release also brings the SDK up to the API's full surface: checkout sessions,
subscription retrieve/renew and webhook management.

### Changed

- **Breaking:** `CheckoutSucceededEvent` / `CheckoutFailedEvent` match the API's new payload: one
  delivery per checkout session, `{ event, session_id, amount, status, items }`, with no
  `subscription_id`. Payments taken through `subscriptions.create()` report the same way.
  _Upgrading:_ match deliveries on `session_id` (the `publicId` a session was opened with), not
  `subscription_id`.
- **Breaking:** `customers.create()` requires `email`, which now identifies the buyer; `phone` is
  optional. An email or phone you already hold updates that customer. _Upgrading:_ pass `email` on
  every `customers.create()` call.
- **Breaking:** a `403` is `KycRequiredError` only when its body carries `status_code`. Any other
  `403` (`detail` alone, e.g. a key that doesn't belong to the account) is the new
  `PermissionDeniedError`. _Upgrading:_ code that caught `KycRequiredError` for every 403 should
  also catch `PermissionDeniedError` (or the base `SuqoError`).
- **Breaking:** `Product.description`, `termsAndConditions`, `featuresAndBenefits`, `Plan.description`,
  `ProductVat.vatType` and `ProductVat.vatPercentage` are now `| null` — the API sends null for
  them. _Upgrading:_ handle `null` where you read these as plain strings.
- **Breaking:** `BillingPeriod.offers` is typed `Offer[]` instead of `unknown[]`.
- `Product.type`, `ProductVat.vatType` and `BillingPeriod.intervalType` list their known values
  (`simple`/`tiered`, `inclusive`/`exclusive`, `day`…`one_time`) for autocomplete, while still
  accepting a value the API adds later.
- `subscriptions.create()` is documented as **legacy** — prefer `checkoutSessions.create()`. A buyer
  may hold one live recurring subscription per product; an inactive one is restarted with
  `subscriptions.renew()`, not by creating a new one.

### Added

- `checkoutSessions.create({ items, returnUrl, customerId? })` — the recommended way to collect
  payment: one to ten catalogue (`{ pbpId }`) or partner-priced items in one checkout. Never
  retried automatically; rate-limited to 20 a minute.
- `checkoutSessions.retrieve(id)` — reads an open session.
- `subscriptions.retrieve(id)` and `subscriptions.renew(subscriptionId)`.
- Webhook management: `webhooks.list()`, `create()`, `retrieve()`, `replace()` (PUT), `update()`
  (PATCH), `delete()`, `retrieveSecret()` and `testDelivery()`. `webhooks.verify()` is unchanged.
- `PermissionDeniedError`, plus the new model types (`CheckoutSession`, `CheckoutSessionResponse`,
  `CreateCheckoutSessionParams`, `CheckoutItemInput`, `Webhook`, `WebhookSecret`, `Offer`, …).

### Fixed

- A `400` whose body is a bare list of messages (cancel, resume, renew, duplicate subscription) now
  surfaces those messages as `ValidationError.message` instead of `"Validation failed."`.
- `subscriptions.cancel()`/`resume()` reject an empty, `"."` or `".."` id with `SuqoConfigError` before any request — `cancel("..")` used to POST to `/api/v1/cancel/`. Every method that takes an id in the path now checks it the same way, and the webhook methods also reject `"secret"`, which would hit the signing-secret route.
- `RateLimitError.retryAfter` is filled from the wait the API writes into `detail` when no
  `Retry-After` header is sent — which is how the API's rate limit answers today.

### Docs

- `SDK-SPEC.md` §1, §5, §7–§11 and §13, `specs/versioning.md` and `specs/openapi.yaml` updated to
  the API as of 2026-10-02. `subscriptions.retrieve()` and the new checkout webhook payload are
  built from the API docs and Swagger and not yet checked against captured responses.

## [1.1.0] - 2026-09-24

**This release is a deliberate exception to the MAJOR rule.** The three type changes
below are technically SDK-only breaking changes (`specs/versioning.md`'s MAJOR trigger 2), but
they correct types that never matched the wire — the declared `number` id made
`customers.retrieve()` uncallable with a real id — so they're shipped as a minor release. See
`specs/versioning.md`'s "Recorded exceptions". Upgrading from `1.0.0` may need the small code
changes noted under each item.

### Added

- `customers.create({ phone, fullName?, email?, address? })` — records a customer without opening
  a subscription (`POST /customers/`). A phone you already hold updates that customer instead, so
  it's safe to retry yourself; the SDK never retries it automatically.
- `customers.update(id, { fullName?, email?, address? })` — updates only the given fields
  (`PATCH /customers/{id}/`); `""` clears a field. The phone can't be changed.
- `CreateCustomerParams`, `UpdateCustomerParams` and `ProductImage` types exported.

### Changed

- **Breaking:** `Product.productImage` corrected from `string[]` to `ProductImage[]`
  (`{ image: string; imageOrder: number }`) — the API sends image objects, not bare URLs. At
  runtime you were already getting objects (the SDK passed them through untouched, as
  `{ image, image_order }`); now they're typed and camelCased.
  _Upgrading:_ replace `product.productImage[i]` used as a URL with `product.productImage[i].image`,
  and read `imageOrder` instead of `image_order` — code that relied on the old untyped runtime
  shape (e.g. through a cast) gets `undefined` from `image_order` now, with no error.
- **Breaking:** `Customer.id` corrected from `number` to `string` — the API has always returned
  an opaque prefixed id (e.g. `"cus_1ce18d624"`), like `pbp_...` on billing periods, never an
  integer; the `number` type made `customers.retrieve()` uncallable as declared. ([#42])
  _Upgrading:_ anywhere you typed a customer id as `number` (variables, `Map<number, …>` keys,
  `retrieve(123)`), switch it to `string`.
- **Breaking:** `Customer.address` added as a required property (`string | null`) — previously
  present on the wire but entirely missing from the type, silently dropped. Breaks any consumer
  constructing a `Customer` literal themselves (e.g. in their own test fixtures) without it.
  _Upgrading:_ add `address: null` (or a real value) to any hand-built `Customer` objects.

### Fixed

- `customers.retrieve("")` (and `"."`/`".."`, which URL parsing resolves the same way) now throws
  `SuqoConfigError` instead of silently colliding with
  `list()`'s own URL and returning a `Customer` of all-undefined fields with no error — a risk the
  `number` → `string` change above newly made reachable (found in review of that same change).
- `Customer.address` degrades to `null` when the wire omits the key entirely (spec-legal —
  `openapi.yaml` never lists `address` as required) instead of silently becoming `undefined` while
  the type still promised `string | null` — the same class of bug as this ticket itself.
- `Customer.buyerPhone`/`buyerEmail`/`fullName` get the same `null`-on-omitted-key fix as
  `address` above — none of the four are required by the schema, so all four needed it.
- `docs/design/ticket-4-resources.md` and `docs/user/customers.md` corrected to match.
- `SDK-SPEC.md` §9 named the status-change webhook `subscription.status.change`; the real event is
  `subscription.status_changed` (the SDK's types already used the right name).

[#42]: https://github.com/suqo-ai/suqo-sdk-ts/issues/42

## [1.0.0] - 2026-09-10

### Added

- `SuqoClient` — environment (sandbox/live) inferred automatically from the API key prefix, with
  `SuqoConfigError` thrown before any request on a malformed key or a conflicting `baseUrl` override.
- `products.list()` / `.autoPaging()` — browse the seller's product catalog. Works before KYC.
- `subscriptions.list()` / `.create()` / `.cancel()` / `.updateBillingCycle()` / `.resume()` /
  `.autoPaging()` — full subscription lifecycle, including create-time reuse of an
  inactive/expired subscription for the same buyer + product + billing period.
- `customers.list()` / `.retrieve()` — read-only access to the seller's customer records.
- `webhooks.verify()` — HMAC-SHA256 signature verification for inbound webhook deliveries, with
  replay protection via a configurable timestamp tolerance. Makes no network call.
- Automatic retries with exponential backoff and jitter for read operations, on `NetworkError`,
  `429`, and `5xx` — honoring a `Retry-After` header when present. Writes are never auto-retried
  (no idempotency-key support yet on the backend — see
  [`docs/user/idempotency.md`](docs/user/idempotency.md)).
- Full `SuqoError` hierarchy (`SuqoConfigError`, `AuthenticationError`, `KycRequiredError`,
  `ValidationError`, `NotFoundError`, `RateLimitError`, `ServerError`, `NetworkError`) — every
  documented failure mode normalized to a class, never a wire-shape check.
- Dual ESM + CommonJS build with bundled `.d.ts`, zero runtime dependencies.
- Full user-facing documentation under [`docs/user/`](docs/user/) — authentication, every
  resource, pagination, errors, and the planned rate-limiting/idempotency behavior.

### Changed

- Licensed under MIT, matching every comparable payments SDK (Stripe, Twilio, Square, Adyen,
  Plaid, Braintree). Supersedes an earlier, never-published Apache-2.0 declaration.

### Fixed

- Corrected the sandbox base URL (`test.be.suqo.ai`, which did not resolve) to the real sandbox
  host, `test-be.suqo.ai`.
- `subscriptions.cancel()`/`.resume()` now URL-encode the subscription id — an id containing `?`,
  `#`, or `/` was previously parsed as URL structure instead of a literal path segment, silently
  corrupting the request.
- Automatic retries now honor a `Retry-After` header on any retried status, not just `429` — a
  retried `5xx` carrying the header (e.g. a `503` during a maintenance window) was previously
  retried on computed backoff instead of the server's requested wait.

[Unreleased]: https://github.com/suqo-ai/suqo-sdk-ts/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/suqo-ai/suqo-sdk-ts/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/suqo-ai/suqo-sdk-ts/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/suqo-ai/suqo-sdk-ts/tree/v1.0.0
