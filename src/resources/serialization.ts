import type { CustomerInput, SubscriptionCustomer } from "../models/index.js";
import { isRecord } from "../utils/index.js";

/**
 * The customer↔client serialization boundary (SDK Naming Map v1.1 §11 "Customer boundary").
 * `openapi.yaml` keeps `client`; the SDK surfaces `customer` — that divergence is deliberate (the
 * wire name collides with the SDK's own client object), but it means the translation has to
 * happen *somewhere*, exactly once. This module is that one place: no resource method, no error
 * class, and no transport code (`HttpClient`) touches this mapping directly — they call through
 * here instead.
 *
 * Both directions are asymmetric on the wire, not just renamed (`specs/openapi.yaml`
 * `ClientRead`/`ClientWrite`):
 * - **Write** (`ClientWrite`, this file's {@link serializeCustomerInput}): the nested `billing`
 *   object's own fields carry a `billing_` prefix (`businessName` → `billing_business_name`), but
 *   `shipping`'s fields don't (`fullName` → `full_name`, no prefix). This is a real backend
 *   quirk, not something to "fix" here — the serializer has to reproduce it exactly.
 * - **Read** (`ClientRead`, this file's {@link deserializeSubscriptionCustomer}): neither nested
 *   object carries a prefix at all (`business_name`, not `billing_business_name`).
 *
 * `rawBody` is never touched by either function (R1) — this boundary only affects the typed
 * `customer`/`SubscriptionCustomer` a resource method hands back, never what a caller sees if they
 * inspect an error's `rawBody`.
 *
 * @packageDocumentation
 */

/**
 * `CustomerInput` (SDK) → the wire's `ClientWrite` shape, for `subscriptions.create()`'s request
 * body. The caller is responsible for nesting the result under the wire's `client` key — this
 * function only produces the object that goes there, so it stays agnostic of where it's mounted.
 */
export function serializeCustomerInput(customer: CustomerInput): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    phone: customer.phone,
    full_name: customer.fullName,
    email: customer.email,
    address: customer.address,
  };

  if (customer.billing) {
    const billing: Record<string, unknown> = {
      billing_business_name: customer.billing.businessName,
      billing_email: customer.billing.email,
      billing_address: customer.billing.address,
    };
    if (customer.billing.panVat !== undefined) billing.billing_pan_vat = customer.billing.panVat;
    wire.billing = billing;
  }

  if (customer.shipping) {
    const shipping: Record<string, unknown> = {
      phone: customer.shipping.phone,
      full_name: customer.shipping.fullName,
      email: customer.shipping.email,
    };
    if (customer.shipping.address !== undefined) shipping.address = customer.shipping.address;
    wire.shipping = shipping;
  }

  return wire;
}

/**
 * The wire's `ClientRead` shape (already unwrapped from `client`) → `SubscriptionCustomer` (SDK).
 * Best-effort, like `mapHttpError`'s own body parsing: a field of the wrong type or a
 * malformed/missing nested object is simply omitted rather than fabricated or thrown on — a
 * `Subscription` a caller already has in hand shouldn't become unusable because of one
 * unexpected field.
 */
export function deserializeSubscriptionCustomer(wire: unknown): SubscriptionCustomer {
  if (!isRecord(wire)) return {};

  const customer: SubscriptionCustomer = {};
  if (typeof wire.phone === "string") customer.phone = wire.phone;
  if (typeof wire.full_name === "string") customer.fullName = wire.full_name;
  if (typeof wire.email === "string") customer.email = wire.email;
  if (typeof wire.address === "string") customer.address = wire.address;

  if (isRecord(wire.billing)) {
    customer.billing = {
      ...(typeof wire.billing.business_name === "string" ? { businessName: wire.billing.business_name } : {}),
      ...(typeof wire.billing.email === "string" ? { email: wire.billing.email } : {}),
      ...(typeof wire.billing.address === "string" ? { address: wire.billing.address } : {}),
      ...(typeof wire.billing.pan_vat === "string" ? { panVat: wire.billing.pan_vat } : {}),
    };
  } else if (wire.billing === null) {
    customer.billing = null;
  }

  if (isRecord(wire.shipping)) {
    customer.shipping = {
      ...(typeof wire.shipping.phone === "string" ? { phone: wire.shipping.phone } : {}),
      ...(typeof wire.shipping.full_name === "string" ? { fullName: wire.shipping.full_name } : {}),
      ...(typeof wire.shipping.email === "string" ? { email: wire.shipping.email } : {}),
      ...(typeof wire.shipping.address === "string" ? { address: wire.shipping.address } : {}),
    };
  } else if (wire.shipping === null) {
    customer.shipping = null;
  }

  return customer;
}
