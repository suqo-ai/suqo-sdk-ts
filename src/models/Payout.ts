/**
 * Payout model type (`specs/openapi.yaml` `Payout` — SDK-SPEC.md §5).
 *
 * @packageDocumentation
 */

import type { PayoutStatus } from "./wireEnums.js";

/** One payout of your account's due transactions to your bank account (`openapi.yaml` `Payout`). */
export interface Payout {
  /** `PYT-…` (e.g. `"PYT-MF4G9W-CTEP55"`); the id `payouts.retrieve()` takes. */
  payoutId: string;
  /** `"PENDING"`, `"COMPLETED"` once Suqo has paid it out, or any other string the API adds later. */
  status: PayoutStatus;
  /** Gross total of the transactions in this payout. Decimal string, never a number. */
  amount: string;
  /** Payment gateway fees. Decimal string. */
  providerCharge: string;
  /** Suqo platform fee. Decimal string. */
  suqoPlatformFee: string;
  /** SMS usage billed into this payout. Decimal string. */
  smsCharge: string;
  /** What is paid to your bank account, after fees. Decimal string. */
  netAmount: string;
  /** ISO 8601 date-time. */
  requestedDate: string;
  /** ISO 8601 date-time; `null` until paid. */
  paidDate: string | null;
  /** Payment receipt, once uploaded after payment; otherwise `null`, even on a `COMPLETED` payout. */
  receiptUrl: string | null;
}
