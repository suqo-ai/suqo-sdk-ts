/**
 * Bank-account model types (`specs/openapi.yaml` `BankAccount` / `CreateBankAccountRequest` /
 * `UpdateBankAccountRequest` — SDK-SPEC.md §5). The account payouts go to.
 *
 * @packageDocumentation
 */

/** The bank account payouts go to (`openapi.yaml` `BankAccount`). One per seller today. */
export interface BankAccount {
  /** An integer, unlike most SUQO ids. */
  id: number;
  bankName: string;
  accountName: string;
  branch: string;
  /** The full number while unverified, so you can check it before verifying; `****4521` once verified. */
  accountNumberMasked: string;
  /** When the account was last verified (every edit re-verifies it); `null` until first verified. */
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What `bankAccounts.create(params)` accepts (`openapi.yaml` `CreateBankAccountRequest`, renamed). */
export interface CreateBankAccountParams {
  bankName: string;
  accountName: string;
  /** 7–21 characters. */
  accountNumber: string;
  branch: string;
}

/**
 * What `bankAccounts.update(id, params)` accepts (`openapi.yaml` `UpdateBankAccountRequest`,
 * renamed): the emailed `code`, plus any details to change in the same call.
 */
export interface UpdateBankAccountParams {
  /**
   * The 6-digit code from `bankAccounts.sendOtp()`, as typed from the email. Sent as a string
   * (accepted; Swagger says integer). Single use, valid 10 minutes; every edit needs a fresh one.
   */
  code: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  branch?: string;
}
