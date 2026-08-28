# Idempotency keys

> **Status: Planned.** Idempotency keys are cancelled for v1 — this page
> documents the intended header and behaviour now so it drops in cleanly once
> the backend supports it, rather than being bolted on later — see
> [`SDK-SPEC.md` §12](../../specs/SDK-SPEC.md).

## Current behaviour

Write operations (`create`, `cancel`, `updateBillingCycle`) are **not**
retried automatically by the SDK. The API does not yet support idempotency
keys, so a retried write could double-act (e.g. create a duplicate
subscription). This is a deliberate, single switch in the SDK's retry layer —
see [SDK-SPEC.md §8](../../specs/SDK-SPEC.md).

Read operations (`list`, `retrieve`) are unaffected: they're naturally
idempotent and already retried on `NetworkError` and `5xx`.

## Intended header

Once supported, write operations will accept an `X-Idempotency-Key` header.
Sending the same key on a repeated write is intended to let the API
deduplicate the request instead of performing the action twice.

## Intended SDK behaviour

- The SDK will auto-generate a UUID idempotency key for each write call if
  the caller doesn't supply one.
- An override parameter will let callers pass their own key, e.g. to
  correlate a retry across separate calls.
- Once the header is honoured by the backend, writes will flip to retryable
  in the SDK's retry layer — the same switch referenced in
  [SDK-SPEC.md §8](../../specs/SDK-SPEC.md).

## Why this isn't built yet

Idempotency support is **blocked on the backend**: the API must dedup
requests on the `X-Idempotency-Key` value before the SDK can safely retry
writes. Until the backend honours the header, writes stay non-retryable, and
this page stays a description of intended behaviour rather than a reference
for a shipped feature.

This page will be updated with real usage examples once idempotency keys are
built.
