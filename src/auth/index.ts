/**
 * Authentication is a single static bearer key — `Authorization: Bearer <api_key>`, set once at
 * construction and attached to every request (SDK-SPEC.md §4). There is no token refresh, no
 * `TokenProvider`, and no separate auth layer to speak of — there's nothing to refresh a static
 * key *into*.
 *
 * **A 401 is still fully handled, just not by retrying.** An expired, malformed, or inactive key
 * gets a `401` from the API, which `mapHttpError()` (already implemented — `src/errors/
 * mapHttpError.ts`, `src/errors/SuqoError.ts`) turns into a typed `AuthenticationError` with the
 * backend's message (e.g. "Invalid or inactive API key.") — see
 * `test/errors/mapHttpError.test.ts`. There's no automatic retry because there's no second key to
 * retry with; the caller catches `AuthenticationError` and supplies a corrected/renewed key
 * themselves (typically by constructing a new `SuqoClient`).
 *
 * The previous docstring here described a `TokenProvider`/`ApiKeyProvider` interface with
 * single-flight refresh-on-401 — that concept belonged to a retired RFC-based plan and doesn't
 * exist in this spec; see `docs/implementation-plan.md` Ticket 0 item 4. Attaching the bearer
 * header is simple enough that it may just live directly in `http.ts` (Ticket 2) rather than
 * needing its own module — this folder is a placeholder pending that decision, not a confirmed
 * future phase.
 *
 * @packageDocumentation
 */
export {};
