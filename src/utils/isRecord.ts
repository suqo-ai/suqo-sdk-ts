/**
 * True when `value` is a plain object worth reading properties off of — `typeof null` is
 * `"object"` in JavaScript, so that's excluded explicitly. Shared by every layer that has to look
 * at an untyped, server-supplied value before trusting its shape (`mapHttpError`'s response
 * bodies, the resource serialization boundary's request/response bodies) — previously duplicated
 * privately in more than one of them.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
