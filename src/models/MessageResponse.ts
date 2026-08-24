/**
 * What `subscriptions.cancel()`, `subscriptions.updateBillingCycle()`, and
 * `subscriptions.resume()` all return (`specs/openapi.yaml` `Message`, renamed). Named
 * `MessageResponse`, not `Message` — SDK Naming Map v1.1 §12: `Message` collides with the
 * `message` property every {@link import("../errors/SuqoError.js").SuqoError} subclass already
 * carries.
 *
 * @packageDocumentation
 */
export interface MessageResponse {
  message: string;
}
