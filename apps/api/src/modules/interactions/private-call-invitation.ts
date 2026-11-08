import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validIdempotencyKey, validOpaqueId } from "../shared/identifiers.ts";
import { PUBLIC_LISTING_ELIGIBILITY } from "../workers/listings.ts";
import { CALL_ATTEMPT_WINDOW_MS, CALL_RING_MS } from "./call-admission-policy.ts";
import {
  CALL_ATTEMPT_AVAILABLE, CALL_ATTEMPT_WINDOWS_CTE, callAttemptBindings,
  prepareInvitationQuotaReservation,
} from "./call-attempt-windows.ts";
import { readCallerSessionBoundAgoraOptInTarget } from "./request-target.ts";

const CREATE_INVITATION = CALL_ATTEMPT_WINDOWS_CTE + `
INSERT INTO private_call_invitations(id,caller_account_id,receiver_account_id,listing_id,
  attempt_key_hash,consent_revision,created_at_ms,ring_deadline_ms,expires_at_ms,availability_revision)
SELECT ?11,?2,?3,wl.id,?12,pref.revision,?9,?13,?10,avail.revision
FROM auth_sessions AS s
JOIN worker_listings AS wl ON wl.id=?14 AND wl.worker_account_id=?3
JOIN accounts AS a ON a.id=wl.worker_account_id
JOIN worker_profiles AS wp ON wp.account_id=a.id
JOIN categories AS c ON c.id=wl.category_id
JOIN worker_agora_call_preferences AS pref ON pref.account_id=a.id AND pref.calls_enabled=1
JOIN worker_agora_availability_preferences AS avail ON avail.account_id=a.id AND avail.accepting_calls=1
WHERE s.account_id=?2 AND s.token_hash=?15 AND s.expires_at>?16 AND ${PUBLIC_LISTING_ELIGIBILITY}
  AND NOT EXISTS (SELECT 1 FROM agora_account_blocks
    WHERE (blocker_account_id=?2 AND blocked_account_id=?3)
       OR (blocker_account_id=?3 AND blocked_account_id=?2))
  AND ${CALL_ATTEMPT_AVAILABLE}
ON CONFLICT(caller_account_id,attempt_key_hash) DO NOTHING
`;

const READ_INVITATION = `
SELECT i.id,i.listing_id AS listingId,i.ring_deadline_ms AS ringDeadlineMs
FROM auth_sessions AS s
JOIN accounts AS a ON a.id=s.account_id AND a.status='active'
JOIN private_call_invitations AS i ON i.caller_account_id=a.id
WHERE s.token_hash=? AND s.expires_at>? AND i.attempt_key_hash=? AND i.expires_at_ms>?
`;

type InvitationResult =
  | Readonly<{kind:"created" | "replay"; invitationId:string; ringDeadlineMs:number}>
  | Readonly<{kind:"denied"}>;

/** Private preparation only. The recorded invitation does not authorize a
 * provider notification or media token. Dispatch must recheck current consent,
 * blocks and eligibility, and verify actual recipient reachability.
 */
export async function preparePrivateCallInvitation(
  db: D1Database, bearer: string, listingId: string, attemptKey: string, nowMs = Date.now(),
): Promise<InvitationResult> {
  if (!validSessionToken(bearer) || !validOpaqueId(listingId) || !validIdempotencyKey(attemptKey) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 || nowMs > Number.MAX_SAFE_INTEGER - CALL_ATTEMPT_WINDOW_MS) {
    return {kind:"denied"};
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  const [tokenHash, attemptHash] = await Promise.all([sessionHash(bearer), sessionHash(attemptKey)]);
  const read = async () => {
    const {results} = await db.prepare(READ_INVITATION).bind(tokenHash, nowSeconds, attemptHash, nowMs)
      .all<{id:string; listingId:string; ringDeadlineMs:number}>();
    return results[0];
  };
  const replay = await read();
  if (replay) {
    return replay.listingId === listingId
      ? {kind:"replay", invitationId:replay.id, ringDeadlineMs:replay.ringDeadlineMs}
      : {kind:"denied"};
  }
  const target = await readCallerSessionBoundAgoraOptInTarget(db, bearer, listingId);
  if (!target) return {kind:"denied"};
  const {requesterAccountId: caller, workerAccountId: receiver} = target;
  const invitationId = crypto.randomUUID();
  await db.batch([
    db.prepare(CREATE_INVITATION).bind(...callAttemptBindings(caller, receiver, nowMs),
      invitationId, attemptHash, nowMs + CALL_RING_MS, listingId, tokenHash, nowSeconds),
    prepareInvitationQuotaReservation(db, caller, receiver, nowMs, invitationId),
  ]);
  const row = await read();
  if (!row || row.listingId !== listingId) return {kind:"denied"};
  return {kind:row.id === invitationId ? "created" : "replay",
    invitationId:row.id, ringDeadlineMs:row.ringDeadlineMs};
}

export async function purgeExpiredPrivateInvitations(db: D1Database, nowMs: number): Promise<void> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Invalid cleanup time");
  const expiredPage = "SELECT id FROM private_call_invitations WHERE expires_at_ms<=? ORDER BY expires_at_ms,id LIMIT 500";
  for (let batch = 0; batch < 20; batch++) {
    const {results} = await db.prepare("SELECT id FROM private_call_invitations WHERE expires_at_ms<=? LIMIT 1")
      .bind(nowMs).all<{id:string}>();
    if (!results.length) break;
    await db.batch([
      db.prepare(`
        UPDATE private_call_invitations
        SET terminal_at_ms=CASE WHEN phase='ringing' THEN ring_deadline_ms ELSE expires_at_ms END,
            history_outcome=CASE WHEN phase='ringing' THEN 'missed' ELSE 'ended' END
        WHERE id IN (${expiredPage}) AND phase IN ('ringing','accepted') AND terminal_at_ms IS NULL
      `).bind(nowMs),
      db.prepare(`DELETE FROM private_call_invitations WHERE id IN (${expiredPage})`).bind(nowMs),
    ]);
  }
}
