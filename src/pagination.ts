import type { QueryParams } from "./http/urlBuilder.js";

/**
 * The common paginated-list envelope every list endpoint returns (SDK-SPEC.md §6).
 *
 * @packageDocumentation
 */

/** The page-number pagination envelope common to every list endpoint (SDK-SPEC.md §6). */
export interface PaginationEnvelope<T> {
  /** Total row count across every page, not just this one. */
  count: number;
  /** URL of the next page, or `null` on the last page. */
  next: string | null;
  /** URL of the previous page, or `null` on the first page. */
  previous: string | null;
  results: T[];
}

/**
 * The four extra status counts the Subscriptions list adds on top of the common envelope
 * (SDK-SPEC.md §6, `openapi.yaml`'s `SubscriptionListEnvelope`).
 */
export interface SubscriptionStatusCounts {
  totalSubscriptions: number;
  activeSubscriptions: number;
  dueSubscriptions: number;
  inactiveSubscriptions: number;
}

/**
 * The Subscriptions list envelope: the common shape plus the four extra counts, surfaced
 * alongside `results` rather than replacing the common envelope shape (SDK-SPEC.md §6). Generic
 * over `T` so this file doesn't need to know about the `Subscription` type — Ticket 4 supplies it.
 */
export type SubscriptionPaginationEnvelope<T> = PaginationEnvelope<T> & SubscriptionStatusCounts;

/** Manual pagination params a caller can pass instead of using `listAll`. */
export interface PageParams {
  /** 1-indexed page number. Server default is 1 if omitted. */
  page?: number;
  /** Results per page (server max 100, server default 20 if omitted). */
  pageSize?: number;
}

/**
 * Maps {@link PageParams}' camelCase fields to the wire's snake_case query params
 * (`pageSize` → `page_size`), so every future paginated resource method shares one mapping
 * instead of re-deriving it. `undefined` fields are omitted, matching `buildUrl`'s own
 * omission rule (Ticket 2) — a caller can pass `{ page, pageSize }` straight through unfiltered.
 */
export function toPageQuery(params?: PageParams): QueryParams {
  return {
    page: params?.page,
    page_size: params?.pageSize,
  };
}
