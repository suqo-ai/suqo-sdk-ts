import type { WebhookEventType } from "./WebhookEvent.js";

/**
 * The webhook-management model types (`specs/openapi.yaml` `Webhook` / `CreateWebhookRequest` /
 * `ReplaceWebhookRequest` / `UpdateWebhookRequest` / `WebhookSecret` — SDK-SPEC.md §5, §9).
 * These describe *registrations* — which endpoint receives which event. The deliveries themselves
 * are typed in `./WebhookEvent.js`.
 *
 * @packageDocumentation
 */

/**
 * A known {@link WebhookEventType} with autocomplete, or any other event name — so a {@link
 * Webhook.event} read back can be written back as-is, and an event the API adds after this SDK
 * release can still be registered.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
type WebhookEventName = WebhookEventType | (string & {});

/** A webhook registration (`openapi.yaml` `Webhook`). One per event per account. */
export interface Webhook {
  /** `whk_…` */
  id: string;
  /** The event this endpoint receives — a known {@link WebhookEventType}, or a newer one the SDK doesn't know yet. */
  event: WebhookEventName;
  endpointUrl: string;
  /** `false` while deliveries are paused. */
  isActive: boolean;
  createdAt: string;
}

/** What `webhooks.create(params)` accepts (`openapi.yaml` `CreateWebhookRequest`, renamed). */
export interface CreateWebhookParams {
  /** One webhook per event per account — a second for the same event is a `ValidationError`. */
  event: WebhookEventName;
  /** Must be `https` and resolve only to public addresses. */
  endpointUrl: string;
  isActive?: boolean;
}

/**
 * What `webhooks.replace(id, params)` accepts (`openapi.yaml` `ReplaceWebhookRequest`, renamed) —
 * a full overwrite (`PUT`): `event` and `endpointUrl` are both required. To change one field on
 * its own, use `webhooks.update()`.
 */
export interface ReplaceWebhookParams {
  event: WebhookEventName;
  endpointUrl: string;
  isActive?: boolean;
}

/**
 * What `webhooks.update(id, params)` accepts (`openapi.yaml` `UpdateWebhookRequest`, renamed) — a
 * partial update (`PATCH`): send only what changes, e.g. `{ isActive: false }` to pause deliveries.
 */
export interface UpdateWebhookParams {
  event?: WebhookEventName;
  endpointUrl?: string;
  isActive?: boolean;
}

/** What `webhooks.retrieveSecret()` returns (`openapi.yaml` `WebhookSecret`). */
export interface WebhookSecret {
  /** `whsec_…` — pass it as `secret` to `webhooks.verify()`. Treat it like a password: never log it. */
  signingSecret: string;
}
