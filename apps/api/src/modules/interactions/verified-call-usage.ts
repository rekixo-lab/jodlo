import type {D1Database} from "../../data/d1.ts";
import {sessionHash, validSessionToken} from "../identity/sessions.ts";
import {validOpaqueId} from "../shared/identifiers.ts";
import {refundReviewDemandSql} from "./play-refund-review.ts";
import {CURRENT_RING_ELIGIBILITY, CURRENT_RING_ELIGIBILITY_JOINS} from "./private-call-dispatch.ts";

export const CALL_USAGE_POLICY_VERSION = "agora-overlap-v1";
export const CALL_USAGE_CLEANUP_CRON = "* * * * *";
export const CALL_USAGE_EVENT_GRACE_MS = 120_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const validHash=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)&&value!=="0".repeat(64);
const validTime=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<Number.MAX_SAFE_INTEGER-RETENTION_MS;
export async function callUsageDigest(value:string):Promise<string>{
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("jodlo:call-usage:v1:"+value))))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}

/** Reserve from a currently accepted, authenticated invitation. No client
 * duration, account ID, amount or price is accepted. One caller cannot reserve
 * their same seconds for concurrent calls. Original auth/media eligibility is
 * independently checked by the token issuer before and after this operation. */
export async function reserveOwnCallUsage(db:D1Database,bearer:string,id:string,
  approvalHash:string,now=Date.now()):Promise<{deadlineMs:number}|null>{
  if(!validSessionToken(bearer)||!validOpaqueId(id)||id.length!==36||
    !validHash(approvalHash)||!validTime(now))return null;
  const tokenHash=await sessionHash(bearer);
  const source=await callUsageDigest("debit:"+id);
  const spendable="max(0,b.available_seconds-"+refundReviewDemandSql("i.caller_account_id")+
    "-COALESCE((SELECT SUM(held.reserved_seconds) FROM call_usage_sessions AS held "+
    "WHERE held.caller_account_id=i.caller_account_id AND held.state='active'),0))";
  const deadline="min(i.expires_at_ms,calling.expires_at*1000,answering.expires_at*1000)";
  const authorizationStart="max(?3,unixepoch()*1000)";
  await db.prepare(`
    INSERT INTO call_usage_sessions(invitation_id,caller_account_id,receiver_account_id,
      policy_version,approval_hash,source_key_hash,reserved_seconds,
      authorized_from_ms,authorized_until_ms,settle_after_ms)
    SELECT i.id,i.caller_account_id,i.receiver_account_id,?4,?5,?6,
      min(${spendable},30000,CAST((${deadline}-${authorizationStart})/1000 AS INTEGER)),
      ${authorizationStart}, min(${deadline},${authorizationStart}+min(${spendable},30000)*1000),
      min(${deadline},${authorizationStart}+min(${spendable},30000)*1000)+?7
    FROM private_call_invitations AS i
    JOIN accounts AS caller ON caller.id=i.caller_account_id AND caller.status='active'
    ${CURRENT_RING_ELIGIBILITY_JOINS}
    JOIN private_call_dispatch_slots AS slot ON slot.invitation_id=i.id
    JOIN auth_sessions AS calling ON calling.token_hash=slot.caller_session_hash
      AND calling.account_id=i.caller_account_id AND calling.expires_at>MAX(CAST(?3/1000 AS INTEGER),unixepoch())
    JOIN auth_sessions AS answering ON answering.token_hash=i.accepted_session_hash
      AND answering.account_id=i.receiver_account_id AND answering.expires_at>MAX(CAST(?3/1000 AS INTEGER),unixepoch())
    JOIN auth_sessions AS s ON s.token_hash=?1 AND s.token_hash IN(calling.token_hash,answering.token_hash)
    JOIN call_credit_balances AS b ON b.account_id=i.caller_account_id
    WHERE i.id=?2 AND i.phase='accepted' AND ${CURRENT_RING_ELIGIBILITY} AND ${deadline}>=${authorizationStart}+1000
      AND ${spendable}>0 AND NOT EXISTS(SELECT 1 FROM call_usage_sessions AS old
        WHERE old.caller_account_id=i.caller_account_id AND old.state='active' AND old.ended_at_ms IS NULL)
    ON CONFLICT(invitation_id) DO NOTHING
  `).bind(tokenHash,id,now,CALL_USAGE_POLICY_VERSION,approvalHash,source,
    CALL_USAGE_EVENT_GRACE_MS).run();
  const {results}=await db.prepare(`
    SELECT u.authorized_until_ms AS deadlineMs FROM call_usage_sessions AS u
    JOIN private_call_invitations AS i ON i.id=u.invitation_id AND i.phase='accepted'
    JOIN private_call_dispatch_slots AS slot ON slot.invitation_id=i.id
    JOIN auth_sessions AS s ON s.token_hash=?1 AND s.expires_at>MAX(CAST(?3/1000 AS INTEGER),unixepoch())
      AND s.token_hash IN(slot.caller_session_hash,i.accepted_session_hash)
      AND s.account_id IN(u.caller_account_id,u.receiver_account_id)
    JOIN accounts AS a ON a.id=s.account_id AND a.status='active'
    WHERE u.invitation_id=?2 AND u.state='active' AND u.ended_at_ms IS NULL
      AND u.authorized_until_ms>MAX(?3,unixepoch()*1000) AND u.policy_version=?4 AND u.approval_hash=?5
  `).bind(tokenHash,id,now,CALL_USAGE_POLICY_VERSION,approvalHash).all<{deadlineMs:number}>();
  return results[0]??null;
}

/** Stop billing at the first server-observed terminal action. Existing media
 * tokens may briefly remain valid, but post-hangup seconds are never billed. */
export async function closeCallUsage(db:D1Database,id:string,now=Date.now()):Promise<void>{
  if(!validOpaqueId(id)||!validTime(now))return;
  await db.prepare(`UPDATE call_usage_sessions SET ended_at_ms=max(authorized_from_ms,
    min(COALESCE(ended_at_ms,?2),?2,authorized_until_ms))
    WHERE invitation_id=?1 AND state='active'`).bind(id,now).run();
}

export type ProviderCallInterval=Readonly<{
  invitationId:string;uid:1|2;clientSeq:number;startedAtSeconds:number;
  endedAtSeconds:number;reason:number;
}>;

/** Only the authenticated Agora webhook supplies this internal input.
 * A normal provider leave carries session duration. It is RTC participation,
 * not a handset timer or a signaling state. Other leave reasons are retained
 * as evidence but excluded from the customer-favouring charge calculation. */
export async function recordVerifiedCallInterval(db:D1Database,event:ProviderCallInterval,
  now=Date.now()):Promise<"recorded"|"ignored"|"conflict">{
  if(!validTime(now)||!validOpaqueId(event.invitationId)||event.invitationId.length!==36||
    ![1,2].includes(event.uid)||!Number.isSafeInteger(event.clientSeq)||event.clientSeq<0||
    !Number.isSafeInteger(event.startedAtSeconds)||event.startedAtSeconds<=0||
    !Number.isSafeInteger(event.endedAtSeconds)||event.endedAtSeconds<event.startedAtSeconds||
    event.endedAtSeconds-event.startedAtSeconds>30000||event.endedAtSeconds*1000>now+30000||
    !Number.isInteger(event.reason)||event.reason<0||event.reason>999)return "ignored";
  const hash=await callUsageDigest(`event:${event.invitationId}:${event.uid}:${event.clientSeq}`);
  const values=[hash,event.invitationId,event.uid,event.clientSeq,event.startedAtSeconds,
    event.endedAtSeconds,event.reason,now] as const;
  await db.prepare(`INSERT INTO call_usage_intervals(event_hash,invitation_id,uid,client_seq,
      started_at_s,ended_at_s,reason,received_at_ms)
    SELECT ?1,u.invitation_id,?3,?4,?5,?6,?7,MAX(?8,unixepoch()*1000) FROM call_usage_sessions AS u
    WHERE u.invitation_id=?2 AND u.state='active'
      AND (EXISTS(SELECT 1 FROM call_usage_intervals WHERE event_hash=?1)
        OR (u.settle_after_ms>=MAX(?8,unixepoch()*1000) AND ?6*1000>=u.authorized_from_ms
          AND ?5*1000<=u.authorized_until_ms
          AND (SELECT count(*) FROM call_usage_intervals WHERE invitation_id=u.invitation_id)<256))
    ON CONFLICT(event_hash) DO NOTHING`).bind(...values).run();
  const {results}=await db.prepare(`SELECT started_at_s AS start,ended_at_s AS end,reason
    FROM call_usage_intervals WHERE event_hash=?`).bind(hash)
    .all<{start:number;end:number;reason:number}>();
  if(!results[0])return "ignored";
  const same=results[0].start===event.startedAtSeconds&&results[0].end===event.endedAtSeconds&&
    results[0].reason===event.reason;
  if(!same){
    await db.prepare("UPDATE call_usage_sessions SET evidence_conflict=1 WHERE invitation_id=? AND state='active'")
      .bind(event.invitationId).run();
    return "conflict";
  }
  return "recorded";
}

type Interval=Readonly<{uid:number;start:number;end:number;reason:number}>;
/** Union first, then intersect: duplicates, retries, overlapping reconnects
 * and event reordering cannot multiply billed seconds. Round down in favour
 * of the customer. Missing/abnormal provider records produce no guessed use. */
export function verifiedOverlapSeconds(intervals:readonly Interval[],fromMs:number,toMs:number):number{
  if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||toMs<=fromMs)return 0;
  const from=Math.ceil(fromMs/1000),to=Math.floor(toMs/1000);
  const merge=(uid:number)=>{
    const list=intervals.filter(x=>x.uid===uid&&x.reason===1&&
      Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start<=x.end)
      .map(x=>({start:Math.max(from,x.start),end:Math.min(to,x.end)}))
      .filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start||a.end-b.end);
    const result:{start:number;end:number}[]=[];
    for(const x of list){const last=result[result.length-1];
      if(last&&x.start<=last.end)last.end=Math.max(last.end,x.end);else result.push({...x});}
    return result;
  };
  const a=merge(1),b=merge(2);let i=0,j=0,total=0;
  while(i<a.length&&j<b.length){total+=Math.max(0,Math.min(a[i].end,b[j].end)-Math.max(a[i].start,b[j].start));
    if(a[i].end<b[j].end)i++;else j++;}
  return total;
}

/** Bounded scheduled settlement: one immutable debit per invitation, no
 * negative balance, no retry credit, no client duration. A final SQL check
 * fences late conflicting evidence or concurrent settlement after reads. */
export async function settleDueCallUsage(db:D1Database,now=Date.now()):Promise<{settled:number;charged:number}>{
  if(!validTime(now))throw new Error("Invalid usage settlement clock");
  const {results}=await db.prepare(`SELECT invitation_id AS id,reserved_seconds AS reserved,
    authorized_from_ms AS start,min(authorized_until_ms,COALESCE(ended_at_ms,authorized_until_ms)) AS end,
    evidence_conflict AS conflict FROM call_usage_sessions
    WHERE state='active' AND settle_after_ms<=? ORDER BY settle_after_ms,invitation_id LIMIT 50`)
    .bind(now).all<{id:string;reserved:number;start:number;end:number;conflict:number}>();
  let settled=0,charged=0;
  for(const row of results){
    const evidence=await db.prepare(`SELECT uid,started_at_s AS start,ended_at_s AS end,reason
      FROM call_usage_intervals WHERE invitation_id=? ORDER BY uid,started_at_s,ended_at_s LIMIT 256`)
      .bind(row.id).all<Interval>();
    const seconds=row.conflict?0:Math.min(row.reserved,verifiedOverlapSeconds(evidence.results,row.start,row.end));
    const result=await db.prepare(`UPDATE call_usage_sessions SET state='settled',settled_at_ms=?2,
      charged_seconds=CASE WHEN evidence_conflict=0 THEN ?3 ELSE 0 END
      WHERE invitation_id=?1 AND state='active' AND settle_after_ms<=?2
        AND min(authorized_until_ms,COALESCE(ended_at_ms,authorized_until_ms))=?4
      RETURNING charged_seconds AS seconds`).bind(row.id,now,seconds,row.end).all<{seconds:number}>();
    if(result.results[0]){settled++;charged+=result.results[0].seconds;}
  }
  // Only expired operational RTC evidence is removed. The private debit
  // journal remains available for customer activity/export and reconciliation.
  await db.prepare(`DELETE FROM call_usage_sessions WHERE invitation_id IN (
    SELECT invitation_id FROM call_usage_sessions WHERE state='settled' AND settled_at_ms<?
    ORDER BY settled_at_ms,invitation_id LIMIT 100)`)
    .bind(now-RETENTION_MS).run();
  return {settled,charged};
}
