/**
 * `AbortSignal` combining, with proper listener cleanup (fixes a real leak found in review — see
 * `docs/implementation-plan.md` Ticket 2).
 *
 * @packageDocumentation
 */

/** The result of {@link combineSignals}: the combined signal, plus a cleanup function callers MUST invoke once done with it. */
export interface CombinedSignal {
  /** Aborts as soon as any of the input signals do. */
  signal: AbortSignal;
  /**
   * Removes every listener this call attached to the input signals. Without this, a long-lived,
   * caller-supplied signal shared across many calls (e.g. paginating, each attempt retried)
   * accumulates one never-removed listener per call — a real leak, not hypothetical.
   */
  cleanup: () => void;
}

/**
 * Combines multiple signals into one that aborts as soon as any of them do, with cleanup so
 * listeners don't outlive a single use. Hand-rolled rather than the built-in `AbortSignal.any`
 * (Node 18.17+/20.3+ only) so the SDK's stated Node 18+ floor (addendum §1) holds without a
 * caveat.
 *
 * Callers MUST invoke `cleanup()` once the combined signal is no longer needed (e.g. in a
 * `finally` block) — otherwise this reintroduces the exact listener leak it was written to fix.
 */
export function combineSignals(signals: Array<AbortSignal | undefined>): CombinedSignal {
  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    cleanupFns.push(() => signal.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const fn of cleanupFns) fn();
    },
  };
}
