import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";

export const CURRENT_RING_ELIGIBILITY_JOINS = `JOIN worker_listings AS wl ON wl.id=i.listing_id AND wl.worker_account_id=i.receiver_account_id
JOIN accounts AS a ON a.id=i.receiver_account_id
JOIN worker_profiles AS wp ON wp.account_id=a.id
JOIN categories AS c ON c.id=wl.category_id
JOIN worker_agora_call_preferences AS pref
  ON pref.account_id=a.id AND pref.calls_enabled=1 AND pref.revision=i.consent_revision
JOIN worker_agora_availability_preferences AS avail ON avail.account_id=a.id AND avail.accepting_calls=1
  AND avail.revision=i.availability_revision`;

export const CURRENT_RING_ELIGIBILITY = `${PUBLIC_LISTING_ELIGIBILITY}
  AND NOT EXISTS (SELECT 1 FROM agora_account_blocks
    WHERE (blocker_account_id=i.caller_account_id AND blocked_account_id=i.receiver_account_id)
       OR (blocker_account_id=i.receiver_account_id AND blocked_account_id=i.caller_account_id))`;

const CLAIM_DISPATCH = `
INSERT INTO private_call_dispatch_slots(receiver_account_id,invitation_id,expires_at_ms,caller_session_hash)
SELECT i.receiver_account_id,i.id,i.ring_deadline_ms,s.token_hash
FROM private_call_invitations AS i
JOIN auth_sessions AS s ON s.account_id=i.caller_account_id AND s.token_hash=? AND s.expires_at>?
JOIN accounts AS caller ON caller.id=i.caller_account_id AND caller.status='active'
${CURRENT_RING_ELIGIBILITY_JOINS}
WHERE i.id=? AND i.receiver_account_id=? AND i.created_at_ms<=? AND i.ring_deadline_ms>?
  AND i.phase='ringing' AND ${CURRENT_RING_ELIGIBILITY}
  AND NOT EXISTS (
    SELECT 1 FROM private_call_invitations AS active
    WHERE active.phase='accepted' AND active.expires_at_ms>?
      AND (active.caller_account_id IN (i.caller_account_id,i.receiver_account_id)
        OR active.receiver_account_id IN (i.caller_account_id,i.receiver_account_id))
  )
ON CONFLICT(receiver_account_id) DO UPDATE SET
  invitation_id=excluded.invitation_id, expires_at_ms=excluded.expires_at_ms,
  caller_session_hash=excluded.caller_session_hash
WHERE private_call_dispatch_slots.expires_at_ms<=?
RETURNING invitation_id AS invitationId,expires_at_ms AS ringDeadlineMs
`;

type DispatchSlot = Readonly<{invitationId: string; ringDeadlineMs: number}>;

/** Internal claim. reachableReceiverId must come from an authenticated provider
 * presence check. Neither the request body nor the availability preference is
 * a source of reachability. The claim reserves an unsent slot only.
 */
export async function claimPrivateCallDispatch(
  db: D1Database, callerBearer: string, invitationId: string,
  reachableReceiverId: string | null, nowMs = Date.now(),
): Promise<DispatchSlot | null> {
  if (!validSessionToken(callerBearer) || !validOpaqueId(invitationId) ||
      !validOpaqueId(reachableReceiverId) || !Number.isSafeInteger(nowMs) || nowMs <= 0) return null;
  const {results} = await db.prepare(CLAIM_DISPATCH).bind(
    await sessionHash(callerBearer), Math.floor(nowMs / 1000),
    invitationId, reachableReceiverId, nowMs, nowMs, nowMs, nowMs,
  ).all<DispatchSlot>();
  return results[0] ?? null;
}
