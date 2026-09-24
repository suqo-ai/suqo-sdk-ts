/**
 * Input shapes for the `customers` write methods (`specs/openapi.yaml`
 * `CreateCustomerRequest`/`UpdateCustomerRequest`). Named `*Params`, not `*Request` — SDK Naming
 * Map v1.1 §12, same as `subscriptionParams.ts`.
 *
 * Note the read/write name asymmetry on the wire: `phone`/`email` sent here read back on
 * {@link import("./Customer.js").Customer} as `buyerPhone`/`buyerEmail`. The params keep the
 * wire's write-side names rather than borrowing the read side's `buyer*` prefix.
 *
 * @packageDocumentation
 */

/** What `customers.create(params)` accepts (`openapi.yaml` `CreateCustomerRequest`, renamed). */
export interface CreateCustomerParams {
  /**
   * Identifies the buyer and can't be changed later. A Nepali mobile number: 10 digits starting
   * with 96, 97 or 98 — a `+977` country code, a leading 0, spaces and dashes are accepted and
   * stripped server-side. Reads back as `buyerPhone`.
   */
  phone: string;
  fullName?: string;
  /** Reads back as `buyerEmail`. */
  email?: string;
  address?: string;
}

/**
 * What `customers.update(id, params)` accepts (`openapi.yaml` `UpdateCustomerRequest`, renamed).
 * Send only the fields you're changing; `""` clears a field. There's no `phone` — it identifies
 * the buyer and can't be changed.
 */
export interface UpdateCustomerParams {
  fullName?: string;
  /** Reads back as `buyerEmail`. */
  email?: string;
  address?: string;
}
