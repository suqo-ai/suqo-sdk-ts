# SUQO SDK — Versioning Policy

Status: Confirmed (2026-08-14) · Applies to every language SDK

This refines [`SDK-SPEC.md`](./SDK-SPEC.md) §13. It exists as its own file because the versioning
*policy* is language-agnostic (every SDK follows it identically) but changes independently of the
wire contract — a policy clarification shouldn't require touching `openapi.yaml` or `SDK-SPEC.md`.

The two-trigger MAJOR rule below started as an inference (SDK-SPEC.md §13 only states the API-version
trigger; the lead's own versioning table required the second trigger to make its `3.0.0` row
consistent). The lead re-confirmed the table as-is on 2026-08-14, which confirms the rule it implies
— this file is no longer a draft awaiting sign-off.

## Rule

Strict [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** — bump on *either* of two triggers, whichever happens first:
  1. **The API's path version changes** (`/api/v1/` → `/api/v2/`). SDK-SPEC.md §13 states this
     one explicitly: "major version tracks the API path version." A wire-breaking change on the
     backend always forces a new SDK major, full stop.
  2. **The SDK introduces its own breaking change with no API change at all.** Rewriting a
     callback-based method to return Promises, renaming a public export, changing a method's
     return shape — these break callers even though the wire contract underneath didn't move.
     SDK-SPEC.md §13 doesn't call this out by name, but it's necessary for the rule to actually
     hold: a same-API SDK release can still be breaking, and must still be a major.
- **MINOR** — additive, backward-compatible: a new resource (e.g. Customers going from stub to
  real, per §11's extension pattern), a new optional parameter, a new non-breaking field on a
  response type.
- **PATCH** — fixes only, no contract change of any kind.

## Deprecation

Anything removed is deprecated one minor ahead with a documented warning (docs + a runtime
deprecation notice where the language supports one), removed only at the next major (SDK-SPEC.md
§13). No feature is ever removed in a minor or patch release.

## SDK version ↔ API version compatibility table

Every release adds a row here. This is the authoritative, always-current record of which SDK
version speaks which API version, and *why* each release bumped what it bumped — the same table
shape the lead circulated when this question first came up.

| SDK Version (SemVer) | Supported API Version | Change Type |
|---|---|---|
| `1.0.0` | `v1` | Initial release |
| `1.1.0` | `v1` | Added backward-compatible feature |
| `2.0.0` | `v2` | Rewrote SDK to support new **v2 API breaking changes** |
| `3.0.0` | `v2` | No API change; refactored SDK methods to use Promises (**SDK-only breaking change**) |

Rows `1.0.0`–`1.1.0` and `2.0.0` are trigger (1) above (API-driven). The `3.0.0` row is the worked
example of trigger (2) — same API, SDK-only breaking change — which is why this file states that
trigger explicitly instead of just restating SDK-SPEC.md §13 verbatim.

**When adding a row:** state the *Change Type* in the same style as above — name whether the break
came from the API version or from the SDK's own contract, not just "breaking change." Future
language SDKs maintain their own copy of this table (their release cadence differs from the TS
SDK's), but the *policy* above is identical for all of them.

## Release process

- Every release ships a `CHANGELOG.md` entry (Keep a Changelog format) that names the triggering
  change and links to the row added here.
- Published docs carry a version selector (SDK-SPEC.md §13).
- `v1` line starts at `1.0.0` (SDK-SPEC.md §13).
