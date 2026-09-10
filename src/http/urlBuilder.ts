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
 * `path` may also be an already-complete absolute URL with its own query string already attached
 * (e.g. a pagination envelope's `next` field, Ticket 3) — `baseUrl` is then ignored per the
 * `URL(path, base)` constructor's own semantics, and the existing query string is preserved
 * untouched. This only works correctly because the trailing-slash check below runs against the
 * *parsed pathname*, not the raw input string — checking the raw string (found in review: the
 * original implementation did exactly this) would append `/` after an existing query string and
 * corrupt whichever query param happened to be last (e.g. `page_size=50` silently becoming
 * `page_size=50/`).
 *
 * @param baseUrl - The resolved environment base URL (`SdkConfig.baseUrl`), no trailing slash.
 * @param path - The route path, e.g. `/api/v1/products`, OR an already-complete absolute URL to
 * use as-is (e.g. a `next` link). A missing trailing slash on the *path portion* is added here,
 * not assumed to already be correct — this is the SDK's last line of defense for SDK-SPEC.md §3,
 * not a courtesy extended to a caller who might get it wrong.
 * @param query - Optional query params, merged in on top of any the URL already carries.
 * `undefined` values are skipped, so callers can pass `{ page, pageSize }` straight through
 * without filtering first.
 */
export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const url = new URL(path, baseUrl);

  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}
