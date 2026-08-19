/**
 * SDK entry point — the single, complete public export surface (SDK-SPEC.md §5).
 * Nothing outside this file's exports is part of the public contract.
 *
 * @packageDocumentation
 */

/** SDK version, stamped into request headers (keep in sync with package.json). */
export const VERSION = "0.0.1";

// The SuqoError hierarchy, SdkConfig, and SuqoClient land here across this ticket's
// remaining commits (see docs/implementation-plan.md Ticket 1).
