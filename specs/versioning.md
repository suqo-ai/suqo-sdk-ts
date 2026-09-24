# SUQO SDK — Versioning Policy

Status: Confirmed (2026-08-14) · Applies to every language SDK

This refines [`SDK-SPEC.md`](./SDK-SPEC.md) §13. It exists as its own file because the versioning
_policy_ is language-agnostic (every SDK follows it identically) but changes independently of the
wire contract — a policy clarification shouldn't require touching `openapi.yaml` or `SDK-SPEC.md`.

The two-trigger MAJOR rule below started as an inference (SDK-SPEC.md §13 only states the API-version
trigger; the lead's own versioning table required the second trigger to make its `3.0.0` row
consistent). The lead re-confirmed the table as-is on 2026-08-14, which confirms the rule it implies
— this file is no longer a draft awaiting sign-off. (Ticket 10 added the _Status_ column to the
table below — the rows themselves are unchanged, since they're the lead's own confirmed example.)

## Rule

Strict [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** — bump on _either_ of two triggers, whichever happens first:
  1. **The API's path version changes** (`/api/v1/` → `/api/v2/`). SDK-SPEC.md §13 states this
     one explicitly: "major version tracks the API path version." A wire-breaking change on the
     backend always forces a new SDK major, full stop.
  2. **The SDK introduces its own breaking change with no API change at all.** Rewriting a
     callback-based method to return Promises, renaming a public export, changing a method's
     return shape — these break callers even though the wire contract underneath didn't move.
     SDK-SPEC.md §13 doesn't call this out by name, but it's necessary for the rule to actually
     hold: a same-API SDK release can still be breaking, and must still be a major. The `3.0.0`
     row in the compatibility table below is the worked example.
- **MINOR** — additive, backward-compatible: a new resource (e.g. Customers going from stub to
  real, per §11's extension pattern), a new optional parameter, a new non-breaking field on a
  response type.
- **PATCH** — fixes only, no contract change of any kind.

## Deprecation

Anything removed is deprecated one minor ahead with a documented warning (docs + a runtime
deprecation notice where the language supports one), removed only at the next major (SDK-SPEC.md
§13). No feature is ever removed in a minor or patch release.

## SDK version ↔ API version compatibility table

Every real release adds a row here, marked `Shipped` once it's actually published. The table also
keeps the lead's original worked example illustrating both MAJOR triggers — the **Status** column
is what tells the two apart; don't mistake an `Example` row for release history.

| SDK Version (SemVer) | Supported API Version | Change Type                                                                                          | Status                      |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| `1.0.0`              | `v1`                  | Initial release                                                                                      | Shipped                     |
| `1.1.0`              | `v1`                  | Added customers create/update; **SDK-only breaking** type fixes as a minor (see Recorded exceptions) | Shipped                     |
| `2.0.0`              | `v2`                  | Rewrote SDK to support new **v2 API breaking changes**                                               | Example — illustrative only |
| `3.0.0`              | `v2`                  | No API change; refactored SDK methods to use Promises (**SDK-only breaking change**)                 | Example — illustrative only |

The `2.0.0` example row is trigger (1) above (API-driven). The `3.0.0` example row is the worked
example of trigger (2) — same API, SDK-only breaking change — which is why this file states that
trigger explicitly instead of just restating SDK-SPEC.md §13 verbatim.

**When adding a row for a real release:** set **Status** to `Shipped` — that word is reserved for
a release that's actually happened. State the _Change Type_ in the same style as the rows above:
name whether the break came from the API version or from the SDK's own contract, not just
"breaking change." Future language SDKs maintain their own copy of this table (their release
cadence differs from the TS SDK's), but the _policy_ above is identical for all of them.

## Recorded exceptions

A release that breaks the MAJOR rule above must be listed here with its reason, so the exception
is visible rather than silent.

- **`1.1.0` — `Customer.id` `number` → `string`, `Customer.address` added as required,
  `Product.productImage` `string[]` → `ProductImage[]` (decided 2026-09-24).** All three are
  SDK-only breaking type changes (trigger 2) shipped as a minor. Reason: they correct types that
  never matched the wire — the API always returned an opaque prefixed string id, so the declared
  `number` made `customers.retrieve()` uncallable with a real id, and product images were always
  objects — and `1.0.0` had only been out since 2026-09-10. The `CHANGELOG.md` entry carries upgrade
  notes for the compile errors this can cause. This does not loosen the rule for future releases.
  Shipped 2026-09-24; its row in the table above replaced the lead's illustrative `1.1.0` row.

## Release process

- Every release ships a `CHANGELOG.md` entry (Keep a Changelog format) that names the triggering
  change and links to the row added here.
- Published docs carry a version selector (SDK-SPEC.md §13).
- `v1` line starts at `1.0.0` (SDK-SPEC.md §13).
