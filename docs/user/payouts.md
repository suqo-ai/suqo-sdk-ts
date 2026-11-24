# Payouts

`create()`, `list()` and `retrieve()`: request a payout of your due transactions, then track whether it has been paid. Payouts go to your verified bank account, managed with `suqo.bankAccounts` ([below](#your-bank-account)).

## Requesting one

```ts
const payout = await suqo.payouts.create(); // no arguments
payout.status; // "PENDING"
```

It pays all your due transactions, after fees and unbilled SMS usage, to your **verified bank account**. Add and verify it first; see [Your bank account](#your-bank-account).

A refusal throws `ValidationError`. Its `message` says why, and `err.rawBody.code` names the reason:

| `code`                          | Meaning                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `pending_payout_request_exists` | A payout is already pending; only one at a time.                 |
| `payout_below_minimum`          | The net amount is below the minimum payout.                      |
| `no_transactions_due`           | Nothing to pay out.                                              |
| `bank_account_not_found`        | No bank account; add one with `bankAccounts.create()`.           |
| `bank_account_not_verified`     | Not verified yet; `sendOtp()` then `update(id, { code })`.       |

```ts
try {
  await suqo.payouts.create();
} catch (err) {
  if (err instanceof ValidationError && (err.rawBody as { code?: string })?.code === "payout_below_minimum") {
    // wait for more transactions
  }
}
```

The SDK never retries `create()` automatically, like every write. A repeat after success can't pay twice: it gets `pending_payout_request_exists`.

## Listing

```ts
const page = await suqo.payouts.list();
page.results; // Payout[], newest first

for await (const payout of suqo.payouts.autoPaging({ pageSize: 100 })) {
  // every payout, across every page
}
```

Paginated like every other list endpoint. See [`pagination.md`](pagination.md).

## Retrieving one

```ts
const payout = await suqo.payouts.retrieve("PYT-MF4G9W-CTEP55");
payout.status; // "PENDING" | "COMPLETED"
```

`payoutId` is a `PYT-…` string. An unknown id throws `NotFoundError`.

## The `Payout` object

| Field             | Type             | Notes                                               |
| ----------------- | ---------------- | --------------------------------------------------- |
| `payoutId`        | `string`         | `PYT-…`                                             |
| `status`          | `string`         | `PENDING`, or `COMPLETED` once Suqo has paid it out |
| `amount`          | `string`         | Gross total of the transactions in this payout      |
| `providerCharge`  | `string`         | Payment gateway fees                                |
| `suqoPlatformFee` | `string`         | Suqo platform fee                                   |
| `smsCharge`       | `string`         | SMS usage billed into this payout                   |
| `netAmount`       | `string`         | What is paid to your bank account, after fees       |
| `requestedDate`   | `string`         | ISO 8601                                            |
| `paidDate`        | `string \| null` | `null` until paid                                   |
| `receiptUrl`      | `string \| null` | Payment receipt, once uploaded; can still be `null` on a `COMPLETED` payout |

Amounts are decimal strings with two decimals (e.g. `"11835.00"`), never numbers, so nothing is lost to float rounding. Dates carry the server's offset, with or without microseconds (e.g. `"2026-11-05T15:58:47.196194+05:45"`, `"2026-11-23T13:21:48+05:45"`); parse them, don't compare them as strings. `status` may be a value the API adds later. Handle unknown values rather than assuming only the two above.

## Your bank account

One per seller. Add it, then verify it with a code emailed to your company (or login) email, not to the caller:

```ts
const account = await suqo.bankAccounts.create({
  bankName: "Nabil Bank",
  accountName: "Himalayan Tea Pvt. Ltd.",
  accountNumber: "0123456789",
  branch: "Kathmandu",
});
account.verifiedAt; // null

await suqo.bankAccounts.sendOtp(account.id); // emails a 6-digit code, valid 10 minutes
const verified = await suqo.bankAccounts.update(account.id, { code: "123456" });
verified.accountNumberMasked; // "****6789"
```

- `id` is an integer. `code` is sent as a string, exactly as typed from the email.
- Until verified, `accountNumberMasked` is the full account number; don't log it or show it publicly.
- Editing details also goes through `update()` and needs a fresh code each time: `update(id, { code, branch: "Lalitpur" })`. The account stays verified, and each edit re-verifies it, so `verifiedAt` becomes the time of that edit.
- `list()` returns your accounts as a plain array (not paginated); `retrieve(id)` returns one; `delete(id)` removes it.
- A second account is refused (`rawBody.code` `bank_account_limit_reached`). `update()` and `delete()` are refused while a payout is pending (`bank_account_has_active_payout`), and `sendOtp()` when you have no verified email (`no_verified_email`).
- A wrong or expired code throws `ValidationError` with the message in `err.fieldErrors.code`, not `rawBody.code`.
- `sendOtp()` and `update()` are rate-limited (`RateLimitError`). No bank-account write is retried automatically.
