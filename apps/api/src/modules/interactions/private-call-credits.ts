import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import {jodloPlayMinuteProductMap} from "./play-minute-packs.ts";

/** No client or public API may call the TRUSTED MUTATION in this module.
 * The separate owner-bound D1 read may be used by a default-off, strictly
 * authenticated minute-preview endpoint; it cannot grant/revoke/consume.
 * A future Play/UPI adapter
 * must independently verify entitlement, SKU, account binding, revocation,
 * refund state and a globally unique provider event BEFORE creating input.
 * Similarly verified_usage requires measured billable media usage; call
 * signaling and call history are NOT evidence of connected seconds.
 */
export type TrustedCallCreditEvent = Readonly<{
  accountId: string;
  sourceKeyHash: string;
  kind: "purchase_grant" | "verified_usage";
  seconds: number;
  createdAtMs: number;
}>;

type CreditResult = "applied" | "replay" | "denied";

export const MAX_CREDIT_EVENT_SECONDS = 500 * 60;

function validEvent(e: TrustedCallCreditEvent): boolean {
  return !!e && validOpaqueId(e.accountId) &&
    typeof e.sourceKeyHash === "string" &&
    /^[a-f0-9]{64}$/.test(e.sourceKeyHash) &&
    (e.kind === "purchase_grant" || e.kind === "verified_usage") &&
    Number.isSafeInteger(e.seconds) &&
    e.seconds >= 1 && e.seconds <= MAX_CREDIT_EVENT_SECONDS &&
    (e.kind !== "purchase_grant" || e.seconds % 60 === 0) &&
    Number.isSafeInteger(e.createdAtMs) && e.createdAtMs > 0;
}

/** Internal-only accounting. The AFTER INSERT D1 trigger atomically adjusts
 * the account's bounded balance. If insufficient, overflow or revision
 * exhaustion causes a SQL CHECK failure, the whole event INSERT rolls back.
 * A duplicate provider digest (globally unique) cannot double-credit or
 * be transferred to another account. This is not a payment verifier.
 */
export async function recordTrustedCallCreditEvent(
  db: D1Database, event: TrustedCallCreditEvent,
): Promise<CreditResult> {
  if (!validEvent(event)) return "denied";
  const {results} = await db.prepare(
    "INSERT INTO call_credit_events(id,account_id,source_key_hash,kind,seconds,created_at_ms) " +
    "SELECT ?,a.id,?,?,?,? FROM accounts AS a " +
    "WHERE a.id=? AND a.status='active' " +
    "ON CONFLICT(source_key_hash) DO NOTHING RETURNING id",
  ).bind(crypto.randomUUID(), event.sourceKeyHash, event.kind,
    event.seconds, event.createdAtMs, event.accountId)
    .all<{id: string}>();
  if (results.length === 1) return "applied";

  // On a replay, disclose nothing about a digest owned by another account.
  // Only the same active owner, kind and exact quantity is idempotent.
  const existing = await db.prepare(
    "SELECT e.kind,e.seconds FROM call_credit_events AS e " +
    "JOIN accounts AS a ON a.id=e.account_id AND a.status='active' " +
    "WHERE e.source_key_hash=? AND e.account_id=?",
  ).bind(event.sourceKeyHash, event.accountId)
    .all<{kind: string; seconds: number}>();
  return existing.results[0]?.kind === event.kind &&
    existing.results[0]?.seconds === event.seconds ? "replay" : "denied";
}

/** Only recent, nonfinancial account activity is ever presented to the app:
 * no provider receipt, provider order, key hash, caller identity or payment.
 * "added" is an internal trusted ledger event, NOT proof of completed payment. */
export type OwnCallCreditActivity = Readonly<{
  change: "added" | "used";
  seconds: number;
  occurredAtMs: number;
}>;

export type OwnCallCreditSnapshot = Readonly<{
  availableSeconds: number;
  revision: number;
  history: Readonly<{entries: ReadonlyArray<OwnCallCreditActivity>; hasMore: boolean}>;
  /** Outbox rows tied to this account ONLY; no standalone global token fences. */
  holds: Readonly<{
    entries: ReadonlyArray<OwnPlayRevocationHold>; hasMore: boolean;
  }>;
}>;

export type OwnPlayRevocationHold = Readonly<{
  minutes: number;
  state: "canceled" | "voided" | "review";
  recordedAtMs: number;
}>;

const MAX_ACTIVITY_ROWS = 10;
const MAX_PLAY_HOLD_ROWS = 5;
const MAX_LEDGER_SECONDS = 2_147_483_647;

/** One indexed, bounded, atomically consistent D1 SELECT for balance and
 * latest events. Owner is resolved ONLY via the active signed-in session.
 * LEFT JOIN returns zero balance and no events for a newly-created account.
 * Neither caller nor UI can choose a raw account ID, offset or arbitrary SQL.
 */
export async function readOwnCallCreditSnapshot(
  db: D1Database, bearer: string, nowMs = Date.now(),
  includePlayHolds = true,
): Promise<OwnCallCreditSnapshot | null> {
  if (!validSessionToken(bearer) || !Number.isSafeInteger(nowMs) || nowMs <= 0)
    return null;
  const ownerSessionHash=await sessionHash(bearer);
  const expiresAfter=Math.floor(nowMs/1000);
  const {results} = await db.prepare(
    "SELECT COALESCE(b.available_seconds,0) AS availableSeconds, " +
    "COALESCE(b.revision,0) AS revision, " +
    "e.kind AS eventKind,e.seconds AS eventSeconds,e.created_at_ms AS occurredAtMs " +
    "FROM auth_sessions AS s " +
    "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
    "LEFT JOIN call_credit_balances AS b ON b.account_id=a.id " +
    "LEFT JOIN call_credit_events AS e ON e.account_id=a.id " +
    "WHERE s.token_hash=? AND s.expires_at>? " +
    "ORDER BY e.created_at_ms DESC,e.id DESC LIMIT ?",
  ).bind(ownerSessionHash,expiresAfter,MAX_ACTIVITY_ROWS+1)
    .all<{
      availableSeconds:number; revision:number;
      eventKind:string|null; eventSeconds:number|null; occurredAtMs:number|null;
    }>();
  if (results.length === 0) return null;
  const {availableSeconds,revision}=results[0];
  if (!Number.isSafeInteger(availableSeconds) || availableSeconds < 0 ||
      availableSeconds > MAX_LEDGER_SECONDS ||
      !Number.isSafeInteger(revision) || revision < 0 ||
      revision > MAX_LEDGER_SECONDS) throw new Error("Invalid private credit snapshot");
  const entries: OwnCallCreditActivity[] = [];
  for (const row of results) {
    if (row.availableSeconds !== availableSeconds || row.revision !== revision)
      throw new Error("Inconsistent private ledger snapshot");
    if (row.eventKind === null && row.eventSeconds === null &&
        row.occurredAtMs === null) {
      if (results.length !== 1) throw new Error("Unexpected empty ledger row");
      continue;
    }
    if ((row.eventKind !== "purchase_grant" && row.eventKind !== "verified_usage") ||
        !Number.isSafeInteger(row.eventSeconds) || row.eventSeconds! < 1 ||
        row.eventSeconds! > MAX_CREDIT_EVENT_SECONDS ||
        !Number.isSafeInteger(row.occurredAtMs) || row.occurredAtMs! <= 0)
      throw new Error("Unrecognized private ledger event");
    entries.push({
      change: row.eventKind === "purchase_grant" ? "added" : "used",
      seconds: row.eventSeconds!, occurredAtMs: row.occurredAtMs!,
    });
  }
  if (revision < entries.length)
    throw new Error("Corrupt private ledger revision");
  const history={
    entries:entries.slice(0,MAX_ACTIVITY_ROWS),
    hasMore:entries.length>MAX_ACTIVITY_ROWS,
  };
  // Old internal balance readers never depended on Play outbox SKUs and
  // must stay usable with test/legacy trusted events. The *optional Account
  // preview* alone demands strict canonical Play hold validation.
  if(!includePlayHolds) return {
    availableSeconds,revision,history,holds:{entries:[],hasMore:false},
  };
  // Fences alone are global token hashes with NO account identity and
  // MUST NEVER be attached to an arbitrary user. Only an existing, owner-
  // bound outbox row with void_hold can produce a private status. Recheck the
  // active bearer in this independent indexed read (revoked mid-request
  // sessions fail closed). No token hash, order ID, price or account ID leaves.
  const {results: holdRows}=await db.prepare(
    "SELECT o.product_id AS productId,o.seconds AS seconds, " +
    "o.updated_at_ms AS recordedAtMs,f.reason AS reason " +
    "FROM auth_sessions AS s " +
    "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
    "LEFT JOIN play_consume_outbox AS o ON o.account_id=a.id " +
    "AND o.status='void_hold' " +
    "LEFT JOIN play_revocation_fences AS f " +
    "ON f.source_key_hash=o.source_key_hash " +
    "WHERE s.token_hash=? AND s.expires_at>? " +
    "ORDER BY o.updated_at_ms DESC,o.source_key_hash DESC LIMIT ?",
  ).bind(ownerSessionHash,expiresAfter,MAX_PLAY_HOLD_ROWS+1).all<{
    productId:string|null;seconds:number|null;
    recordedAtMs:number|null;reason:string|null;
  }>();
  if (holdRows.length===0)
    return null; // Token revoked or account disabled between both reads.
  const canonicalPacks=jodloPlayMinuteProductMap();
  const holds:OwnPlayRevocationHold[]=[];
  for(const row of holdRows){
    if(row.productId===null && row.seconds===null &&
       row.recordedAtMs===null && row.reason===null){
      if(holdRows.length!==1) throw new Error("Invalid empty Play hold row");
      continue;
    }
    if(!row.productId || !Number.isSafeInteger(row.seconds) ||
       row.seconds!<60 || row.seconds!>MAX_CREDIT_EVENT_SECONDS ||
       row.seconds!%60!==0 ||
       canonicalPacks.get(row.productId)!==row.seconds!/60 ||
       !Number.isSafeInteger(row.recordedAtMs) ||
       row.recordedAtMs!<=0 || row.recordedAtMs!>Number.MAX_SAFE_INTEGER ||
       (row.reason!==null && row.reason!=="one_time_canceled" &&
        row.reason!=="voided_purchase"))
      throw new Error("Invalid private Play hold state");
    holds.push({
      minutes:row.seconds!/60,
      state:row.reason==="one_time_canceled"?"canceled":
        row.reason==="voided_purchase"?"voided":"review",
      recordedAtMs:row.recordedAtMs!,
    });
  }
  return {
    availableSeconds,revision,history,
    holds:{entries:holds.slice(0,MAX_PLAY_HOLD_ROWS),
      hasMore:holds.length>MAX_PLAY_HOLD_ROWS},
  };
}

/** Compatibility read for server-internal callers; it reuses the
 * single authenticated, bounded credit snapshot rather than duplicating the
 * session/balance SQL. No public credit or payment action is exposed. */
export async function readOwnCallCreditBalance(
  db: D1Database, bearer: string, nowMs = Date.now(),
): Promise<{availableSeconds: number; revision: number} | null> {
  const snapshot=await readOwnCallCreditSnapshot(db,bearer,nowMs,false);
  return snapshot===null?null:{
    availableSeconds:snapshot.availableSeconds,revision:snapshot.revision,
  };
}
