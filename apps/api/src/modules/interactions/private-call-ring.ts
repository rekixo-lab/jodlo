import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { createFcmProvider, validFcmRegistrationToken } from "../notifications/fcm-provider.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { claimPrivateCallDispatch } from "./private-call-dispatch.ts";

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
JOIN auth_sessions AS s ON s.account_id=i.caller_account_id AND s.token_hash=? AND s.expires_at>?
JOIN accounts AS a ON a.id=i.caller_account_id AND a.status='active'
WHERE i.id=? AND i.created_at_ms<=? AND i.ring_deadline_ms>?
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
  const {results} = await db.prepare(READ_RING_TARGET).bind(
    await sessionHash(callerBearer), Math.floor(requestedAt / 1000), invitationId, requestedAt, requestedAt,
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
      // The D1 claim itself may take longer than the provider budget.
      // Do not initiate a late Firebase POST after it finishes.
      if (!mayContinue()) return null;
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
