import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { Payout } from "../models/index.js";
import { assertPathId } from "../utils/index.js";

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it. */
const PAYOUTS_PATH = "/api/v1/payouts";

interface WirePayout {
  payout_id: string;
  status: string;
  amount: string;
  provider_charge: string;
  suqo_platform_fee: string;
  sms_charge: string;
  net_amount: string;
  requested_date: string;
  paid_date?: string | null;
  receipt_url?: string | null;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializePayout(wire: WirePayout): Payout {
  return {
    payoutId: wire.payout_id,
    status: wire.status,
    amount: wire.amount,
    providerCharge: wire.provider_charge,
    suqoPlatformFee: wire.suqo_platform_fee,
    smsCharge: wire.sms_charge,
    netAmount: wire.net_amount,
    requestedDate: wire.requested_date,
    paidDate: wire.paid_date ?? null,
    receiptUrl: wire.receipt_url ?? null,
  };
}

/**
 * `client.payouts` (SDK-SPEC.md §5, §6; `openapi.yaml` `listPayouts`/`createPayout`/
 * `retrievePayout`).
 */
export class PayoutsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Your account's payouts, newest first. Paginated (SDK-SPEC.md §6). Amounts are decimal strings.
   */
  async list(params?: PageParams): Promise<Page<Payout>> {
    const wire = await this.#http.request<Page<WirePayout>>({
      method: "GET",
      path: PAYOUTS_PATH,
      query: toPageQuery(params),
    });
    return deserializePage(wire, deserializePayout);
  }

  /** Iterates every payout across every page, following `next` until it's `null` (SDK-SPEC.md §6). */
  autoPaging(params?: PageParams): AsyncIterableIterator<Payout> {
    return bridgeAutoPaging(() => this.list(params), async (nextUrl) => {
      const wire = await this.#http.request<Page<WirePayout>>({ method: "GET", path: nextUrl });
      return deserializePage(wire, deserializePayout);
    });
  }

  /**
   * Requests a payout of all your due transactions to your verified bank account (add and verify
   * it with `client.bankAccounts`). Takes no arguments. Fees and unbilled SMS usage are deducted;
   * the payout starts `PENDING` — track it with {@link PayoutsResource.retrieve}.
   *
   * A refusal is a `ValidationError` whose `message` explains it; the reason is in
   * `err.rawBody.code`: `pending_payout_request_exists` (only one payout can be pending, so a
   * repeat after success never pays twice), `payout_below_minimum`, `no_transactions_due`,
   * `bank_account_not_found`, `bank_account_not_verified`. Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async create(): Promise<Payout> {
    const wire = await this.#http.request<WirePayout>({ method: "POST", path: PAYOUTS_PATH });
    return deserializePayout(wire);
  }

  /** One payout by its `payoutId` (`PYT-…`), e.g. to check whether it is still `PENDING`. */
  async retrieve(payoutId: string): Promise<Payout> {
    // "" would collapse to list()'s URL and decode a page as a payout.
    assertPathId(payoutId, "payouts.retrieve");
    const wire = await this.#http.request<WirePayout>({
      method: "GET",
      path: `${PAYOUTS_PATH}/${encodeURIComponent(payoutId)}`,
    });
    return deserializePayout(wire);
  }
}
