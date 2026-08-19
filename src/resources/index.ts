/**
 * One class per API resource — `products`, `subscriptions`, `customers` (SDK-SPEC.md §1) — the
 * SDK's public surface, attached onto `SuqoClient` in Ticket 4.
 *
 * Not yet implemented. The previous docstring here listed 11 resources (`auth`, `profile`,
 * `business`, `subscribers`, `transactions`, `payouts`, `kyc`, `smsCredits`, `configs`, …) from a
 * retired RFC-based plan — see `docs/implementation-plan.md` Ticket 0 item 4. The actual surface
 * is exactly `products` (`list`), `subscriptions` (`list`/`create`/`cancel`/`updateBillingCycle`,
 * plus `retrieve`/`resume` once backend confirms their shapes — see Ticket 4), and `customers`
 * (`list`/`retrieve`, confirmed live and no longer a stub).
 *
 * @packageDocumentation
 */
export {};
