import type { D1Database } from "../../data/d1.ts";
import type { AuthenticatedPendingPlayRefundPush } from "./google-play-pubsub-auth.ts";
import { PLAY_PENDING_REFUND_RESPONSE_MS } from "./google-play-rtdn-fences.ts";
import { jodloPlayAccountBinding, jodloPlayPurchaseFingerprint, JODLO_PLAY_PACKAGE } from "./google-play-purchase-preflight.ts";
import { playPurchaseEnvironment, type PlayPurchaseEnvironment } from "./play-license-test-policy.ts";
import { jodloPlayMinuteProductMap } from "./play-minute-packs.ts";
import { JODLO_PLAY_SETTLEMENT_POLICY_VERSION } from "./play-settlement-policy.ts";
import { canUsePlayRefundPolicy, type PlayRefundPolicy } from "./play-refund-review.ts";
import { withinPlayDeadline, readPlayBoundedJson } from "./play-provider-bounds.ts";

const MAX_PROVIDER_MS = 5000;
// A crashed request can never acquire a second attempt. After this interval its
// original durable fence becomes an explicit unknown outcome for the operator.
const ABANDONED_SUBMISSION_MS = 10_000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const publisher = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + JODLO_PLAY_PACKAGE;
const digest = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value) && value !== "0".repeat(64);
const time = (value: number) => Number.isSafeInteger(value) && value > 0 &&
  value <= Number.MAX_SAFE_INTEGER - PLAY_PENDING_REFUND_RESPONSE_MS;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export type PlayRefundPreference = "APPROVE" | "DECLINE" | "NEUTRAL";
export type PendingPlayRefundReviewState = "open" | "queued" | "submitting" | "submitted" | "unknown" | "reviewed" | "expired";
const preference = (value: unknown): value is PlayRefundPreference => value === "APPROVE" || value === "DECLINE" || value === "NEUTRAL";

type Provider = Readonly<{
  accessToken(): Promise<string | null>;
  refundPolicy: PlayRefundPolicy;
  request?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;
type ConfirmedPurchase = {
  accountId: string; productId: string; seconds: number; purchasedAtMs: number;
  purchaseEnvironment: PlayPurchaseEnvironment; settlementApproval: string;
};
type ReviewRow = {
  caseId: string; sourceKeyHash: string; accountId: string; purchaseEnvironment: PlayPurchaseEnvironment;
  orderHash: string; binding: string; eventTime: number; deadline: number; policy: string; approval: string;
  state: PendingPlayRefundReviewState; refundPreference: PlayRefundPreference | null;
  sampleContentProvided: number | null; decisionEvidence: string | null;
  decisionAt: number | null; submissionStartedAt: number | null;
};
const CASE_SELECT = "SELECT case_id AS caseId,source_key_hash AS sourceKeyHash,account_id AS accountId," +
  "purchase_environment AS purchaseEnvironment,order_hash AS orderHash,account_binding AS binding," +
  "event_time_ms AS eventTime,response_deadline_ms AS deadline,policy_version AS policy,approval_hash AS approval," +
  "state,refund_preference AS refundPreference,sample_content_provided AS sampleContentProvided," +
  "decision_evidence_hash AS decisionEvidence,decision_at_ms AS decisionAt,submission_started_at_ms AS submissionStartedAt " +
  "FROM play_pending_refund_reviews WHERE case_id=?";

async function scopedFingerprint(scope: "order" | "pending-refund", value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    "jodlo-play-" + scope + "-v1:" + JODLO_PLAY_PACKAGE + ":" + value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** An authenticated pending review is NOT a confirmed refund. Orders GET and
 * a fresh V2 GET bind it to an existing authorized grant. OPEN cases return a
 * retry, retaining the original notification at Pub/Sub without storing its
 * token. Only a separately authenticated, explicit operator decision permits
 * the next identical signed delivery to POST ReviewRefund once. A crash or
 * ambiguous POST cannot be retried. No local credits, holds or consumption are
 * changed, and pooled minute usage is never guessed for an individual order.
 *
 * Sources: developer.android.com/google/play/billing/rtdn-reference and
 * developers.google.com/android-publisher/api-ref/rest/v3/orders/reviewrefund .
 */
export async function recordAuthenticatedPendingPlayRefundReview(
  db: D1Database, push: AuthenticatedPendingPlayRefundPush, provider: Provider,
): Promise<"applied" | "replay" | "retry"> {
  const hint = push?.hint, now = provider.now ?? Date.now;
  const timeoutMs = provider.timeoutMs ?? MAX_PROVIDER_MS;
  if (push?.kind !== "authenticated_pending_refund_review" || hint?.kind !== "pending_refund_review_hint" ||
      !digest(hint.caseId) || (hint.accountBinding !== null && !digest(hint.accountBinding)) ||
      typeof hint.pendingRefundToken !== "string" || !/^[!-~]{1,4096}$/.test(hint.pendingRefundToken) ||
      !/^GPA\.[A-Za-z0-9.\-]{8,120}$/.test(hint.orderId) || !/^[0-9]{1,64}$/.test(hint.providerMessageId) ||
      !time(hint.eventTimeMs) || hint.responseDeadlineMs !== hint.eventTimeMs + PLAY_PENDING_REFUND_RESPONSE_MS ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PROVIDER_MS) return "retry";
  const started = performance.now();
  const remaining = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - started)));
  const bounded = <T>(action: () => Promise<T>) => withinPlayDeadline(action, remaining);
  const readCase = async () => (await bounded(() => db.prepare(CASE_SELECT).bind(hint.caseId).all<ReviewRow>())).results[0];
  let claimed = false;
  const finishSubmission = async (state: "submitted" | "unknown") => bounded(() => db.prepare(
    "UPDATE play_pending_refund_reviews SET state=?,submission_finished_at_ms=MAX(?,unixepoch()*1000,submission_started_at_ms) " +
    "WHERE case_id=? AND state='submitting' RETURNING case_id",
  ).bind(state, now(), hint.caseId).all<{case_id: string}>());
  try {
    const receivedAtMs = now();
    if (!time(receivedAtMs) || hint.eventTimeMs > receivedAtMs + 300_000 ||
        hint.eventTimeMs < receivedAtMs - MAX_EVENT_AGE_MS ||
        !await bounded(() => canUsePlayRefundPolicy(db, provider.refundPolicy)) ||
        await bounded(() => scopedFingerprint("pending-refund", hint.pendingRefundToken)) !== hint.caseId) return "retry";
    const orderHash = await bounded(() => scopedFingerprint("order", hint.orderId));
    const matches = (row: ReviewRow) => row.orderHash === orderHash &&
      (hint.accountBinding === null || row.binding === hint.accountBinding) &&
      row.eventTime === hint.eventTimeMs && row.deadline === hint.responseDeadlineMs &&
      row.policy === provider.refundPolicy.version && row.approval === provider.refundPolicy.approvalSha256;
    // This never extends the original deadline or automatically chooses a
    // recommendation. An expired unsent case remains visible as missed.
    const disposition = async (row: ReviewRow): Promise<"replay" | "retry" | "queued"> => {
      if (!matches(row)) return "retry";
      if (["submitted", "unknown", "reviewed", "expired"].includes(row.state)) return "replay";
      if (row.state === "submitting") {
        const abandoned = await bounded(() => db.prepare(
          "UPDATE play_pending_refund_reviews SET state='unknown'," +
          "submission_finished_at_ms=MAX(?,unixepoch()*1000,submission_started_at_ms) " +
          "WHERE case_id=? AND state='submitting' AND submission_started_at_ms+?<=MAX(?,unixepoch()*1000) RETURNING case_id",
        ).bind(now(), hint.caseId, ABANDONED_SUBMISSION_MS, now()).all<{case_id: string}>());
        return abandoned.results.length === 1 ? "replay" : "retry";
      }
      const expired = await bounded(() => db.prepare(
        "UPDATE play_pending_refund_reviews SET state='expired' WHERE case_id=? AND state IN ('open','queued') " +
        "AND response_deadline_ms<=MAX(?,unixepoch()*1000) RETURNING case_id",
      ).bind(hint.caseId, now()).all<{case_id: string}>());
      if (expired.results.length === 1) return "replay";
      return row.state === "queued" ? "queued" : "retry";
    };
    let row = await readCase();
    if (row) {
      const result = await disposition(row);
      if (result !== "queued") return result;
    }
    const access = await bounded(provider.accessToken);
    if (!access || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(access)) return "retry";
    const request = provider.request ?? fetch;
    const get = async (endpoint: string) => {
      const response = await bounded(() => request(endpoint, {method: "GET", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, remaining())),
        headers: {Authorization: "Bearer " + access, Accept: "application/json"}}));
      if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw Error("Play review lookup unavailable"); }
      const result = object(await readPlayBoundedJson(response, remaining, 16_384));
      if (!result) throw Error("Invalid Play review lookup");
      return result;
    };
    const orderUrl = new URL(publisher + "/orders/" + encodeURIComponent(hint.orderId));
    // Request only correlation fields, never prices, tax, name or address.
    orderUrl.searchParams.set("fields", "orderId,purchaseToken,lineItems(productId,oneTimePurchaseDetails(quantity))");
    const order = await get(orderUrl.toString());
    if (order.orderId !== hint.orderId || typeof order.purchaseToken !== "string" ||
        !Array.isArray(order.lineItems) || order.lineItems.length !== 1) return "retry";
    const orderItem = object(order.lineItems[0]);
    if (!orderItem || object(orderItem.oneTimePurchaseDetails)?.quantity !== 1) return "retry";
    const sourceKeyHash = await bounded(() => jodloPlayPurchaseFingerprint(order.purchaseToken as string));
    if (!sourceKeyHash) return "retry";
    const {results} = await bounded(() => db.prepare(
      "SELECT o.account_id AS accountId,o.product_id AS productId,o.seconds,o.verified_purchased_at_ms AS purchasedAtMs," +
      "o.purchase_environment AS purchaseEnvironment,o.settlement_approval_hash AS settlementApproval " +
      "FROM play_consume_outbox AS o JOIN accounts AS a ON a.id=o.account_id " +
      "WHERE o.source_key_hash=? AND o.settlement_policy_version=? AND o.settlement_approval_hash IS NOT NULL " +
      "AND o.verified_purchased_at_ms IS NOT NULL",
    ).bind(sourceKeyHash, JODLO_PLAY_SETTLEMENT_POLICY_VERSION).all<ConfirmedPurchase>());
    const purchase = results[0];
    if (!purchase || !digest(purchase.settlementApproval) || !time(purchase.purchasedAtMs) ||
        purchase.purchasedAtMs > hint.eventTimeMs + 60_000 ||
        !Number.isSafeInteger(purchase.seconds) || jodloPlayMinuteProductMap().get(purchase.productId) !== purchase.seconds / 60 ||
        orderItem.productId !== purchase.productId) return "retry";
    const binding = await bounded(() => jodloPlayAccountBinding(purchase.accountId));
    if (!binding || hint.accountBinding !== null && binding !== hint.accountBinding) return "retry";
    const receipt = await get(publisher + "/purchases/productsv2/tokens/" + encodeURIComponent(order.purchaseToken));
    if (receipt.kind !== "androidpublisher#productPurchaseV2" || receipt.orderId !== hint.orderId ||
        receipt.obfuscatedExternalAccountId !== binding ||
        playPurchaseEnvironment(receipt.testPurchaseContext) !== purchase.purchaseEnvironment ||
        !["PURCHASED", "CANCELLED"].includes(String(object(receipt.purchaseStateContext)?.purchaseState)) ||
        typeof receipt.purchaseCompletionTime !== "string" || Date.parse(receipt.purchaseCompletionTime) !== purchase.purchasedAtMs ||
        !Array.isArray(receipt.productLineItem) || receipt.productLineItem.length !== 1) return "retry";
    const item = object(receipt.productLineItem[0]), offer = object(item?.productOfferDetails);
    if (item?.productId !== purchase.productId || offer?.quantity !== 1 ||
        (offer.refundableQuantity !== 0 && offer.refundableQuantity !== 1) ||
        offer.rentOfferDetails !== undefined || offer.preorderOfferDetails !== undefined) return "retry";
    if (row && (row.sourceKeyHash !== sourceKeyHash || row.accountId !== purchase.accountId ||
        row.purchaseEnvironment !== purchase.purchaseEnvironment)) return "retry";
    if (!row) {
      await bounded(() => db.prepare(
        "INSERT INTO play_pending_refund_reviews(case_id,source_key_hash,account_id,account_binding,order_hash," +
        "purchase_environment,provider_message_id,event_time_ms,response_deadline_ms,received_at_ms,policy_version,approval_hash) " +
        "SELECT ?,o.source_key_hash,o.account_id,?,?,o.purchase_environment,?,?,?,?,p.policy_version,p.approval_hash " +
        "FROM play_consume_outbox AS o JOIN accounts AS a ON a.id=o.account_id CROSS JOIN play_refund_policy AS p " +
        "WHERE o.source_key_hash=? AND o.account_id=? AND o.product_id=? AND o.seconds=? AND o.purchase_environment=? " +
        "AND o.verified_purchased_at_ms=? AND o.settlement_policy_version=? AND o.settlement_approval_hash=? " +
        "AND p.singleton=1 AND p.policy_version=? AND p.approval_hash=? " +
        "ON CONFLICT(case_id) DO NOTHING RETURNING case_id",
      ).bind(hint.caseId, binding, orderHash, hint.providerMessageId, hint.eventTimeMs, hint.responseDeadlineMs, receivedAtMs,
        sourceKeyHash, purchase.accountId, purchase.productId, purchase.seconds, purchase.purchaseEnvironment, purchase.purchasedAtMs,
        JODLO_PLAY_SETTLEMENT_POLICY_VERSION, purchase.settlementApproval, provider.refundPolicy.version, provider.refundPolicy.approvalSha256)
        .all<{case_id: string}>());
      row = await readCase();
      if (!row || row.sourceKeyHash !== sourceKeyHash || row.accountId !== purchase.accountId ||
          row.purchaseEnvironment !== purchase.purchaseEnvironment) return "retry";
      const result = await disposition(row);
      if (result !== "queued") return result;
    }
    // Fresh provider proof precedes this irrevocable send fence. Every field
    // is read from the operator's immutable decision; the RTDN cannot decide.
    const claim = await bounded(() => db.prepare(
      "UPDATE play_pending_refund_reviews SET state='submitting',submission_started_at_ms=MAX(?,unixepoch()*1000) " +
      "WHERE case_id=? AND state='queued' AND source_key_hash=? AND account_id=? AND purchase_environment=? " +
      "AND order_hash=? AND account_binding=? AND event_time_ms=? AND response_deadline_ms>MAX(?,unixepoch()*1000) " +
      "AND policy_version=? AND approval_hash=? AND EXISTS(SELECT 1 FROM play_refund_policy AS p " +
      "WHERE p.singleton=1 AND p.policy_version=? AND p.approval_hash=?) " +
      "AND EXISTS(SELECT 1 FROM play_consume_outbox AS o JOIN accounts AS a ON a.id=o.account_id " +
      "WHERE o.source_key_hash=play_pending_refund_reviews.source_key_hash AND o.account_id=? AND o.product_id=? " +
      "AND o.seconds=? AND o.verified_purchased_at_ms=? AND o.purchase_environment=? AND o.settlement_policy_version=? " +
      "AND o.settlement_approval_hash=?) " +
      "RETURNING refund_preference AS preference,sample_content_provided AS sample",
    ).bind(now(), hint.caseId, sourceKeyHash, purchase.accountId, purchase.purchaseEnvironment,
      orderHash, binding, hint.eventTimeMs, now(), provider.refundPolicy.version, provider.refundPolicy.approvalSha256,
      provider.refundPolicy.version, provider.refundPolicy.approvalSha256, purchase.accountId, purchase.productId,
      purchase.seconds, purchase.purchasedAtMs, purchase.purchaseEnvironment, JODLO_PLAY_SETTLEMENT_POLICY_VERSION,
      purchase.settlementApproval).all<{preference: PlayRefundPreference; sample: number}>());
    const decision = claim.results[0];
    if (!decision) {
      const latest = await readCase();
      const result = latest ? await disposition(latest) : "retry";
      return result === "queued" ? "retry" : result;
    }
    claimed = true;
    // Account erasure, a policy change or expiry while the claim was queued
    // must not cause a late provider action. A taken fence is never recycled.
    const live = await bounded(() => db.prepare(
      "SELECT 1 AS found FROM play_pending_refund_reviews AS r JOIN accounts AS a ON a.id=r.account_id " +
      "JOIN play_refund_policy AS p ON p.singleton=1 AND p.policy_version=r.policy_version AND p.approval_hash=r.approval_hash " +
      "WHERE r.case_id=? AND r.state='submitting' AND r.response_deadline_ms>MAX(?,unixepoch()*1000)",
    ).bind(hint.caseId, now()).all<{found: number}>());
    if (live.results[0]?.found !== 1 || remaining() <= 0 || now() >= hint.responseDeadlineMs) {
      await finishSubmission("unknown");
      return "replay";
    }
    const response = await bounded(() => request(publisher + "/orders/" + encodeURIComponent(hint.orderId) + ":reviewrefund", {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, remaining())),
      headers: {Authorization: "Bearer " + access, Accept: "application/json", "Content-Type": "application/json"},
      body: JSON.stringify({pendingRefundToken: hint.pendingRefundToken,
        sampleContentProvided: decision.sample === 1, refundPreference: decision.preference}),
    }));
    void response.body?.cancel().catch(() => {});
    const confirmed = response.status === 200 || response.status === 204;
    await finishSubmission(confirmed ? "submitted" : "unknown");
    return "applied";
  } catch {
    // A rejected promise/timeout may still have reached Google. Do not infer
    // failure, repeat the POST, reverse a decision or modify customer credit.
    if (claimed) {
      try { await finishSubmission("unknown"); return "replay"; } catch { /* redelivery recovers the durable fence only */ }
    }
    return "retry";
  }
}

export type PendingPlayRefundReviewCase = Readonly<{
  caseId: string; accountId: string; sourceKeyHash: string; purchaseEnvironment: PlayPurchaseEnvironment;
  productId: string; eventTimeMs: number; responseDeadlineMs: number; receivedAtMs: number;
  providerMessageId: string; overdue: boolean; state: PendingPlayRefundReviewState;
  refundPreference: PlayRefundPreference | null; sampleContentProvided: boolean | null;
  decisionAtMs: number | null; submissionStartedAtMs: number | null; submissionFinishedAtMs: number | null;
}>;

/** Operator-only unresolved inbox, earliest deadline first. Includes missed
 * and unknown outcomes for investigation; submitted/manual receipts leave the
 * queue. No raw order, pending token, binding, receipt or evidence leaves. */
export async function listPendingPlayRefundReviews(
  db: D1Database, policy: PlayRefundPolicy, after: string | null = null, now = Date.now(),
): Promise<{cases: readonly PendingPlayRefundReviewCase[]; nextCursor: string | null} | null> {
  if (!time(now) || (after !== null && !digest(after)) || !await canUsePlayRefundPolicy(db, policy)) return null;
  const {results} = await db.prepare("SELECT r.case_id AS caseId,r.account_id AS accountId," +
    "r.source_key_hash AS sourceKeyHash,r.purchase_environment AS purchaseEnvironment,o.product_id AS productId," +
    "r.event_time_ms AS eventTimeMs,r.response_deadline_ms AS responseDeadlineMs,r.received_at_ms AS receivedAtMs," +
    "r.provider_message_id AS providerMessageId,r.state,r.refund_preference AS refundPreference," +
    "r.sample_content_provided AS sampleContentProvided,r.decision_at_ms AS decisionAtMs," +
    "r.submission_started_at_ms AS submissionStartedAtMs,r.submission_finished_at_ms AS submissionFinishedAtMs " +
    "FROM play_pending_refund_reviews AS r JOIN play_consume_outbox AS o ON o.source_key_hash=r.source_key_hash " +
    "WHERE r.state IN ('open','queued','submitting','unknown','expired') AND r.policy_version=? AND r.approval_hash=? AND (? IS NULL OR " +
    "(r.response_deadline_ms,r.case_id)>(SELECT anchor.response_deadline_ms,anchor.case_id " +
    "FROM play_pending_refund_reviews AS anchor WHERE anchor.case_id=? AND anchor.policy_version=? AND anchor.approval_hash=?)) " +
    "ORDER BY r.response_deadline_ms,r.case_id LIMIT 26")
    .bind(policy.version, policy.approvalSha256, after, after, policy.version, policy.approvalSha256)
    .all<Omit<PendingPlayRefundReviewCase, "overdue" | "sampleContentProvided"> & {sampleContentProvided: number | null}>();
  const cases = results.slice(0, 25).map(row => ({...row, overdue: row.responseDeadlineMs <= now,
    sampleContentProvided: row.sampleContentProvided === null ? null : row.sampleContentProvided === 1}));
  return {cases, nextCursor: results.length > 25 ? cases[cases.length - 1].caseId : null};
}

/** Explicit case-specific HUMAN decision. It never contacts Google here.
 * The decision is immutable and can only be sent by the original signed
 * notification before its original deadline. No default preference exists. */
export async function queuePendingPlayRefundReviewDecision(db: D1Database, input: Readonly<{
  caseId: string; policy: PlayRefundPolicy; refundPreference: PlayRefundPreference;
  sampleContentProvided: boolean; decisionEvidenceHash: string; decidedAtMs: number;
}>): Promise<"applied" | "replay" | "denied"> {
  if (!input || !digest(input.caseId) || !digest(input.decisionEvidenceHash) || !time(input.decidedAtMs) ||
      !preference(input.refundPreference) || typeof input.sampleContentProvided !== "boolean" ||
      !await canUsePlayRefundPolicy(db, input.policy)) return "denied";
  const {results} = await db.prepare("UPDATE play_pending_refund_reviews SET state='queued',refund_preference=?," +
    "sample_content_provided=?,decision_evidence_hash=?,decision_at_ms=MAX(?,unixepoch()*1000) " +
    "WHERE case_id=? AND state='open' AND received_at_ms<=MAX(?,unixepoch()*1000) " +
    "AND response_deadline_ms>MAX(?,unixepoch()*1000) AND policy_version=? AND approval_hash=? " +
    "AND EXISTS(SELECT 1 FROM play_refund_policy AS p WHERE p.singleton=1 AND p.policy_version=? AND p.approval_hash=?) RETURNING case_id")
    .bind(input.refundPreference, input.sampleContentProvided ? 1 : 0, input.decisionEvidenceHash, input.decidedAtMs,
      input.caseId, input.decidedAtMs, input.decidedAtMs, input.policy.version, input.policy.approvalSha256,
      input.policy.version, input.policy.approvalSha256).all<{case_id: string}>();
  if (results.length === 1) return "applied";
  const old = await db.prepare("SELECT refund_preference AS preference,sample_content_provided AS sample," +
    "decision_evidence_hash AS evidence FROM play_pending_refund_reviews WHERE case_id=? " +
    "AND decision_at_ms IS NOT NULL AND policy_version=? AND approval_hash=?")
    .bind(input.caseId, input.policy.version, input.policy.approvalSha256)
    .all<{preference: PlayRefundPreference; sample: number; evidence: string}>();
  const row = old.results[0];
  return row?.preference === input.refundPreference && row.sample === (input.sampleContentProvided ? 1 : 0) &&
    row.evidence === input.decisionEvidenceHash ? "replay" : "denied";
}

/** Evidence of a separately completed HUMAN provider review. This never
 * sends a recommendation, makes a chargeback verdict or releases credit.
 * Active submissions cannot be overridden; ambiguous/missed outcomes can be
 * resolved only by an external receipt, never a second provider attempt. */
export async function recordPendingPlayRefundReviewOutcome(db: D1Database, input: Readonly<{
  caseId: string; policy: PlayRefundPolicy; resolutionEvidenceHash: string; reviewedAtMs: number;
}>): Promise<"applied" | "replay" | "denied"> {
  if (!input || !digest(input.caseId) || !digest(input.resolutionEvidenceHash) || !time(input.reviewedAtMs) ||
      !await canUsePlayRefundPolicy(db, input.policy)) return "denied";
  const {results} = await db.prepare("UPDATE play_pending_refund_reviews SET state='reviewed',reviewed_at_ms=MAX(?,unixepoch()*1000)," +
    "resolution_evidence_hash=? WHERE case_id=? AND state IN ('open','queued','unknown','expired') " +
    "AND received_at_ms<=MAX(?,unixepoch()*1000) AND policy_version=? AND approval_hash=? " +
    "AND EXISTS(SELECT 1 FROM play_refund_policy AS p WHERE p.singleton=1 AND p.policy_version=? AND p.approval_hash=?) RETURNING case_id")
    .bind(input.reviewedAtMs, input.resolutionEvidenceHash, input.caseId, input.reviewedAtMs,
      input.policy.version, input.policy.approvalSha256, input.policy.version, input.policy.approvalSha256).all<{case_id: string}>();
  if (results.length === 1) return "applied";
  const old = await db.prepare("SELECT resolution_evidence_hash AS evidence FROM play_pending_refund_reviews " +
    "WHERE case_id=? AND state='reviewed' AND policy_version=? AND approval_hash=?")
    .bind(input.caseId, input.policy.version, input.policy.approvalSha256).all<{evidence: string}>();
  return old.results[0]?.evidence === input.resolutionEvidenceHash ? "replay" : "denied";
}
