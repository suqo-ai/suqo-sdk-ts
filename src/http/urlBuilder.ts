/**
 * URL construction with the trailing slash structurally guaranteed (SDK-SPEC.md §3).
 *
 * @packageDocumentation
 */

/** Query parameter values accepted by {@link buildUrl}. `undefined` values are omitted entirely. */
export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * Builds a request URL from a base URL and a path, guaranteeing the path ends in `/` — never left
 * to the caller to remember (SDK-SPEC.md §3). Query params are appended *after* the slash, e.g.
 * `/api/v1/subscriptions/?page=2&page_size=50`.
 *
 * @param baseUrl - The resolved environment base URL (`SdkConfig.baseUrl`), no trailing slash.
 * @param path - The route path, e.g. `/api/v1/products`. A missing trailing slash is added here,
 * not assumed to already be correct — this is the SDK's last line of defense for SDK-SPEC.md §3,
 * not a courtesy extended to a caller who might get it wrong.
 * @param query - Optional query params, appended after the trailing slash. `undefined` values are
 * skipped, so callers can pass `{ page, pageSize }` straight through without filtering first.
 */
export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  const url = new URL(normalizedPath, baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}
