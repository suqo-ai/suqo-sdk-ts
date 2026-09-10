# Changelog

All notable changes to `@suqo/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/) per [`specs/versioning.md`](specs/versioning.md).

## [Unreleased]

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

### Fixed

- Corrected the sandbox base URL (`test.be.suqo.ai`, which did not resolve) to the real sandbox
  host, `test-be.suqo.ai`.
- `subscriptions.cancel()`/`.resume()` now URL-encode the subscription id — an id containing `?`,
  `#`, or `/` was previously parsed as URL structure instead of a literal path segment, silently
  corrupting the request.
- Automatic retries now honor a `Retry-After` header on any retried status, not just `429` — a
  retried `5xx` carrying the header (e.g. a `503` during a maintenance window) was previously
  retried on computed backoff instead of the server's requested wait.

[Unreleased]: https://github.com/suqo-ai/suqo-sdk-ts/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/suqo-ai/suqo-sdk-ts/releases/tag/v1.0.0
