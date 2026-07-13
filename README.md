# @suqo/sdk

Server-side TypeScript SDK for the SUQO subscription management platform. Lets platform sellers integrate customers, subscriptions, and payments into their own apps without building raw API calls by hand.

> **Server-side only.** This SDK uses your full-access API key and must never be bundled into browser code.

## What's included

- **Dual build** — ESM + CommonJS + `.d.ts` via [`tsup`](https://tsup.egoist.dev) (`dist/index.js`, `index.cjs`, `index.d.ts`).
- **Strict TypeScript** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- **Tests** — [`vitest`](https://vitest.dev).
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

## Layout

```
src/index.ts        # entry — Client + ApiError stub (replace)
test/index.test.ts   # vitest specs — mock-fetch coverage for the Client stub
tsup.config.ts       # build config
tsconfig.json        # strict compiler options
```

## Test cases included

`test/index.test.ts` mocks the global `fetch` (no real network calls) and covers:

- **Auth header** — `X-Api-Key` is sent on every request.
- **On-Behalf-Of header** — added only when `onBehalfOf` is passed to the client.
- **Custom `baseUrl`** — requests hit the configured host, not just the default.
- **Success path** — parsed JSON body is returned as-is.
- **Error path (404)** — a non-2xx response throws `ApiError` with the right `status` and `body`.
- **Rate limiting (429)** — same error path, confirming status code propagates correctly.
- **Malformed JSON body** — a response that fails to parse doesn't crash the client; it resolves to `undefined`.

Run them with `npm test`.

## Build your SDK — checklist

1. Set `name`, `description`, `author`, `keywords` in `package.json`.
2. Replace the `Client` stub in `src/index.ts`:
   - Add resource classes (e.g. `src/resources/*.ts`) wired onto the client.
   - Add typed request/response interfaces (e.g. `src/types/*.ts`).
   - Build an HTTP helper (auth headers, query/URL building, timeout via `AbortController`, retries with backoff, JSON decode).
   - Define a typed error hierarchy off `ApiError` and map HTTP status → error class.
   - Add pagination helpers if your API paginates.
3. Export everything from `src/index.ts`.
4. Extend `test/index.test.ts` as you add resources — keep using an injected mock `fetch` (no network).
5. `npm run typecheck && npm test && npm run build`.

## License

Apache 2.0
