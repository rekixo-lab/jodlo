import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { createFcmProvider, validFcmRegistrationToken } from "../notifications/fcm-provider.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { claimPrivateCallDispatch, releaseUnsentPrivateCallDispatch,
  CURRENT_RING_ELIGIBILITY, CURRENT_RING_ELIGIBILITY_JOINS } from "./private-call-dispatch.ts";

type ReachableDevice = Readonly<{accountId: string; registrationToken: string}>;
type RingDependencies = Readonly<{
  projectId: string;
  accessToken(): Promise<string | null>;
  /** Trusted server lookup for a current, consented, notification-capable device. */
  resolveReachableDevice(receiverId: string): Promise<ReachableDevice | null>;
  request?: typeof fetch;
  now?: () => number;
  /** Test-only smaller budget; live uses the provider's fixed 5-second cap. */
  timeoutMs?: number;
}>;

const READ_RING_TARGET = `
SELECT i.receiver_account_id AS receiverId,i.created_at_ms AS createdAtMs,i.ring_deadline_ms AS ringDeadlineMs
FROM private_call_invitations AS i
JOIN auth_sessions AS s ON s.account_id=i.caller_account_id AND s.token_hash=? AND s.expires_at>MAX(?,unixepoch())
JOIN accounts AS a ON a.id=i.caller_account_id AND a.status='active'
WHERE i.id=? AND i.created_at_ms<=? AND i.ring_deadline_ms>MAX(?,unixepoch()*1000)
`;

const CONFIRM_CLAIMED_RING = `
SELECT 1 AS authorized,min(s.expires_at,receiving.expires_at)*1000 AS sessionDeadlineMs
FROM private_call_invitations AS i
JOIN private_call_dispatch_slots AS slot ON slot.invitation_id=i.id AND slot.receiver_account_id=i.receiver_account_id
JOIN auth_sessions AS s ON s.token_hash=slot.caller_session_hash AND s.token_hash=?1
  AND s.account_id=i.caller_account_id AND s.expires_at>MAX(?2,unixepoch())
JOIN accounts AS caller ON caller.id=i.caller_account_id AND caller.status='active'
${CURRENT_RING_ELIGIBILITY_JOINS}
JOIN private_call_devices AS device ON device.registration_token=?4
JOIN auth_sessions AS receiving ON receiving.token_hash=device.session_hash AND receiving.account_id=i.receiver_account_id
  AND receiving.expires_at>MAX(?2,unixepoch())
WHERE i.id=?3 AND i.phase='ringing' AND i.ring_deadline_ms>MAX(?5,unixepoch()*1000)
  AND slot.expires_at_ms>MAX(?5,unixepoch()*1000) AND ${CURRENT_RING_ELIGIBILITY}
`;

/** Internal transport. A provider acceptance never confirms that Android
 * received or displayed the ring. An uncertain send keeps its slot until the
 * deadline so a retry cannot send the same ring twice.
 */
export async function sendPrivateCallRing(
  db: D1Database, callerBearer: string, invitationId: string, deps: RingDependencies,
): Promise<"provider_accepted" | "delivery_unconfirmed" | "not_sent"> {
  if (!validSessionToken(callerBearer) || !validOpaqueId(invitationId)) return "not_sent";
  const now = deps.now ?? Date.now;
  const requestedAt = now();
  const callerHash = await sessionHash(callerBearer);
  const {results} = await db.prepare(READ_RING_TARGET).bind(
    callerHash, Math.floor(requestedAt / 1000), invitationId, requestedAt, requestedAt,
  ).all<{receiverId:string; createdAtMs:number; ringDeadlineMs:number}>();
  const target = results[0];
  if (!target) return "not_sent";

  let claimed = false;
  const provider = createFcmProvider({
    projectId: deps.projectId,
    accessToken: deps.accessToken,
    request: deps.request,
    now,
    timeoutMs: deps.timeoutMs,
    async resolveDestination(_job, mayContinue) {
      const device = await deps.resolveReachableDevice(target.receiverId);
      // A prior provider timeout may have already returned to Customer;
      // never let the old device lookup claim the Worker's D1 ring slot.
      if (!mayContinue()) return null;
      if (!device || device.accountId !== target.receiverId ||
          !validFcmRegistrationToken(device.registrationToken)) return null;
      const slot = await claimPrivateCallDispatch(db, callerBearer, invitationId, device.accountId, now());
      if (!slot || slot.ringDeadlineMs !== target.ringDeadlineMs) return null;
      claimed = true;
      // The D1 mutation can finish after the provider already returned.
      // No FCM POST has started on this path; release ONLY this exact
      // invitation/session claim so it cannot block the next legitimate call.
      // Never release after an actual (possibly uncertain) Firebase POST.
      const releaseUnsent = async () => {
        try {
          if (await releaseUnsentPrivateCallDispatch(
            db, callerBearer, invitationId, device.accountId,
          )) claimed = false;
        } catch {
          // A failed cleanup is uncertain: retain the single reserved slot
          // until its deadline rather than risk an accidental duplicate ring.
        }
      };
      if (!mayContinue()) {
        await releaseUnsent();
        return null;
      }
      // A completed SQL mutation can wait in transit while either session,
      // device, consent, relationship or listing is withdrawn. Prove this
      // exact claimed dispatch and current receiver installation again after
      // that await, immediately before yielding its token to the FCM sender.
      let authorized = false;
      try {
        const confirmedAt = now();
        const {results} = await db.prepare(CONFIRM_CLAIMED_RING)
          .bind(callerHash, Math.floor(confirmedAt / 1000), invitationId,
            device.registrationToken, confirmedAt).all<{authorized: number; sessionDeadlineMs: number}>();
        authorized = results.length === 1 && results[0].authorized === 1 && results[0].sessionDeadlineMs > now();
      } catch { /* no HTTP POST has started, so this exact claim is releasable */ }
      if (!authorized || !mayContinue()) {
        await releaseUnsent();
        return null;
      }
      return device.registrationToken;
    },
  });
  const result = await provider.send({
    kind:"notification_delivery_v1",
    eventId:invitationId,
    recipientAccountId:target.receiverId,
    eventType:"call_ring",
    createdAtMs:target.createdAtMs,
    expiresAtMs:target.ringDeadlineMs,
  });
  if (result === "accepted") return "provider_accepted";
  return claimed && result === "transient" ? "delivery_unconfirmed" : "not_sent";
}
