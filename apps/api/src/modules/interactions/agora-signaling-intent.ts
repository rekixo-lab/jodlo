import {
  decideSyntheticAgoraCallEvent,
  type AgoraCallCommand,
  type AgoraCallDecision,
  type AgoraCallReceipt,
  type AgoraCallSnapshot,
} from "./agora-call-lifecycle.ts";

/**
 * Provider-neutral, pure signaling OUTCOME for synthetic tests only.
 * No initial ring/remote push, queue message, RTC media, notification or
 * external Agora signaling is created. A durable future adapter must atomically
 * persist the call transition and idempotency receipt BEFORE sending.
 */
export type SyntheticSignalIntent = Readonly<{
  kind: "intent_only";
  signal: "call_answered" | "call_declined" | "call_busy" |
    "call_cancelled" | "call_missed" | "call_connected" | "call_ended";
  /** Which logical audience should eventually receive the update. No identity. */
  recipientRole: "caller" | "worker" | "both";
  revision: number;
}>;

const INTENT_BY_EVENT = Object.freeze({
  accept: ["call_answered", "caller"],
  decline: ["call_declined", "caller"],
  busy: ["call_busy", "caller"],
  cancel: ["call_cancelled", "worker"],
  ring_timeout: ["call_missed", "both"],
  media_ready: ["call_connected", "both"],
  media_failed: ["call_ended", "both"],
  hangup: ["call_ended", "both"],
} as const);

/**
 * Reuses the *same* caller/worker/server actor authorization and CAS
 * revision guard from the existing tested call reducer. Idempotent replay
 * deliberately produces NO second provider-send intent.
 *
 * A returned intent is only a rehearsal; not permission to signal, ring a
 * device, discover a recipient, bypass consent or update persistent state.
 * No call/user IDs, token, number, channel or arbitrary client text is emitted.
 */
export function assessSyntheticAgoraSignalingIntent(
  call: AgoraCallSnapshot,
  command: AgoraCallCommand,
  priorReceipt: AgoraCallReceipt | null = null,
): Readonly<{ kind: "denied"; reason: Extract<AgoraCallDecision,
  { kind: "reject" }>["code"] }> |
  Readonly<{ kind: "replay_suppressed" }> |
  Readonly<{ kind: "transition_only"; next: AgoraCallSnapshot;
    receipt: AgoraCallReceipt; signal: SyntheticSignalIntent }> {
  const result = decideSyntheticAgoraCallEvent(call, command, priorReceipt);
  if (result.kind === "reject") return { kind: "denied", reason: result.code };
  if (result.kind === "replay") {
    return { kind: "replay_suppressed" };
  }
  const pair = INTENT_BY_EVENT[command.event];
  return Object.freeze({
    kind: "transition_only" as const,
    next: result.result,
    receipt: result.receipt,
    signal: Object.freeze({
      kind: "intent_only" as const,
      signal: pair[0],
      recipientRole: pair[1],
      revision: result.result.revision,
    }),
  });
}
