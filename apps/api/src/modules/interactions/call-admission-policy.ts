/** Timing and quota policy adopted from the founder-selected Finworkar behavior. */
export const CALL_RING_MS = 90_000;
export const CALL_ATTEMPT_WINDOW_MS = 5 * 60_000;
export const CALL_ATTEMPT_LIMITS = Object.freeze({pair: 8, caller: 20, receiver: 30});

type Scope = keyof typeof CALL_ATTEMPT_LIMITS;
export type CallAttemptWindow = Readonly<{startedAtMs: number; count: number}>;
type CallAttemptWindows = Readonly<Record<Scope, CallAttemptWindow | null>>;

type CallAttemptDecision =
  | Readonly<{kind: "allow"; windows: Record<Scope, CallAttemptWindow>}>
  | Readonly<{kind: "limit"; scope: Scope; retryAfterSeconds: number}>
  | Readonly<{kind: "invalid"}>;

/** Evaluate a new attempt from trusted, transaction-time counters.
 * The caller must commit all three new windows in the same admission
 * transaction. A replay of an existing attempt must bypass this calculation.
 */
export function evaluateCallAttempt(windows: CallAttemptWindows, nowMs: number): CallAttemptDecision {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || nowMs > Number.MAX_SAFE_INTEGER - CALL_ATTEMPT_WINDOW_MS) {
    return {kind:"invalid"};
  }
  const scopes = ["pair", "caller", "receiver"] as const;
  const next = {} as Record<Scope, CallAttemptWindow>;
  let blocked: {scope: Scope; retryAfterSeconds: number} | undefined;
  for (const scope of scopes) {
    const previous = windows[scope];
    if (previous !== null && (!Number.isSafeInteger(previous.startedAtMs) ||
        previous.startedAtMs <= 0 || previous.startedAtMs > nowMs ||
        !Number.isSafeInteger(previous.count) || previous.count < 1)) {
      return {kind:"invalid"};
    }
    const current = previous !== null && nowMs - previous.startedAtMs < CALL_ATTEMPT_WINDOW_MS;
    const startedAtMs = current ? previous.startedAtMs : nowMs;
    const count = current ? previous.count : 0;
    if (count >= CALL_ATTEMPT_LIMITS[scope]) {
      blocked ??= {scope, retryAfterSeconds: Math.ceil(
        (startedAtMs + CALL_ATTEMPT_WINDOW_MS - nowMs) / 1000)};
    } else {
      next[scope] = {startedAtMs, count: count + 1};
    }
  }
  return blocked ? {kind:"limit", ...blocked} : {kind:"allow", windows:next};
}
