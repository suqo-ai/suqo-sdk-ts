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
3. Set `SUQO_API_KEY`, either inline per command, or once via a `.env` file in the repo root —
   every script loads it automatically (`dotenv`, already a dev dependency of this repo):
   ```
   SUQO_API_KEY=su_test_key_...
   ```
4. Run any script with [`tsx`](https://tsx.is) (already a dev dependency of this repo):
   ```bash
   npx tsx examples/quickstart.ts
   ```
   or, without a `.env` file, inline for one command:
   ```bash
   SUQO_API_KEY=su_test_key_... npx tsx examples/quickstart.ts
   ```

On Windows PowerShell, the inline form is `$env:SUQO_API_KEY = "su_test_key_..."` on its own line,
then run `npx tsx ...` separately — or just use a `.env` file, which works the same on every shell.

`.env` is already git-ignored at the repo root — nothing you put there gets committed.

## Be careful with the phone number and email you use

`quickstart.ts`/`subscriptions.ts` create a real subscription, which sends real notifications:
**SMS** only with a live key (`su_key_...`); **email** in both sandbox and live, always.

- **Phone** — use the shared live test account **`9845976839`**, or increment from
  **`9800000000`** per run, so the same real number isn't repeatedly texted.
- **Email** — your own address to actually see it, or leave the placeholder if not.

Override via env vars (default `9800000000` / `jane@example.com`):

```bash
SUQO_TEST_PHONE=9845976839 SUQO_TEST_EMAIL=you@example.com npx tsx examples/quickstart.ts
```

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
