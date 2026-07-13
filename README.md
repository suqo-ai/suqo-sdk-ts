# SDK Starter Template

Bare, type-safe TypeScript SDK scaffold. Industry-standard tooling, zero implementation — fill in your own client, resources, and types.

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
src/index.ts   # entry — Client + ApiError stub (replace)
test/          # vitest specs
tsup.config.ts # build config
tsconfig.json  # strict compiler options
```

## Build your SDK — checklist

1. Set `name`, `description`, `author`, `keywords` in `package.json`.
2. Replace the `Client` stub in `src/index.ts`:
   - Add resource classes (e.g. `src/resources/*.ts`) wired onto the client.
   - Add typed request/response interfaces (e.g. `src/types/*.ts`).
   - Build an HTTP helper (auth headers, query/URL building, timeout via `AbortController`, retries with backoff, JSON decode).
   - Define a typed error hierarchy off `ApiError` and map HTTP status → error class.
   - Add pagination helpers if your API paginates.
3. Export everything from `src/index.ts`.
4. Cover it in `test/` with an injected mock `fetch` (no network).
5. `npm run typecheck && npm test && npm run build`.

## License

MIT
