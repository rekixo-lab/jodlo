import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import {
  jodloPlayPurchaseFingerprint, JODLO_PLAY_PACKAGE,
  PLAY_PREFLIGHT_TIMEOUT_MS,
} from "./google-play-purchase-preflight.ts";

export const PLAY_CONSUME_LEASE_MS = 15_000;
const MAX_PENDING_ATTEMPT_MS = PLAY_CONSUME_LEASE_MS;

type TrustedGrant = Readonly<{
  accountId: string;
  sourceKeyHash: string;
  productId: string;
  seconds: number;
  createdAtMs: number;
}>;
export type PlayConsumeClaim = Readonly<{
  accountId: string;
  sourceKeyHash: string;
  productId: string;
  attemptId: string;
  deadlineMs: number;
}>;

type OutboxState = "ready" | "sending" | "unknown" | "consumed" | "void_hold";

/** INTERNAL ONLY. No caller may treat a read-only Play preflight candidate
 * as sufficient entitlement authorization. Future checkout must supply
 * independently verified ownership, refund/revocation policy and approved
 * SKU evidence before invoking this. There is NO HTTP route or caller today.
 *
 * One INSERT and D1 triggers atomically create the purchase journal,
 * private credit event and balance change, with global token deduplication.
 * An unknown/failed consume is never automatically resent.
 */
export async function stageTrustedPlayConsumable(
  db: D1Database, grant: TrustedGrant, approvedProducts: ReadonlyMap<string, number>,
): Promise<"applied" | "replay" | "void_hold" | "denied"> {
  if (!grant || !validOpaqueId(grant.accountId) ||
      !/^[a-f0-9]{64}$/.test(grant.sourceKeyHash) ||
      !/^[a-z][a-z0-9._]{2,99}$/.test(grant.productId) ||
      !(approvedProducts instanceof Map) || approvedProducts.size === 0 ||
      approvedProducts.size > 16 ||
      !Number.isSafeInteger(grant.seconds) || grant.seconds < 60 ||
      grant.seconds > 30_000 || grant.seconds % 60 !== 0 ||
      approvedProducts.get(grant.productId) !== grant.seconds / 60 ||
      !Number.isSafeInteger(grant.createdAtMs) || grant.createdAtMs <= 0)
    return "denied";
  const {results} = await db.prepare(
    "INSERT INTO play_consume_outbox(" +
    "source_key_hash,account_id,product_id,seconds,created_at_ms,updated_at_ms) " +
    "SELECT ?,a.id,?,?,?,? FROM accounts AS a " +
    "WHERE a.id=? AND a.status='active' " +
    "ON CONFLICT(source_key_hash) DO NOTHING RETURNING source_key_hash",
  ).bind(grant.sourceKeyHash,grant.productId,grant.seconds,
    grant.createdAtMs,grant.createdAtMs,grant.accountId)
    .all<{source_key_hash:string}>();
  if (results.length) return "applied";
  const existing=await db.prepare(
    "SELECT o.account_id,o.product_id,o.seconds,o.status " +
    "FROM play_consume_outbox AS o JOIN accounts AS a " +
    "ON a.id=o.account_id AND a.status='active' " +
    "WHERE o.source_key_hash=? AND o.account_id=?",
  ).bind(grant.sourceKeyHash,grant.accountId)
    .all<{account_id:string;product_id:string;seconds:number;status:OutboxState}>();
  const row=existing.results[0];
  if (row?.product_id!==grant.productId || row?.seconds!==grant.seconds)
    return "denied";
  return row.status==="void_hold"?"void_hold":"replay";
}

/** Single-statement compare-and-swap: one provider-send lease per purchase.
 * Expiry does NOT permit a second POST; expiry goes to UNKNOWN. */
export async function claimPlayConsumeOnce(
  db: D1Database, accountId:string, sourceKeyHash:string, nowMs:number,
): Promise<PlayConsumeClaim | null> {
  if (!validOpaqueId(accountId) || !/^[a-f0-9]{64}$/.test(sourceKeyHash) ||
      !Number.isSafeInteger(nowMs) || nowMs<=0 ||
      nowMs>Number.MAX_SAFE_INTEGER-MAX_PENDING_ATTEMPT_MS)
    return null;
  const attemptId=crypto.randomUUID();
  const deadlineMs=nowMs+PLAY_CONSUME_LEASE_MS;
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status='sending',attempt_id=?," +
    "attempt_deadline_ms=?,updated_at_ms=? " +
    "WHERE source_key_hash=? AND account_id=? AND status='ready' " +
    "AND created_at_ms<=? AND updated_at_ms<=? AND EXISTS(" +
    "SELECT 1 FROM accounts WHERE id=? AND status='active') " +
    "RETURNING product_id",
  ).bind(attemptId,deadlineMs,nowMs,sourceKeyHash,accountId,
    nowMs,nowMs,accountId).all<{product_id:string}>();
  const row=results[0];
  return row?{accountId,sourceKeyHash,productId:row.product_id,attemptId,deadlineMs}:null;
}

function validClaim(claim: PlayConsumeClaim):boolean {
  return !!claim && validOpaqueId(claim.accountId) &&
    /^[a-f0-9]{64}$/.test(claim.sourceKeyHash) &&
    /^[a-z][a-z0-9._]{2,99}$/.test(claim.productId) &&
    /^[a-f0-9-]{36}$/.test(claim.attemptId) &&
    Number.isSafeInteger(claim.deadlineMs) && claim.deadlineMs>0;
}

async function hasLiveClaim(db:D1Database,claim:PlayConsumeClaim,nowMs:number):Promise<boolean> {
  const {results}=await db.prepare(
    "SELECT 1 AS ok FROM play_consume_outbox AS o JOIN accounts AS a " +
    "ON a.id=o.account_id AND a.status='active' " +
    "WHERE o.source_key_hash=? AND o.account_id=? AND o.product_id=? " +
    "AND o.status='sending' AND o.attempt_id=? " +
    "AND o.attempt_deadline_ms=? AND o.attempt_deadline_ms>? ",
  ).bind(claim.sourceKeyHash,claim.accountId,claim.productId,
    claim.attemptId,claim.deadlineMs,nowMs).all<{ok:number}>();
  return results[0]?.ok===1;
}

async function advanceClaim(
  db:D1Database,claim:PlayConsumeClaim,status:"ready"|"unknown"|"consumed",
  nowMs:number,
):Promise<boolean> {
  if(!validClaim(claim) || !Number.isSafeInteger(nowMs)||nowMs<=0)return false;
  const clear=status!=="unknown";
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status=?, " +
    "attempt_id=CASE WHEN ?=1 THEN NULL ELSE attempt_id END, " +
    "attempt_deadline_ms=CASE WHEN ?=1 THEN NULL ELSE attempt_deadline_ms END, " +
    "updated_at_ms=? WHERE source_key_hash=? AND account_id=? " +
    "AND product_id=? AND attempt_id=? AND attempt_deadline_ms=? " +
    "AND status IN ('sending','unknown') AND updated_at_ms<=? " +
    "RETURNING source_key_hash",
  ).bind(status,clear?1:0,clear?1:0,nowMs,claim.sourceKeyHash,
    claim.accountId,claim.productId,claim.attemptId,claim.deadlineMs,nowMs)
    .all<{source_key_hash:string}>();
  return results.length===1;
}

/** For certain NO-POST paths only; never call after issuing provider POST. */
export async function releaseUnsentPlayConsumeClaim(
  db:D1Database,claim:PlayConsumeClaim,nowMs:number,
):Promise<boolean> {
  if(!validClaim(claim)||!Number.isSafeInteger(nowMs)||nowMs<=0)return false;
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status='ready',attempt_id=NULL, " +
    "attempt_deadline_ms=NULL,updated_at_ms=? " +
    "WHERE source_key_hash=? AND account_id=? AND product_id=? " +
    "AND attempt_id=? AND attempt_deadline_ms=? AND status='sending' " +
    "AND updated_at_ms<=? RETURNING source_key_hash",
  ).bind(nowMs,claim.sourceKeyHash,claim.accountId,claim.productId,
    claim.attemptId,claim.deadlineMs,nowMs).all<{source_key_hash:string}>();
  return results.length===1;
}

/** Expiry is a quarantine, NOT an authorization to re-send. */
export async function quarantineExpiredPlayConsume(
  db:D1Database,accountId:string,sourceKeyHash:string,nowMs:number,
):Promise<boolean> {
  if(!validOpaqueId(accountId)||!/^[a-f0-9]{64}$/.test(sourceKeyHash) ||
     !Number.isSafeInteger(nowMs)||nowMs<=0)return false;
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status='unknown',updated_at_ms=? " +
    "WHERE source_key_hash=? AND account_id=? AND status='sending' " +
    "AND attempt_deadline_ms<=? AND updated_at_ms<=? RETURNING source_key_hash",
  ).bind(nowMs,sourceKeyHash,accountId,nowMs,nowMs)
    .all<{source_key_hash:string}>();
  return results.length===1;
}

/** A trusted void/revocation signal freezes future sends. It does NOT
 * silently debit already spent seconds or implement a refund/debt policy. */
export async function holdVoidedPlayConsume(
  db:D1Database,accountId:string,sourceKeyHash:string,nowMs:number,
):Promise<boolean> {
  if(!validOpaqueId(accountId)||!/^[a-f0-9]{64}$/.test(sourceKeyHash) ||
      !Number.isSafeInteger(nowMs)||nowMs<=0)return false;
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status='void_hold',attempt_id=NULL, " +
    "attempt_deadline_ms=NULL,updated_at_ms=? " +
    "WHERE source_key_hash=? AND account_id=? AND status IN ('ready','unknown','consumed') " +
    "AND updated_at_ms<=? RETURNING source_key_hash",
  ).bind(nowMs,sourceKeyHash,accountId,nowMs)
    .all<{source_key_hash:string}>();
  return results.length===1;
}

/** An UNKNOWN send needs an independently checked Google consumption
 * response plus owner/SKU/token match before calling this reconciliation
 * seam. No automatic resend and no further credit is ever applied here. */
export async function confirmReconciledPlayConsumption(
  db:D1Database,claim:PlayConsumeClaim,nowMs:number,
):Promise<boolean> {
  if(!validClaim(claim)||!Number.isSafeInteger(nowMs)||nowMs<=0)return false;
  const {results}=await db.prepare(
    "UPDATE play_consume_outbox SET status='consumed',attempt_id=NULL," +
    "attempt_deadline_ms=NULL,updated_at_ms=? WHERE source_key_hash=? " +
    "AND account_id=? AND product_id=? AND attempt_id=? " +
    "AND status='unknown' AND updated_at_ms<=? RETURNING source_key_hash",
  ).bind(nowMs,claim.sourceKeyHash,claim.accountId,claim.productId,
    claim.attemptId,nowMs).all<{source_key_hash:string}>();
  return results.length===1;
}

type ConsumeProvider=Readonly<{
  accessToken():Promise<string|null>;
  request?:typeof fetch;
  timeoutMs?:number;
  now?:()=>number;
}>;

async function deadline<T>(run:()=>Promise<T>, remaining:()=>number):Promise<T> {
  const wait=remaining();
  if(wait<=0)throw Error("Play consume timed out");
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error("Play consume timed out")),wait);
      }),
    ]);
  }finally{
    if(timer!==undefined)clearTimeout(timer);
  }
}

/** INTERNAL no-route sender. Exactly one POST for an active claimed row.
 * After POST begins, any failure/timeout becomes UNKNOWN, NEVER an
 * automatic retry. A post-timeout callback has no D1 write capability.
 * Consuming is only allowed after the atomic grant/outbox trigger ran. */
export async function deliverClaimedPlayConsume(
  db:D1Database,claim:PlayConsumeClaim,purchaseToken:string,deps:ConsumeProvider,
):Promise<"consumed"|"unknown"|"unsent"|"denied"> {
  if(!validClaim(claim))return "denied";
  const now=deps.now??Date.now;
  const timeoutMs=deps.timeoutMs??PLAY_PREFLIGHT_TIMEOUT_MS;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||
      timeoutMs>PLAY_PREFLIGHT_TIMEOUT_MS)return "denied";
  if(!Number.isSafeInteger(now())||now()<=0||
      now()>=claim.deadlineMs)return "denied";

  const started=performance.now();
  const remaining=()=>Math.max(0,Math.floor(Math.min(timeoutMs,
    claim.deadlineMs-now())-(performance.now()-started)));
  let sent=false;
  try {
    const digest=await deadline(()=>jodloPlayPurchaseFingerprint(purchaseToken),remaining);
    if(digest!==claim.sourceKeyHash) {
      const released=await releaseUnsentPlayConsumeClaim(db,claim,now());
      return released?"unsent":"denied";
    }
    const auth=await deadline(deps.accessToken,remaining);
    if(!auth||!/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(auth)) {
      const released=await releaseUnsentPlayConsumeClaim(db,claim,now());
      return released?"unsent":"denied";
    }
    if(remaining()<=0 || !(await deadline(()=>hasLiveClaim(db,claim,now()),remaining))) {
      const released=await releaseUnsentPlayConsumeClaim(db,claim,now());
      return released?"unsent":"denied";
    }
    // Set the uncertain side-effect flag before invoking the HTTP adapter.
    sent=true;
    const endpoint="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"+
      JODLO_PLAY_PACKAGE+"/purchases/products/"+encodeURIComponent(claim.productId)+
      "/tokens/"+encodeURIComponent(purchaseToken)+":consume";
    const request=deps.request??fetch;
    const response=await deadline(()=>request(endpoint,{
      method:"POST",redirect:"error",cache:"no-store",
      signal:AbortSignal.timeout(Math.max(1,remaining())),
      headers:{Authorization:"Bearer "+auth,Accept:"application/json"},
    }),remaining);
    void response.body?.cancel().catch(()=>{});
    const status=response.status===200||response.status===204?"consumed":"unknown";
    const changed=await advanceClaim(db,claim,status,now());
    return changed?status:"denied";
  }catch{
    if(!sent){
      try{
        const released=await releaseUnsentPlayConsumeClaim(db,claim,now());
        return released?"unsent":"denied";
      }catch{return "denied";}
    }
    try{
      const changed=await advanceClaim(db,claim,"unknown",now());
      return changed?"unknown":"denied";
    }catch{return "denied";}
  }
}
