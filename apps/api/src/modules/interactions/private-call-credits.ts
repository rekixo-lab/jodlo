import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";

/** No client or public API may call this module. A future Play/UPI adapter
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

/** Private owner-only read seam; not registered with the HTTP router.
 * An account with no events has exactly zero seconds, never implied credit.
 */
export async function readOwnCallCreditBalance(
  db: D1Database, bearer: string, nowMs = Date.now(),
): Promise<{availableSeconds: number; revision: number} | null> {
  if (!validSessionToken(bearer) || !Number.isSafeInteger(nowMs) || nowMs <= 0)
    return null;
  const {results} = await db.prepare(
    "SELECT COALESCE(b.available_seconds,0) AS availableSeconds," +
    "COALESCE(b.revision,0) AS revision " +
    "FROM auth_sessions AS s " +
    "JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
    "LEFT JOIN call_credit_balances AS b ON b.account_id=a.id " +
    "WHERE s.token_hash=? AND s.expires_at>?",
  ).bind(await sessionHash(bearer), Math.floor(nowMs / 1000))
    .all<{availableSeconds:number; revision:number}>();
  return results[0] ?? null;
}
