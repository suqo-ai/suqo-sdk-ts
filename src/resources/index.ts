/**
 * One class per API resource — `products`, `subscriptions`, `customers` (SDK-SPEC.md §1) —
 * attached onto `SuqoClient` (Ticket 4). Not part of the public export surface themselves
 * (`src/index.ts`) — consumers reach them through `suqo.products`/`.subscriptions`/`.customers`,
 * never by importing a resource class directly.
 *
 * `resume` shipped this ticket (confirmed public 2026-08-18, response shape
 * likely-correct-but-unverified). `retrieve` did NOT — still blocked on a real sample response
 * from backend; see `docs/implementation-plan.md` Ticket 4.
 *
 * `webhooks` isn't here — it makes no network call and needs no key, so it lands in Ticket 5
 * instead.
 *
 * @packageDocumentation
 */
export { ProductsResource } from "./products.js";
export { SubscriptionsResource } from "./subscriptions.js";
export { CustomersResource } from "./customers.js";
