import { validCategoryId, validIdempotencyKey, validOpaqueId } from "../shared/identifiers.ts";

/**
 * Policy-neutral, PURE request transition decision. NOT an approved service
 * booking lifecycle, public route, D1 write, provider call or notification.
 * Actual transitions come from a founder-approved M-005 policy later.
 */
export type RequestSnapshot<S extends string> = Readonly<{
  requestId: string;
  ownerAccountId: string;
  categoryId: string;
  state: S;
  revision: number;
}>;

export type RequestCommand<S extends string> = Readonly<{
  /** Must be injected by a server-trusted session resolver; never a body/header ID. */
  actorAccountId: string;
  expectedRevision: number;
  idempotencyKey: string;
  toState: S;
}>;

export type RequestReceipt<S extends string> = Readonly<{
  requestId: string;
  actorAccountId: string;
  idempotencyKey: string;
  expectedRevision: number;
  toState: S;
  result: RequestSnapshot<S>;
}>;

export type TransitionPolicy<S extends string> = Readonly<Partial<Record<S, readonly S[]>>>;

export type TransitionDecision<S extends string> =
  | { kind: "apply"; result: RequestSnapshot<S>; receipt: RequestReceipt<S> }
  | { kind: "replay"; receipt: RequestReceipt<S> }
  | { kind: "reject"; code: "INVALID_INPUT" | "NOT_OWNER" | "KEY_CONFLICT" | "STALE_REVISION" | "TRANSITION_DENIED" };

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validState(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

/** Decisions are immutable; persistence adapters must atomically enforce
 * UNIQUE(requestId,idempotencyKey) and CAS(requestId,revision) in the future.
 * priorReceipt MUST come from trusted storage keyed by request+idempotency key.
 */
export function decideRequestTransition<S extends string>(
  current: RequestSnapshot<S>,
  command: RequestCommand<S>,
  policy: TransitionPolicy<S>,
  priorReceipt: RequestReceipt<S> | null = null,
): TransitionDecision<S> {
  // SQLite rows and adapter inputs are runtime values, regardless of their
  // TypeScript declaration. Reject absent snapshots/commands without throwing.
  if (!current || typeof current !== "object" ||
      !command || typeof command !== "object" ||
      !validOpaqueId(current.requestId) ||
      !validOpaqueId(current.ownerAccountId) ||
      !validCategoryId(current.categoryId) ||
      !validState(current.state) || !validRevision(current.revision) ||
      !validOpaqueId(command.actorAccountId) ||
      !validIdempotencyKey(command.idempotencyKey) ||
      !validState(command.toState) || !validRevision(command.expectedRevision) ||
      !policy || typeof policy !== "object") {
    return { kind: "reject", code: "INVALID_INPUT" };
  }

  // Ownership is checked before looking up/replaying any prior response.
  if (current.ownerAccountId !== command.actorAccountId) {
    return { kind: "reject", code: "NOT_OWNER" };
  }

  if (priorReceipt !== null) {
    // A receipt is hydrated from storage at runtime. A malformed result must
    // never throw or be mistaken for a successful idempotent replay.
    if (!priorReceipt || typeof priorReceipt !== "object" ||
        !priorReceipt.result || typeof priorReceipt.result !== "object" ||
        !validOpaqueId(priorReceipt.requestId) ||
        !validOpaqueId(priorReceipt.actorAccountId) ||
        !validIdempotencyKey(priorReceipt.idempotencyKey) ||
        !validRevision(priorReceipt.expectedRevision) ||
        !validState(priorReceipt.toState) ||
        !validOpaqueId(priorReceipt.result.requestId) ||
        !validOpaqueId(priorReceipt.result.ownerAccountId) ||
        !validCategoryId(priorReceipt.result.categoryId) ||
        !validState(priorReceipt.result.state) ||
        !validRevision(priorReceipt.result.revision)) {
      return { kind: "reject", code: "KEY_CONFLICT" };
    }
    if (priorReceipt.requestId !== current.requestId ||
        priorReceipt.actorAccountId !== command.actorAccountId ||
        priorReceipt.idempotencyKey !== command.idempotencyKey ||
        priorReceipt.expectedRevision !== command.expectedRevision ||
        priorReceipt.toState !== command.toState ||
        priorReceipt.result.requestId !== current.requestId ||
        priorReceipt.result.ownerAccountId !== current.ownerAccountId ||
        priorReceipt.result.categoryId !== current.categoryId ||
        priorReceipt.result.state !== command.toState ||
        priorReceipt.result.revision !== command.expectedRevision + 1 ||
        // A replay must never authenticate a receipt from a future revision.
        // A genuine replay may occur AFTER further legitimate revisions.
        current.revision < priorReceipt.result.revision ||
        // Same revision must describe the same state. An out-of-band change
        // without a revision increment cannot replay an outdated success.
        (current.revision === priorReceipt.result.revision &&
          current.state !== priorReceipt.result.state)) {
      return { kind: "reject", code: "KEY_CONFLICT" };
    }
    return { kind: "replay", receipt: priorReceipt };
  }

  if (command.expectedRevision !== current.revision) {
    return { kind: "reject", code: "STALE_REVISION" };
  }

  // No policy = no transition. There is intentionally no default workflow.
  const allowed = Object.prototype.hasOwnProperty.call(policy, current.state)
    ? policy[current.state] : undefined;
  if (!Array.isArray(allowed) || !allowed.includes(command.toState)) {
    return { kind: "reject", code: "TRANSITION_DENIED" };
  }
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    return { kind: "reject", code: "INVALID_INPUT" };
  }
  const result: RequestSnapshot<S> = Object.freeze({
    ...current, state: command.toState, revision: current.revision + 1,
  });
  const receipt: RequestReceipt<S> = Object.freeze({
    requestId: current.requestId,
    actorAccountId: command.actorAccountId,
    idempotencyKey: command.idempotencyKey,
    expectedRevision: command.expectedRevision,
    toState: command.toState,
    result,
  });
  return { kind: "apply", result, receipt };
}
