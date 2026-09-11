# @suqo/sdk

Server-side TypeScript SDK for the SUQO subscription management platform. Lets platform sellers integrate customers, subscriptions, and payments into their own apps without building raw API calls by hand.

> **Server-side only.** This SDK uses your full-access API key and must never be bundled into browser code.

## Install

```bash
npm install @suqo/sdk
```

## Quickstart

```ts
import { SuqoClient } from "@suqo/sdk";

// The key's prefix tells the SDK which environment to talk to — nothing else to configure.
const suqo = new SuqoClient({ apiKey: process.env.SUQO_API_KEY! });

const page = await suqo.products.list();
console.log(page.results);
```

See [`docs/user/authentication.md`](docs/user/authentication.md) for how the API key determines sandbox vs. live, and every topic below for the rest of the surface.

## Docs

| Topic                     | Doc                                                                  |
| ------------------------- | -------------------------------------------------------------------- |
| Examples                  | [`examples/`](examples/) — runnable scripts against your own sandbox |
| Authentication            | [`docs/user/authentication.md`](docs/user/authentication.md)         |
| Products                  | [`docs/user/products.md`](docs/user/products.md)                     |
| Subscriptions             | [`docs/user/subscriptions.md`](docs/user/subscriptions.md)           |
| Customers                 | [`docs/user/customers.md`](docs/user/customers.md)                   |
| Webhooks                  | [`docs/user/webhooks.md`](docs/user/webhooks.md)                     |
| Pagination                | [`docs/user/pagination.md`](docs/user/pagination.md)                 |
| Errors                    | [`docs/user/errors.md`](docs/user/errors.md)                         |
| Rate limiting _(planned)_ | [`docs/user/rate-limiting.md`](docs/user/rate-limiting.md)           |
| Idempotency _(planned)_   | [`docs/user/idempotency.md`](docs/user/idempotency.md)               |

Every exported class and method also carries inline TSDoc — your editor will show it on hover without needing to open these files.

## What's included

- **Dual build** — ESM + CommonJS + `.d.ts` via [`tsup`](https://tsup.egoist.dev) (`dist/index.js`, `index.cjs`, `index.d.ts`).
- **Strict TypeScript** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- **Tests** — [`vitest`](https://vitest.dev), including contract tests run against a mock server built from the same OpenAPI contract the SDK implements.
- **Lint/format** — ESLint (`no-explicit-any: error`) + Prettier.
- **Publish-ready** — `exports` map (import/require/types), `sideEffects: false`, `files: ["dist"]`, `engines.node >=18`, `prepublishOnly` gate.

## Scripts

```bash
npm install
npm run build      # → dist/ (esm + cjs + d.ts)
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run lint
npm run format
```

## License

MIT — see [`LICENSE`](LICENSE).
