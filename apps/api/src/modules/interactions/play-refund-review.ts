import type { D1Database, Env } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";

export const JODLO_PLAY_REFUND_POLICY_VERSION = "jodlo-play-refund-hold-v1";
export type PlayRefundPolicy = Readonly<{version: string; approvalSha256: string}>;
const digest = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value) && value !== "0".repeat(64);
const validPolicy = (p: PlayRefundPolicy) => !!p &&
  p.version === JODLO_PLAY_REFUND_POLICY_VERSION && digest(p.approvalSha256);

export function configuredPlayRefundPolicy(env: Env): PlayRefundPolicy | null {
  const policy = {version: env.PLAY_REFUND_POLICY_VERSION ?? "",
    approvalSha256: env.PLAY_REFUND_APPROVAL_SHA256 ?? ""};
  return env.PLAY_REFUND_HOLDS_ENABLED === "1" && validPolicy(policy) ? policy : null;
}

/** Static SQL fragment for trusted source-code aliases ONLY. This is the
 * total reviewed hold demand, not the actual reserved amount or a debt.
 * Callers first subtract existing active-call reservations, then clamp the
 * remaining balance minus this demand to zero. Never interpolate user input.
 */
export function refundReviewDemandSql(ownerAlias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(ownerAlias))
    throw Error("Invalid refund owner SQL alias");
  return "COALESCE((SELECT SUM(refund.seconds) FROM play_refund_reviews AS refund " +
    "WHERE refund.account_id=" + ownerAlias + " AND refund.state='open'),0)";
}

/** Read-only capability check: absent policy may be registered by the first
 * separately gated POST; a conflicting existing approval cannot be replaced.
 */
export async function canUsePlayRefundPolicy(db: D1Database, policy: PlayRefundPolicy): Promise<boolean> {
  if (!validPolicy(policy)) return false;
  const {results} = await db.prepare("SELECT policy_version AS version,approval_hash AS approval " +
    "FROM play_refund_policy WHERE singleton=1").all<{version: string; approval: string}>();
  return results.length === 0 || results[0].version === policy.version &&
    results[0].approval === policy.approvalSha256;
}

/** Called only on a mutating server route after explicit owner configuration.
 * This records approval metadata; it does not manufacture approval. Existing
 * protections persist when checkout is turned off. No raw tokens or PII.
 * Backfill adopts only provider-fenced journals with recorded settlement
 * authority, never synthetic/legacy internal grants lacking that evidence.
 */
export async function registerPlayRefundPolicy(
  db: D1Database, policy: PlayRefundPolicy, nowMs = Date.now(),
): Promise<boolean> {
  if (!validPolicy(policy) || !Number.isSafeInteger(nowMs) || nowMs <= 0) return false;
  const existing = await db.prepare("SELECT policy_version AS version,approval_hash AS approval " +
    "FROM play_refund_policy WHERE singleton=1").all<{version: string; approval: string}>();
  if (existing.results.length) return existing.results[0].version === policy.version &&
    existing.results[0].approval === policy.approvalSha256;
  await db.batch([
    db.prepare("INSERT INTO play_refund_policy(singleton,policy_version,approval_hash,activated_at_ms) " +
      "VALUES(1,?,?,?) ON CONFLICT(singleton) DO NOTHING")
      .bind(policy.version, policy.approvalSha256, nowMs),
    db.prepare("INSERT INTO play_refund_reviews(source_key_hash,account_id,seconds,reason," +
      "policy_version,approval_hash,opened_at_ms) " +
      "SELECT o.source_key_hash,o.account_id,o.seconds,f.reason,p.policy_version,p.approval_hash," +
      "MAX(o.created_at_ms,f.recorded_at_ms) FROM play_consume_outbox AS o " +
      "JOIN play_revocation_fences AS f ON f.source_key_hash=o.source_key_hash " +
      "CROSS JOIN play_refund_policy AS p WHERE p.singleton=1 AND p.policy_version=? " +
      "AND p.approval_hash=? AND o.settlement_policy_version IS NOT NULL " +
      "AND o.settlement_approval_hash IS NOT NULL ON CONFLICT(source_key_hash) DO NOTHING")
      .bind(policy.version, policy.approvalSha256),
  ]);
  return canUsePlayRefundPolicy(db, policy);
}

export async function hasOwnOpenRefundReview(
  db: D1Database, accountId: string, bearerHash: string,
): Promise<boolean> {
  const {results} = await db.prepare("SELECT 1 AS found FROM play_refund_reviews AS r " +
    "JOIN accounts AS a ON a.id=r.account_id AND a.status='active' " +
    "JOIN auth_sessions AS s ON s.account_id=a.id AND s.token_hash=? AND s.expires_at>unixepoch() " +
    "WHERE r.account_id=? AND r.state='open' LIMIT 1")
    .bind(bearerHash, accountId).all<{found: number}>();
  return results[0]?.found === 1;
}

/** User-owned neutral summary for support/export. 'uncoveredSeconds' means
 * a review cannot currently reserve that amount, not a charge or money owed.
 * Previously active call reservations have priority and are excluded first.
 */
export async function readOwnRefundReviewSummary(db: D1Database, bearer: string): Promise<{
  openCases: number; heldSeconds: number; uncoveredSeconds: number;
} | null> {
  if (!validSessionToken(bearer)) return null;
  const {results} = await db.prepare("SELECT " + refundReviewDemandSql("a.id") + " AS demand," +
    "(SELECT COUNT(*) FROM play_refund_reviews AS r WHERE r.account_id=a.id AND r.state='open') AS cases," +
    "MAX(0,COALESCE(b.available_seconds,0)-COALESCE((SELECT SUM(u.reserved_seconds) " +
    "FROM call_usage_sessions AS u WHERE u.caller_account_id=a.id AND u.state='active'),0)) AS available " +
    "FROM auth_sessions AS s JOIN accounts AS a ON a.id=s.account_id AND a.status='active' " +
    "LEFT JOIN call_credit_balances AS b ON b.account_id=a.id " +
    "WHERE s.token_hash=? AND s.expires_at>unixepoch()")
    .bind(await sessionHash(bearer)).all<{demand: number; cases: number; available: number}>();
  const row = results[0];
  if (!row) return null;
  if (![row.demand, row.cases, row.available].every(n => Number.isSafeInteger(n) && n >= 0))
    throw Error("Invalid refund review summary");
  const heldSeconds = Math.min(row.demand, row.available);
  return {openCases: row.cases, heldSeconds, uncoveredSeconds: row.demand - heldSeconds};
}

/** Bounded operator-only queue. The case ID is a token digest, never a raw
 * receipt. Account-level held/uncovered amounts deliberately are NOT allocated
 * to individual purchases: mixed credits cannot prove which purchase was used.
 */
export async function listReviewedPlayRefundCases(
  db: D1Database, policy: PlayRefundPolicy, after: string | null = null,
): Promise<{cases: ReadonlyArray<{
  caseId: string; accountId: string; seconds: number; reason: string; openedAtMs: number;
  accountHeldSeconds: number; accountUncoveredSeconds: number;
}>; nextCursor: string | null} | null> {
  if (!validPolicy(policy) || (after !== null && !digest(after)) ||
      !await canUsePlayRefundPolicy(db, policy)) return null;
  const demand = refundReviewDemandSql("r.account_id");
  const available = "MAX(0,COALESCE(b.available_seconds,0)-COALESCE((SELECT SUM(u.reserved_seconds) " +
    "FROM call_usage_sessions AS u WHERE u.caller_account_id=r.account_id AND u.state='active'),0))";
  const {results} = await db.prepare("SELECT r.source_key_hash AS caseId,r.account_id AS accountId," +
    "r.seconds,r.reason,r.opened_at_ms AS openedAtMs," +
    "MIN(" + demand + "," + available + ") AS accountHeldSeconds," +
    "MAX(0," + demand + "-" + available + ") AS accountUncoveredSeconds " +
    "FROM play_refund_reviews AS r LEFT JOIN call_credit_balances AS b ON b.account_id=r.account_id " +
    "WHERE r.state='open' AND r.policy_version=? AND r.approval_hash=? " +
    "AND (? IS NULL OR r.source_key_hash>?) ORDER BY r.source_key_hash LIMIT 26")
    .bind(policy.version, policy.approvalSha256, after, after).all<{
      caseId: string; accountId: string; seconds: number; reason: string; openedAtMs: number;
      accountHeldSeconds: number; accountUncoveredSeconds: number;
    }>();
  const cases = results.slice(0, 25);
  return {cases, nextCursor: results.length > 25 ? cases[cases.length - 1].caseId : null};
}

/** Trusted support-operation seam; deliberately NO public/user HTTP route.
 * An operator can release a hold only after a separate documented case review.
 * Its immutable evidence digest makes replay idempotent. This releases the
 * existing balance only: no regrant, debt, debit, provider refund or resurrection
 * of the voided purchase. The underlying source-key fence stays in place.
 */
export async function releaseReviewedPlayRefundHold(
  db: D1Database, input: Readonly<{
    sourceKeyHash: string; policy: PlayRefundPolicy;
    resolutionEvidenceHash: string; resolvedAtMs: number;
  }>,
): Promise<"applied" | "replay" | "denied"> {
  if (!input || !digest(input.sourceKeyHash) || !validPolicy(input.policy) ||
      !digest(input.resolutionEvidenceHash) || !Number.isSafeInteger(input.resolvedAtMs) ||
      input.resolvedAtMs <= 0) return "denied";
  const {results} = await db.prepare("UPDATE play_refund_reviews SET state='released'," +
    "resolution_evidence_hash=?,resolved_at_ms=? WHERE source_key_hash=? AND state='open' " +
    "AND opened_at_ms<=? AND policy_version=? AND approval_hash=? " +
    "AND EXISTS(SELECT 1 FROM play_refund_policy AS p WHERE p.singleton=1 " +
    "AND p.policy_version=? AND p.approval_hash=?) RETURNING source_key_hash")
    .bind(input.resolutionEvidenceHash, input.resolvedAtMs, input.sourceKeyHash,
      input.resolvedAtMs, input.policy.version, input.policy.approvalSha256,
      input.policy.version, input.policy.approvalSha256).all<{source_key_hash: string}>();
  if (results.length === 1) return "applied";
  const existing = await db.prepare("SELECT resolution_evidence_hash AS evidence FROM play_refund_reviews " +
    "WHERE source_key_hash=? AND state='released' AND policy_version=? AND approval_hash=?")
    .bind(input.sourceKeyHash, input.policy.version, input.policy.approvalSha256)
    .all<{evidence: string}>();
  return existing.results[0]?.evidence === input.resolutionEvidenceHash ? "replay" : "denied";
}
