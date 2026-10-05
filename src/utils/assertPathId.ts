import { SuqoConfigError } from "../errors/SuqoError.js";

/**
 * Rejects an id that would send a request to a different endpoint than the one intended, before
 * any request is made. `""` collapses onto the collection URL (`encodeURIComponent("")` is `""`),
 * so `retrieve("")` would silently hit `list()`; `"."` and `".."` do the same or climb above it,
 * because `encodeURIComponent` leaves dots alone and URL parsing resolves them as dot segments.
 *
 * `method` names the caller in the error, e.g. `"customers.retrieve"`. `reserved` lists sibling
 * route segments an id must not equal — `webhooks.retrieve("secret")` would otherwise land on
 * `GET /webhooks/secret/`, minting and returning the signing secret instead of a webhook.
 */
export function assertPathId(id: string, method: string, reserved: readonly string[] = []): void {
  if (!id || id === "." || id === "..") {
    throw new SuqoConfigError(`${method}() requires a non-empty id other than "." or ".."`);
  }
  if (reserved.includes(id)) {
    throw new SuqoConfigError(`${method}() was given "${id}", which is a route name, not an id`);
  }
}
