import { AccessToken2, ServiceRtc } from "agora-token/src/AccessToken2.js";
import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { CURRENT_RING_ELIGIBILITY, CURRENT_RING_ELIGIBILITY_JOINS } from "./private-call-dispatch.ts";

export const JODLO_AGORA_APP_ID = "59d30e0611af4ecca30788d74c3cba85";
const MAX_TOKEN_SECONDS = 60;

const MEDIA_ELIGIBILITY = `
  SELECT CASE WHEN calling_session.token_hash=?1 THEN 1 ELSE 2 END AS uid,
         min(i.expires_at_ms,calling_session.expires_at*1000,
           answering_session.expires_at*1000) AS deadline
  FROM private_call_invitations AS i
  JOIN private_call_dispatch_slots AS slot ON slot.invitation_id=i.id
  JOIN auth_sessions AS calling_session ON calling_session.token_hash=slot.caller_session_hash
    AND calling_session.account_id=i.caller_account_id AND calling_session.expires_at>?2
  JOIN auth_sessions AS answering_session ON answering_session.token_hash=i.accepted_session_hash
    AND answering_session.account_id=i.receiver_account_id AND answering_session.expires_at>?2
  JOIN accounts AS caller ON caller.id=i.caller_account_id AND caller.status='active'
  ${CURRENT_RING_ELIGIBILITY_JOINS}
  WHERE i.id=?3 AND i.phase='accepted' AND i.expires_at_ms>?4
    AND ?1 IN (calling_session.token_hash,answering_session.token_hash)
    AND ${CURRENT_RING_ELIGIBILITY}
`;

/** Controlled audio verification. The existing invitation lifetime bounds the
 * grant. No purchase balance or production call duration is inferred from it.
 */
export async function issueOwnAgoraAudioGrant(
  db: D1Database, bearer: string, id: string, certificate: string, now = Date.now(),
) {
  if (!validSessionToken(bearer) || !validOpaqueId(id) || !/^[a-f\d]{32}$/i.test(certificate)) return null;
  const {results} = await db.prepare(MEDIA_ELIGIBILITY).bind(
    await sessionHash(bearer), Math.floor(now / 1000), id, now,
  ).all<{uid:1|2; deadline:number}>();
  const grant = results[0];
  if (!grant) return null;
  const seconds = Math.min(MAX_TOKEN_SECONDS, Math.floor((grant.deadline - now) / 1000));
  if (seconds < 1) return null;

  const channel = `jodlo-${id}`;
  const token = new AccessToken2(JODLO_AGORA_APP_ID, certificate, Math.floor(now / 1000), seconds);
  const rtc = new ServiceRtc(channel, grant.uid);
  rtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, seconds);
  rtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, seconds);
  token.add_service(rtc);
  const value = token.build();
  if (!value) return null;
  return {appId:JODLO_AGORA_APP_ID,channel,uid:grant.uid,token:value,expiresInSeconds:seconds};
}
