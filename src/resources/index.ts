/**
 * One class per API resource — `products`, `subscriptions`, `customers` (SDK-SPEC.md §1) —
 * attached onto `SuqoClient` (Ticket 4). Not part of the public export surface themselves
 * (`src/index.ts`) — consumers reach them through `suqo.products`/`.subscriptions`/`.customers`,
 * never by importing a resource class directly.
 *
 * Every resource shares the client's one `HttpClient`. `WebhooksResource.verify()` alone makes no
 * network call; its management methods (2.0.0) do.
 *
 * @packageDocumentation
 */
export { ProductsResource } from "./products.js";
export { SubscriptionsResource } from "./subscriptions.js";
export { CustomersResource } from "./customers.js";
export { CheckoutSessionsResource } from "./checkoutSessions.js";
export { WebhooksResource } from "./webhooks.js";
