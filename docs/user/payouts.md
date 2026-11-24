# Payouts

`create()`, `list()` and `retrieve()`: request a payout of your due transactions, then track whether it has been paid.

## Requesting one

```ts
const payout = await suqo.payouts.create(); // no arguments
payout.status; // "PENDING"
```

It pays all your due transactions, after fees and unbilled SMS usage, to your **verified bank account**. The SDK doesn't wrap bank-account management yet; add and verify it in the dashboard for now.

A refusal throws `ValidationError`. Its `message` says why, and `err.rawBody.code` names the reason:

| `code`                          | Meaning                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `pending_payout_request_exists` | A payout is already pending; only one at a time.                 |
| `payout_below_minimum`          | The net amount is below the minimum payout.                      |
| `no_transactions_due`           | Nothing to pay out.                                              |
| `bank_account_not_found`        | No bank account; add one (in the dashboard, for now).            |
| `bank_account_not_verified`     | The bank account isn't verified yet.                             |

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
