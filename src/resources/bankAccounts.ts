import type { HttpClient } from "../http/HttpClient.js";
import type { BankAccount, CreateBankAccountParams, UpdateBankAccountParams } from "../models/index.js";
import { SuqoConfigError } from "../errors/index.js";

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it. */
const BANK_ACCOUNTS_PATH = "/api/v1/bank-accounts";

interface WireBankAccount {
  id: number;
  bank_name: string;
  account_name: string;
  branch: string;
  account_number_masked: string;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeBankAccount(wire: WireBankAccount): BankAccount {
  return {
    id: wire.id,
    bankName: wire.bank_name,
    accountName: wire.account_name,
    branch: wire.branch,
    accountNumberMasked: wire.account_number_masked,
    verifiedAt: wire.verified_at ?? null,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

/** Only keys the caller set are sent, so `update()` leaves the other details untouched. */
function serializeDetails(params: Partial<CreateBankAccountParams>): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (params.bankName !== undefined) wire.bank_name = params.bankName;
  if (params.accountName !== undefined) wire.account_name = params.accountName;
  if (params.accountNumber !== undefined) wire.account_number = params.accountNumber;
  if (params.branch !== undefined) wire.branch = params.branch;
  return wire;
}

/** The id is an integer; anything else (`NaN`, `1.5`, a string) would build the wrong URL. */
function idPath(id: number, method: string, suffix = ""): string {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new SuqoConfigError(`${method}() requires a positive integer id`);
  }
  return `${BANK_ACCOUNTS_PATH}/${id}${suffix}`;
}

/**
 * `client.bankAccounts` (SDK-SPEC.md §5; `openapi.yaml` `listBankAccounts`/`createBankAccount`/
 * `retrieveBankAccount`/`updateBankAccount`/`deleteBankAccount`/`sendBankAccountOtp`). Flow before
 * `payouts.create()`: `create()` → `sendOtp(id)` → `update(id, { code })`.
 */
export class BankAccountsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Your active bank accounts (one per seller today). Not paginated. */
  async list(): Promise<BankAccount[]> {
    const wire = await this.#http.request<WireBankAccount[]>({ method: "GET", path: BANK_ACCOUNTS_PATH });
    return wire.map(deserializeBankAccount);
  }

  /**
   * Adds the bank account payouts go to. It starts unverified (`verifiedAt: null`): verify it
   * with {@link BankAccountsResource.sendOtp} and {@link BankAccountsResource.update}. A second
   * account is a `ValidationError` with `rawBody.code` `bank_account_limit_reached`.
   * Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async create(params: CreateBankAccountParams): Promise<BankAccount> {
    const wire = await this.#http.request<WireBankAccount, unknown>({
      method: "POST",
      path: BANK_ACCOUNTS_PATH,
      body: serializeDetails(params),
    });
    return deserializeBankAccount(wire);
  }

  /** One bank account by its `id`. */
  async retrieve(id: number): Promise<BankAccount> {
    const wire = await this.#http.request<WireBankAccount>({
      method: "GET",
      path: idPath(id, "bankAccounts.retrieve"),
    });
    return deserializeBankAccount(wire);
  }

  /**
   * Verifies the account with the emailed `code`, changing any details you pass in the same call.
   * Every edit needs a fresh code and leaves the account verified. A wrong or expired code changes
   * nothing: `ValidationError` with `fieldErrors.code`. A pending payout refuses it (`rawBody.code`
   * `bank_account_has_active_payout`). Rate-limited (`RateLimitError`). Not auto-retryable
   * (SDK-SPEC.md §8, §12).
   */
  async update(id: number, params: UpdateBankAccountParams): Promise<BankAccount> {
    const path = idPath(id, "bankAccounts.update");
    const wire = await this.#http.request<WireBankAccount, unknown>({
      method: "PATCH",
      path,
      body: { code: params.code, ...serializeDetails(params) },
    });
    return deserializeBankAccount(wire);
  }

  /**
   * Removes the account. A pending payout refuses it (`rawBody.code`
   * `bank_account_has_active_payout`). Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async delete(id: number): Promise<void> {
    await this.#http.request<undefined>({ method: "DELETE", path: idPath(id, "bankAccounts.delete") });
  }

  /**
   * Emails a 6-digit code, valid 10 minutes, to the seller's verified company or login email (not
   * to the caller); pass it to {@link BankAccountsResource.update}. Sending again replaces the
   * previous code. No verified email: `rawBody.code` `no_verified_email`. Rate-limited
   * (`RateLimitError`). Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async sendOtp(id: number): Promise<void> {
    await this.#http.request<unknown>({ method: "POST", path: idPath(id, "bankAccounts.sendOtp", "/send-otp") });
  }
}
