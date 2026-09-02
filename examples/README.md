# Examples

Runnable scripts against the real SUQO sandbox — not mocked. Each one is self-contained; copy
whichever one you need into your own project.

## Setup

1. Build the SDK once, from the repo root — the examples import `@suqo/sdk` the same way your own
   project would, which resolves to `dist/`:
   ```bash
   npm install
   npm run build
   ```
2. Use a sandbox key here (`su_test_key_...`, from your seller dashboard) — that's what these are
   built for. A live key (`su_key_...`) would work too (the SDK doesn't restrict either way), but
   there's no reason to point example code at real money.
3. Run any script with [`tsx`](https://tsx.is) (already a dev dependency of this repo):
   ```bash
   SUQO_API_KEY=su_test_key_... npx tsx examples/quickstart.ts
   ```

On Windows PowerShell, set the env var separately: `$env:SUQO_API_KEY = "su_test_key_..."`, then
run the `npx tsx ...` command on its own.

## What's here

| Script                                   | Shows                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`quickstart.ts`](quickstart.ts)         | The full flow: list products → create a subscription → verify its webhook. Start here.    |
| [`list-products.ts`](list-products.ts)   | Browsing the catalog — works pre-KYC.                                                     |
| [`subscriptions.ts`](subscriptions.ts)   | `create`/`cancel`/`updateBillingCycle`/`resume`.                                          |
| [`list-customers.ts`](list-customers.ts) | `list`/`retrieve` — read-only.                                                            |
| [`verify-webhook.ts`](verify-webhook.ts) | Signature verification, including a tampered and a stale delivery. Makes no network call. |

## What this doesn't cover

Real data will come back different every run, since it's pulled from _your_ sandbox account, not
a fixed demo dataset. Whichever data these print is genuinely yours.

For the full API surface (pagination, error handling, all constructor options), see
[`../docs/user/`](../docs/user/).
