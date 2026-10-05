# Design Doc — Ticket 4: Resources

**Status:** Draft — backfilled after implementation.
**Audience:** any language SDK team (TypeScript, Python, PHP, …). Nothing below is TypeScript-specific;
where the current implementation makes a TS-specific choice, it's called out separately so another
language can make its own idiomatic equivalent.

---

## 1. Spec alignment

This ticket implements:

- **SDK-SPEC.md §5** — the actual public resource surface (`products`, `subscriptions`,
  `customers`), camelCase args, decimal-fields-stay-string, the `checkout_url`-is-not-payment
  caveat.
- **SDK-SPEC.md §6** — pagination and the auto-iterator, wired to real endpoints for the first
  time (Ticket 3 built the mechanism; this ticket connects it).
- **SDK-SPEC.md §7** — the first place `mapHttpError`'s classes actually get thrown from a real
  request (Ticket 1 built the mapper; `HttpClient`, Ticket 2, already calls it — this ticket is
  the first to exercise that path end-to-end).
- **`openapi.yaml`** — `listProducts`, `listSubscriptions`, `createSubscription`,
  `cancelSubscription`, `updateBillingCycle`, `resumeSubscription`, `listCustomers`,
  `retrieveCustomer`.
- **SDK Naming Map v1.1** — the customer boundary (§11), the rename register (§12:
  `client`→`customer`, `Message`→`MessageResponse`, `*Request`→`*Params`), and `.autoPaging()`
  (§04).
- **`docs/implementation-plan.md`'s Ticket 4 re-scope notes (2026-08-18)** — Customers upgraded
  from stub to real; `resume` added (confirmed public, shape unverified); `retrieve` deliberately
  excluded (blocked on backend).

---

## 2. Decomposition

| Step | Piece | Depends on |
|---|---|---|
| A | Model types | Tickets 1–3 (errors, pagination) |
| B | Customer↔client serialization boundary | Step A |
| C | Per-resource wire deserialization | Step A |
| D | `products` resource | Steps A, C |
| E | `customers` resource | Steps A, C |
| F | `subscriptions` resource | Steps A, B, C |
| G | Wiring onto `SuqoClient` + public exports | Steps D, E, F |

---

## Step A — Model types

### Type diagram

```mermaid
classDiagram
  class Product { +productId +name +isActive +vat +plan: Plan[] +totalSubscribers }
  class Plan { +planId +planName +billingPeriods: BillingPeriod[] }
  class BillingPeriod { +pbpId +price +currency +isCurrent }
  Product o-- Plan
  Plan o-- BillingPeriod

  class Subscription { +subscriptionId +status +customer: SubscriptionCustomer +product: SubscriptionProduct }
  class SubscriptionCustomer { <<was ClientRead>> }
  class CustomerInput { <<was ClientWrite>> }
  class Customer { <<the customers resource's own record>> }
  Subscription o-- SubscriptionCustomer
  Subscription o-- SubscriptionProduct

  class CreateSubscriptionParams { <<was CreateSubscriptionRequest>> +customer: CustomerInput }
  class MessageResponse { <<was Message>> +message }
```

### Contracts

| Type | Notes |
|---|---|
| `Product`/`Plan`/`BillingPeriod` | Field-for-field mirror of `openapi.yaml`, camelCased. No renames. |
| `SubscriptionCustomer` / `CustomerInput` / `Customer` | Three distinct types, not one — the read shape embedded on a subscription, the write shape passed to `create()`, and the `customers` resource's own full record are genuinely different. Naming the embedded shape `Customer` would collide the moment the resource's own record needed that name too. |
| `SubscriptionStatus` | A constant object + a **widened** union (`known literals \| (string & {})`), not a closed union or a plain enum. SDK Naming Map v1.1 §10 requires an unrecognized status the API adds later to round-trip instead of raising — a closed union would make TypeScript itself reject that value at the type level, defeating the requirement even though runtime code never validated anything. |
| `CreateSubscriptionParams`/`UpdateBillingCycleParams` | Named `*Params`, not `*Request` — the wire schema's own name would read as an HTTP request object. `CreateSubscriptionResponse` is unaffected; the rename only applies to inbound shapes. |
| `MessageResponse` | Named to avoid colliding with `SuqoError.message`, which every error subclass already carries. |

### Conformance checklist — Step A

- [ ] Every model field name is camelCase, and matches its wire counterpart 1:1 except the four
      registered renames above.
- [ ] `SubscriptionStatus`'s six known accessors' values match `openapi.yaml`'s enum strings
      exactly; assigning an arbitrary unrecognized string to a `status` field requires no cast.
- [ ] `SubscriptionCustomer`, `CustomerInput`, and `Customer` remain three separate types — no
      merging or aliasing one to another.

---

## Step B — Customer↔client serialization boundary

### Function contracts

```
function serializeCustomerInput(customer: CustomerInput) -> wire object (ClientWrite shape)
function deserializeSubscriptionCustomer(wire: unknown) -> SubscriptionCustomer
```

| Direction | Rule |
|---|---|
| Write | Root fields (`phone`, `fullName`→`full_name`, `email`, `address`) map 1:1. The nested `billing` object's fields get a `billing_` prefix (`businessName`→`billing_business_name`). The nested `shipping` object's fields do **not** get any prefix. This asymmetry is a real backend quirk — reproduced exactly, not "fixed." |
| Read | Neither nested object carries any prefix at all (`business_name`, not `billing_business_name`). A field of the wrong type, or a missing/malformed nested object, is omitted — never fabricated or thrown on, matching `mapHttpError`'s own best-effort philosophy (Ticket 1). |
| One boundary | This is the **only** place the `client`↔`customer` translation happens. No resource method, error class, or transport code touches it directly. `rawBody` is never translated (R1). |

### Conformance checklist — Step B

- [ ] A round-trip through `serializeCustomerInput` never emits `billing_*`-prefixed keys inside
      `shipping`, or unprefixed keys inside `billing`.
- [ ] `deserializeSubscriptionCustomer` given a `billing_business_name` key (the *write* shape) on
      the read side does **not** surface it — the read and write field-name logic never bleed
      into each other.
- [ ] A non-object wire value returns `{}` rather than throwing.

---

## Step C — Per-resource wire deserialization

**This step exists because of a real bug found before it was ever committed**, not a hypothetical.
An earlier draft of the `products` resource typed `list()`'s return as `Page<Product>`
(camelCase) but never actually converted anything — the real 2xx response body is snake_case, so
at runtime `product.productId` would have been `undefined` while TypeScript insisted it was a
`string`. `HttpClient.request()` (Ticket 2) does not transform response bodies at all — it hands
back the parsed JSON via a type assertion only (`as TResponse`) — so **every** resource is
responsible for converting its own wire shapes explicitly.

| Rule | Detail |
|---|---|
| Wire types stay private | Each resource file declares its own `Wire*` interfaces (e.g. `WireProduct`) matching `openapi.yaml` exactly, snake_case. Not exported — an implementation detail of that one file. |
| Deserializers are explicit, not generic | A hand-written `deserializeX` function per shape, not a generic recursive snake→camel walker. A generic deep converter would risk mangling opaque/unspecified inner shapes (e.g. `BillingPeriod.offers: unknown[]`, whose item shape isn't documented) by "helpfully" re-casing keys it has no business touching. |
| Shared envelope helper | `deserializePage<TWireItem, T>(wire, deserializeItem)` (`pagination.ts`) handles unwrapping `count`/`next`/`previous`/`results` — those three field names already match the wire, only `results`' items need per-resource mapping. The `SubscriptionListEnvelope`'s four extra counts aren't part of `Page<T>`'s shape, so `subscriptions.ts` has its own `deserializeSubscriptionPage` instead of reusing the generic helper. |
| Exported for testing only | Each resource's `deserializeX` functions are exported from their file so they get direct unit tests, but they are **not** re-exported from `src/index.ts` — not part of the public contract. |

### Conformance checklist — Step C

- [ ] Every resource method's returned object contains **zero** snake_case keys — proven by
      asserting the absence of a specific wire key (e.g. `not.toHaveProperty("product_id")`), not
      just asserting the camelCase key is present (which a type-only assertion would pass too).
- [ ] A nested array of objects (`Product.plan[].billingPeriods[]`) is deserialized recursively,
      not just at the top level.

---

## Step D — `products` resource

```
products.list(params?: PageParams) -> Page<Product>
products.autoPaging(params?: PageParams) -> AsyncIterableIterator<Product>
```

The only resource that works before KYC verification (SDK-SPEC.md §5) — no `KycRequiredError`
handling needed here specifically; it still flows through `mapHttpError` like everything else if
the account is somehow otherwise unauthorized.

---

## Step E — `customers` resource

```
customers.list(params?: PageParams) -> Page<Customer>
customers.autoPaging(params?: PageParams) -> AsyncIterableIterator<Customer>
customers.retrieve(id: string) -> Customer   // throws SuqoConfigError if id is empty
customers.create(params: CreateCustomerParams) -> Customer
customers.update(id: string, params: UpdateCustomerParams) -> Customer   // throws SuqoConfigError if id is empty
```

`create()`/`update()` were added in 1.1.0 once Swagger documented `POST /customers/` and
`PATCH /customers/{id}/` (2026-09-24). No delete exists on this resource.

| Rule | Detail |
|---|---|
| Write-side names differ from read-side | `phone`/`email` are sent as-is and read back as `buyer_phone`/`buyer_email`. The params keep the write names rather than borrowing the read side's `buyer*` prefix. |
| Only set keys are sent | `undefined` fields are dropped from the body; `""` is passed through, since on `update()` it means "clear this field". |
| `create()` on an existing phone | The API updates that customer and answers `200` instead of `201`; both resolve to the `Customer`. **Superseded in 2.0.0** — `email` is required and identifies the buyer; see the 2.0.0 section below. |
| `update()` is the SDK's only `PATCH` | `HttpClient` gained a `PATCH` branch for it. Like every write, it's never retried (SDK-SPEC.md §8). |

### Conformance checklist — Step E writes

- [ ] `create()` sends `phone`/`full_name`/`email`/`address`, never `buyer_*` keys.
- [ ] An omitted optional field is absent from the body, not sent as `null`.
- [ ] `update(id, { email: "" })` sends `{ email: "" }` — the empty string survives.
- [ ] `update("")`, `update(".")` and `update("..")` throw `SuqoConfigError` before any request.
- [ ] `update()` never sends `phone`, even when the params object carries one.
- [ ] Neither method retries on a `5xx`.

`id` on every method is an **opaque prefixed string**
(e.g. `cus_1ce18d624`, like `pbp_...` on billing periods) — not an integer and not a UUID. (Bug
#42: this doc previously said `integer`, "re-verified live against BE Swagger" — that verification
never actually matched what the API returns; corrected once a real captured response surfaced it.)

`retrieve("")` doesn't reach the API at all: an empty id would otherwise collapse onto the exact
URL `list()` builds (`encodeURIComponent("")` is `""`), returning that endpoint's 200 pagination
envelope instead of a 404 — so it's rejected before any request is attempted, as `SuqoConfigError`,
the same class `SuqoClient`'s constructor uses for a config mistake caught before any request. `"."` and `".."` are
rejected the same way, on `retrieve()` and `update()` alike: `encodeURIComponent` leaves dots
alone, and URL parsing resolves them as dot segments onto the collection URL or above it.

---

## Step F — `subscriptions` resource

```
subscriptions.list(params?: PageParams) -> SubscriptionPage<Subscription>
subscriptions.autoPaging(params?: PageParams) -> AsyncIterableIterator<Subscription>
subscriptions.create(params: CreateSubscriptionParams) -> CreateSubscriptionResponse
subscriptions.cancel(id: string) -> MessageResponse
subscriptions.updateBillingCycle(params: UpdateBillingCycleParams) -> MessageResponse
subscriptions.resume(id: string) -> MessageResponse
```

| Rule | Detail |
|---|---|
| `retrieve(id)` is **absent**, not stubbed | Still blocked on a real sample response from backend. Matches the Ticket 0 precedent of not building placeholders for unconfirmed shapes — the method simply doesn't exist yet, rather than existing and throwing. **Superseded in 2.0.0** — built from Swagger's schema; see the 2.0.0 section below. |
| `create()` routes through the customer boundary | `params.customer` is serialized via `serializeCustomerInput` (Step B) and nested under the wire's `client` key. |
| `cancel`/`updateBillingCycle`/`resume` need no deserializer | `MessageResponse`'s one field (`message`) already matches the wire 1:1 — these three call `request<MessageResponse>()` directly. |
| `cancel` is scheduled, not immediate | Confirmed with backend 2026-08-17 — status moves to `pending_cancellation`, stays active until period end. |
| Writes never auto-retry | SDK-SPEC.md §8, §12 — no idempotency keys yet. |

### Conformance checklist — Step F

- [ ] `list()`'s four extra counts (`totalSubscriptions`/etc.) are present alongside `results`,
      never replacing the common envelope shape.
- [ ] `create()`'s request body's `client` key is byte-identical to what `serializeCustomerInput`
      alone would produce — no double-mapping or drift between the two.
- [ ] A duplicate-active-subscription 400 (`detail`-shaped) surfaces as `ValidationError.message`,
      not `fieldErrors` — proven end-to-end through `create()`, not just at the mapper level
      (Ticket 1 already covers the mapper itself).
- [ ] ~~No `retrieve` method exists on the resource at all.~~ Superseded in 2.0.0 (see below).

---

## Step G — Wiring onto `SuqoClient`

```mermaid
classDiagram
  class SuqoClient {
    +products: ProductsResource
    +subscriptions: SubscriptionsResource
    +customers: CustomersResource
    -http: HttpClient  «hidden, shared»
  }
  SuqoClient --> HttpClient : constructs one, shares it
  HttpClient <-- ProductsResource : calls through
  HttpClient <-- SubscriptionsResource : calls through
  HttpClient <-- CustomersResource : calls through
```

One `HttpClient` per `SuqoClient` instance, shared by all three resources — same
`baseUrl`/`apiKey`/`timeout`/`maxRetries` regardless of which resource makes the call. `.webhooks`
is not attached here (Ticket 5) — it makes no network call and needs no key.

### Conformance checklist — Step G

- [ ] `suqo.products`/`.subscriptions`/`.customers` are each instances of their resource class,
      constructed once per `SuqoClient` instance (two separate `SuqoClient`s never share resource
      instances).
- [ ] A call through any attached resource actually reaches the shared `HttpClient` — proven by
      asserting the real `Authorization` header appears on the underlying `fetch` call, not just
      that the resource method resolves.
- [ ] Resource classes themselves are not exported from the public surface (`src/index.ts`) — only
      their instances, reached through `SuqoClient`.

---

## 2.0.0 — API sync (2026-10-05)

The API changed its wire contract inside `/api/v1/` (new endpoints, a new checkout webhook payload,
`email` identifying a customer), so the SDK follows as a major release. Names follow SDK Naming Map
1.4; shapes follow `specs/openapi.yaml`.

### New and changed signatures

```
checkoutSessions.create(params: CreateCheckoutSessionParams) -> CheckoutSessionResponse
checkoutSessions.retrieve(id: string) -> CheckoutSession            // throws SuqoConfigError on "", ".", ".."
subscriptions.retrieve(id: string) -> Subscription                  // throws SuqoConfigError on "", ".", ".."
subscriptions.renew(subscriptionId: string) -> CheckoutSessionResponse
customers.create(params: CreateCustomerParams) -> Customer           // email now required, phone optional
```

```mermaid
classDiagram
  class CreateCheckoutSessionParams { +items: CheckoutItemInput[] +returnUrl +customerId? }
  class CatalogueItemInput { +pbpId }
  class PartnerPricedItemInput { +name +amount +intervalType +intervalCount }
  class CheckoutSessionResponse { +publicId +expiresAt +checkoutUrl }
  class CheckoutSession { +publicId +lineItems: CheckoutLineItem[] +customerId +sellerDetails: CheckoutSeller +isExpired }
  CreateCheckoutSessionParams o-- CatalogueItemInput
  CreateCheckoutSessionParams o-- PartnerPricedItemInput
  CheckoutSession o-- CheckoutLineItem
  CheckoutSession o-- CheckoutSeller
```

| Rule | Detail |
|---|---|
| One shared link type | `checkoutSessions.create()` and `subscriptions.renew()` both return `CheckoutSessionResponse` — one wire schema, one deserializer (`deserializeCheckoutSessionResponse`, exported from `checkoutSessions.ts` for `subscriptions.ts`). |
| Items are one shape or the other | `CatalogueItemInput` declares the partner-priced fields as `never` (and vice versa), so a mix is a compile error. At runtime the serializer sends only `pbp_id` when `pbpId` is set, so a non-literal object carrying both still can't send a mix. |
| No discount field on partner-priced items | The docs say `amount` already includes any discount; Swagger lists an optional `discount_amount`. Not exposed until confirmed — adding it later is additive, removing it would break. |
| `renew` takes the id positionally | Naming Map R8: one required scalar. It travels in the body (`{ subscription_id }`) on the singular `/api/v1/subscription/renew/` path — the wire path is kept exactly (R1). |
| `CheckoutSession` from a captured response | `line_items` is an array and `is_expired` a boolean (Swagger says object and string). `imageUrls` is catalogue-only and `planName` partner-priced-only — each stays absent, not `null`, on the other kind; every other nullable key degrades to `null`. |
| `subscriptions.retrieve` from Swagger | Reuses `deserializeSubscription`; not yet checked against a captured response. |
| `customers.create` body | `email` always sent, `phone` only when given; `update()` still never sends `phone`. |
| Product fields | `description`/`termsAndConditions`/`featuresAndBenefits`/plan `description`/`vatType`/`vatPercentage` are nullable and degrade to `null`; `type`/`intervalType`/`vatType` are loose unions (known values or any string, Naming Map §9); `offers` is `Offer[]`. |
| Path-id guard shared | `assertPathId()` (`src/utils/`) replaces the customers-only guard, used by every method with an id in its path. |
| Writes never auto-retry | `checkoutSessions.create`, `renew`, and the webhook writes — SDK-SPEC.md §8, §12. `checkoutSessions.create` is rate-limited; its `RateLimitError.retryAfter` falls back to the wait in the 429's `detail`. |

### Conformance checklist — 2.0.0

- [ ] `checkoutSessions.create()` sends `items` (each `{ pbp_id }` or `{ name, amount, interval_type, interval_count }`), `return_url`, and `customer_id` only when given.
- [ ] A catalogue item never sends partner-priced keys, even from a non-literal object.
- [ ] `checkoutSessions.create()` on a 429 throws `RateLimitError` with `retryAfter` from `detail`, after exactly one request.
- [ ] `checkoutSessions.retrieve()` maps `line_items` to an array and `is_expired` to a boolean; a 404 is `NotFoundError` with `return_url` in `rawBody`.
- [ ] `subscriptions.renew(id)` POSTs `{ subscription_id }` to `/api/v1/subscription/renew/` and returns the same `CheckoutSessionResponse` shape as `checkoutSessions.create()`.
- [ ] `subscriptions.retrieve("")`/`(".")`/`("..")` throw `SuqoConfigError` before any request.
- [ ] A bare-list 400 from `cancel`/`resume`/`renew` surfaces its message as `ValidationError.message`, `fieldErrors` empty.
- [ ] `customers.create({ email })` sends `{ email }` alone.
- [ ] Omitted nullable product keys come back `null`, never `undefined`; `offers` maps to camelCase `Offer`s.

---

## Design decisions & rationale

1. **Wire-shape interfaces are private and per-file, not centralized.** A single giant
   `WireTypes.ts` mirroring all of `openapi.yaml` would create a second copy of the spec to keep in
   sync. Keeping each resource's `Wire*` interfaces local to the file that uses them means the
   translation lives exactly once, next to the code that performs it.

2. **`bridgeAutoPaging` (Ticket 3's addition) is deliberately named differently from the public
   `.autoPaging()` method it powers.** They'd still resolve correctly even sharing a name (a class
   method name isn't a lexical binding inside its own body), but a distinct name means nobody
   reviewing the code has to reason through that to be sure.

3. **Resource classes are not part of the public export surface.** SDK-SPEC.md §5's shown surface
   never constructs a resource directly — only `new SuqoClient({...})`, then `.products`/etc. off
   of it. Exporting `ProductsResource` etc. would offer a second, unintended way to get the same
   functionality without going through the client's shared configuration.

4. **`retrieve()` is absent, not present-and-throwing.** A stub that throws "not implemented"
   would still show up in autocomplete and TypeScript's type surface, implying a caller should
   call it and handle the throw. Simply not defining the method is more honest about the current
   state — this exact precedent was set in Ticket 0.

---

## What's intentionally not in this doc

- `webhooks.verify()` — Ticket 5.
- Contract/mock-server testing strategy — Ticket 7.
- **Open question A — RESOLVED (2026-08-24).** Confirmed with lead: yes, translate. Confirmed
  live against `POST /subscriptions/`: a validation failure on the customer payload nests errors
  under `client` as a real object (`{"client": {"phone": ["This field is required."]}}`), not a
  flat dotted key — exactly the "path-aware rewriting, not a flat key swap" the map warned this
  would need. Implemented in `mapHttpError.ts`'s `fieldErrorsFrom` (Ticket 1) — see that file and
  its design doc for the actual mapping logic; this ticket's resources didn't need any change
  themselves, since the translation lives entirely in the error mapper.
- **Open question B** (does the auto-iterator yield rows or pages; do the four subscription counts
  repeat on every page or only the first?) — also unresolved in the map; this ticket's
  `autoPaging()` yields individual rows (Ticket 3's `listAll` already made that choice), and
  `deserializeSubscriptionPage` re-parses whatever counts each page actually sends without relying
  on them repeating.
- `environment`/`httpClient` config options — deferred (naming map item, not a rename).
