import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { CURRENT_RING_ELIGIBILITY, CURRENT_RING_ELIGIBILITY_JOINS } from "./private-call-dispatch.ts";

const PARTICIPANT = `
  JOIN auth_sessions AS s ON s.token_hash=?1 AND s.expires_at>?2
    AND s.account_id IN (i.caller_account_id,i.receiver_account_id)
  JOIN accounts AS actor ON actor.id=s.account_id AND actor.status='active'
  WHERE i.id=?3 AND i.expires_at_ms>?4
`;

const CURRENT_RING = `
  i.ring_deadline_ms>?4 AND EXISTS (
    SELECT 1 FROM accounts AS caller
    JOIN private_call_dispatch_slots AS slot ON slot.invitation_id=i.id AND slot.expires_at_ms>?4
    JOIN auth_sessions AS calling_session ON calling_session.token_hash=slot.caller_session_hash
      AND calling_session.account_id=caller.id AND calling_session.expires_at>?2
    ${CURRENT_RING_ELIGIBILITY_JOINS}
    WHERE caller.id=i.caller_account_id AND caller.status='active' AND ${CURRENT_RING_ELIGIBILITY}
  )
`;

const PARTICIPANTS_FREE = `
  NOT EXISTS (
    SELECT 1 FROM private_call_invitations AS other
    WHERE other.id<>i.id AND other.phase='accepted' AND other.expires_at_ms>?4
      AND (other.caller_account_id IN (i.caller_account_id,i.receiver_account_id)
        OR other.receiver_account_id IN (i.caller_account_id,i.receiver_account_id))
  )
`;

type Phase = "ringing" | "accepted" | "declined" | "cancelled" | "ended" | "missed" | "pending";
type Action = "ack" | "accept" | "decline" | "cancel" | "hangup";

const TARGET: Readonly<Record<Exclude<Action, "ack">, Phase>> = {
  accept: "accepted", decline: "declined", cancel: "cancelled", hangup: "ended",
};

export function validCallAction(value: unknown): value is Action {
  return value === "ack" || (typeof value === "string" && Object.hasOwn(TARGET, value));
}

export async function ownPrivateCallSignal(
  db: D1Database, bearer: string, invitationId: string, action?: Action, now = Date.now(),
): Promise<Readonly<{role: "caller" | "receiver"; phase: Phase; ringDeadlineMs: number}> | null> {
  if (!validSessionToken(bearer) || !validOpaqueId(invitationId)) return null;
  const params = [await sessionHash(bearer), Math.floor(now / 1000), invitationId, now] as const;
  if (action === "ack") {
    const result = await db.prepare(`
      UPDATE private_call_invitations SET received_at_ms=COALESCE(received_at_ms,?4)
      WHERE id IN (
        SELECT i.id FROM private_call_invitations AS i ${PARTICIPANT}
          AND i.phase='ringing' AND i.created_at_ms<=?4 AND s.account_id=i.receiver_account_id
          AND EXISTS (SELECT 1 FROM private_call_devices WHERE session_hash=s.token_hash)
          AND ${CURRENT_RING}
      )
    `).bind(...params).run();
    if (!result.meta.changes) return null;
  } else if (action !== undefined) {
    const result = await db.prepare(`
      UPDATE private_call_invitations SET phase=?5,
        accepted_session_hash=CASE WHEN ?5='accepted' THEN ?1 ELSE NULL END,
        terminal_at_ms=CASE WHEN ?5='accepted' THEN NULL ELSE max(?4,created_at_ms) END,
        history_outcome=CASE WHEN ?5='accepted' THEN NULL ELSE ?5 END
      WHERE id IN (
        SELECT i.id FROM private_call_invitations AS i ${PARTICIPANT}
          AND (
            (i.phase='ringing' AND ?5='cancelled' AND s.account_id=i.caller_account_id)
            OR (i.phase='ringing' AND ?5 IN ('accepted','declined')
                AND s.account_id=i.receiver_account_id AND ${CURRENT_RING}
                AND (?5='declined' OR ${PARTICIPANTS_FREE}))
            OR (i.phase='accepted' AND ?5='ended')
          )
      )
    `).bind(...params, TARGET[action]).run();
    if (!result.meta.changes) {
      const current = await ownPrivateCallSignal(db, bearer, invitationId, undefined, now);
      const requiredRole = action === "cancel" ? "caller" : "receiver";
      return current?.phase === TARGET[action] && (action === "hangup" || current.role === requiredRole)
        ? current : null;
    }
  }
  const { results } = await db.prepare(`
    SELECT CASE WHEN s.account_id=i.caller_account_id THEN 'caller' ELSE 'receiver' END AS role,
      CASE WHEN i.phase<>'ringing' THEN i.phase
           WHEN i.ring_deadline_ms<=?4 THEN 'missed'
           WHEN ${CURRENT_RING} THEN 'ringing'
           ELSE 'pending' END AS phase,
      i.ring_deadline_ms AS ringDeadlineMs
    FROM private_call_invitations AS i ${PARTICIPANT}
      AND (s.account_id=i.caller_account_id OR i.phase<>'ringing' OR (${CURRENT_RING}))
  `).bind(...params).all<{role:"caller"|"receiver"; phase:Phase; ringDeadlineMs:number}>();
  return results[0] ?? null;
}
