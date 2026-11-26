import type { D1Database, Env } from "../../data/d1.ts";
import { hasEmptyBody, readPlaySettlementBody } from "../../http/body.ts";
import { findSessionAccount, sessionHash, validSessionToken } from "../identity/sessions.ts";
import { createPlayAndroidPublisherAccessTokenSource } from "./google-play-androidpublisher-oauth.ts";
import { validJodloPubSubPolicy } from "./google-play-pubsub-auth.ts";
import { jodloPlayAccountBinding, jodloPlayPurchaseFingerprint } from "./google-play-purchase-preflight.ts";
import { inspectJodloPlayPurchaseWithVoids, inspectJodloPlayRecentVoids,
  PLAY_VOIDED_SAFE_WINDOW_MS } from "./google-play-voided-preflight.ts";
import { jodloPlayMinuteProductMap } from "./play-minute-packs.ts";
import { JODLO_PLAY_SETTLEMENT_POLICY_VERSION } from "./play-settlement-policy.ts";
import { configuredPlayLicenseTestBindings, type PlayPurchaseEnvironment } from "./play-license-test-policy.ts";
import { configuredPlayRefundPolicy, canUsePlayRefundPolicy, registerPlayRefundPolicy,
  hasOwnOpenRefundReview } from "./play-refund-review.ts";
import { recordTrustedPlayRevocation } from "./google-play-rtdn-fences.ts";
import { stageTrustedPlayConsumable, claimPlayConsumeOnce, deliverClaimedPlayConsume,
  reconcileUnknownPlayConsume, quarantineExpiredPlayConsume } from "./play-consumable-outbox.ts";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};
const failure = (status: number, code: string, extra: HeadersInit = {}) =>
  new Response(JSON.stringify({ok: false, error: {code, message: "Purchase settlement unavailable"}}),
    {status, headers: {...HEADERS, ...extra}});
const success = (data: unknown) => new Response(JSON.stringify({ok: true, data}), {headers: HEADERS});

type SettlementRow = {
  productId: string; seconds: number;
  status: "ready" | "sending" | "unknown" | "consumed" | "void_hold";
  attemptId: string | null; deadlineMs: number | null;
  policyVersion: string | null; approvalSha256: string | null; purchasedAtMs: number | null;
  purchaseEnvironment: PlayPurchaseEnvironment;
};

/** The token hash is never enough to choose an owner. Every journal read is
 * joined to this SAME live session and account in one SQLite statement. */
async function readSettlement(
  db: D1Database, accountId: string, tokenHash: string, bearerHash: string,
): Promise<SettlementRow | null> {
  const {results} = await db.prepare(
    "SELECT o.product_id AS productId,o.seconds,o.status,o.attempt_id AS attemptId," +
    "o.attempt_deadline_ms AS deadlineMs,o.settlement_policy_version AS policyVersion," +
    "o.settlement_approval_hash AS approvalSha256,o.verified_purchased_at_ms AS purchasedAtMs," +
    "o.purchase_environment AS purchaseEnvironment " +
    "FROM play_consume_outbox AS o JOIN accounts AS a ON a.id=o.account_id AND a.status='active' " +
    "JOIN auth_sessions AS s ON s.account_id=a.id AND s.token_hash=? AND s.expires_at>unixepoch() " +
    "WHERE o.source_key_hash=? AND o.account_id=?",
  ).bind(bearerHash, tokenHash, accountId).all<SettlementRow>();
  const row = results[0];
  if (!row) return null;
  if (!Number.isSafeInteger(row.seconds) || row.seconds < 60 || row.seconds > 30000 ||
      jodloPlayMinuteProductMap().get(row.productId) !== row.seconds / 60 ||
      !["ready", "sending", "unknown", "consumed", "void_hold"].includes(row.status) ||
      !["production", "license_test"].includes(row.purchaseEnvironment))
    throw Error("Invalid settlement journal");
  return row;
}

/** Default OFF. Approval is an explicit server configuration made only after
 * the owner reviews the versioned settlement/refund/retention/support policy.
 * The client version is a protocol acknowledgement, never release approval.
 * RTDN config is required before a purchase capability can be advertised.
 */
export function playSettlementConfigured(env: Env): boolean {
  return env.PLAY_SETTLEMENT_ENABLED === "1" &&
    configuredPlayLicenseTestBindings(env) !== null &&
    env.PLAY_SETTLEMENT_POLICY_VERSION === JODLO_PLAY_SETTLEMENT_POLICY_VERSION &&
    /^[a-f0-9]{64}$/.test(env.PLAY_SETTLEMENT_APPROVAL_SHA256 ?? "") &&
    env.PLAY_SETTLEMENT_APPROVAL_SHA256 !== "0".repeat(64) &&
    env.PLAY_CATALOG_ENABLED === "1" && env.PLAY_ACCOUNT_VIEW_ENABLED === "1" &&
    env.PLAY_VERIFICATION_ENABLED === "1" && env.PLAY_RTDN_ENABLED === "1" &&
    !!env.DB && !!env.PLAY_SETTLEMENT_LIMITER && !!env.PLAY_VERIFICATION_LIMITER &&
    !!env.PLAY_RTDN_LIMITER && !!env.PLAY_SERVICE_ACCOUNT_EMAIL &&
    !!env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY && !!configuredPlayRefundPolicy(env) && validJodloPubSubPolicy({
      audience: env.PLAY_RTDN_AUDIENCE, email: env.PLAY_RTDN_PUSH_EMAIL,
      subscription: env.PLAY_RTDN_SUBSCRIPTION,
    });
}

/**
 * GET: configured checkout capability plus a fresh obfuscated owner binding.
 * POST: explicit purchase/restore settlement. Initial receipts must pass the
 * canonical Google V2 owner/SKU/purchased/unconsumed checks and complete recent
 * void scan. A session-fenced SQL INSERT atomically creates one journal, one
 * credit event and one balance change, with immutable reviewed policy evidence.
 *
 * Existing consumed journals replay without a new grant or provider call.
 * Ambiguous sends NEVER POST again: an explicit retry only GET-reconciles.
 * Credits can already be granted while consumption is pending; the UI must
 * read the authoritative balance rather than infer it from this response.
 * Refunds freeze a journal; this handler never silently claws back spent time,
 * invents a refund decision, or converts an old diagnostic screening response.
 * Raw purchase tokens live in this request only; no logs or persistence.
 */
export async function handleConfiguredJodloPlaySettlement(
  request: Request, env: Env,
  testOnly?: Readonly<{
    accessToken?: () => Promise<string | null>;
    playRequest?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  }>,
): Promise<Response> {
  if (env.PLAY_SETTLEMENT_ENABLED !== "1") return failure(404, "NOT_FOUND");
  if (request.method !== "GET" && request.method !== "POST")
    return failure(405, "METHOD_NOT_ALLOWED", {Allow: "GET, POST"});
  if (new URL(request.url).search) return failure(400, "INVALID_QUERY");
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!validSessionToken(bearer)) return failure(401, "UNAUTHORIZED");
  if (!playSettlementConfigured(env)) return failure(503, "SERVICE_UNAVAILABLE");
  const db = env.DB!;
  const policyVersion = env.PLAY_SETTLEMENT_POLICY_VERSION!;
  const approvalSha256 = env.PLAY_SETTLEMENT_APPROVAL_SHA256!;
  const now = testOnly?.now ?? Date.now;
  try {
    // Validate credential SHAPE even for capability GET; this does not prove
    // that Google currently accepts the credential or that SKUs are published.
    const productionAccessToken = createPlayAndroidPublisherAccessTokenSource({
      email: env.PLAY_SERVICE_ACCOUNT_EMAIL!, privateKey: env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY!,
    });
    const accountId = await findSessionAccount(db, bearer);
    if (!accountId) return failure(401, "UNAUTHORIZED");
    const bearerHash = await sessionHash(bearer);
    const stillOwner = async () => await findSessionAccount(db, bearer) === accountId;
    if (!(await env.PLAY_SETTLEMENT_LIMITER!.limit({key: "play-settle-" + bearerHash.slice(0, 32)})).success)
      return failure(429, "RATE_LIMITED", {"Retry-After": "60"});
    if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
    // Missing settlement/environment migrations block capability BEFORE checkout.
    await db.prepare("SELECT settlement_policy_version,settlement_approval_hash," +
      "verified_purchased_at_ms,purchase_environment FROM play_consume_outbox LIMIT 0").all();
    const refundPolicy = configuredPlayRefundPolicy(env)!;
    if (!await canUsePlayRefundPolicy(db, refundPolicy)) return failure(503, "SERVICE_UNAVAILABLE");
    if (await hasOwnOpenRefundReview(db, accountId, bearerHash)) {
      if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
      return request.method === "GET" ? failure(409, "REVIEW_REQUIRED")
        : success({status: "manual_review"});
    }
    if (request.method === "GET") {
      if (!await hasEmptyBody(request)) return failure(400, "INVALID_QUERY");
      const accountBinding = await jodloPlayAccountBinding(accountId);
      if (!accountBinding) return failure(503, "SERVICE_UNAVAILABLE");
      if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
      return success({accountBinding, policyVersion, settlementEnabled: true});
    }
    const input = await readPlaySettlementBody(request);
    if (!input || input.policyVersion !== policyVersion) return failure(400, "INVALID_QUERY");
    if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
    if (!await registerPlayRefundPolicy(db, refundPolicy, now()))
      return failure(503, "SERVICE_UNAVAILABLE");
    const tokenHash = await jodloPlayPurchaseFingerprint(input.purchaseToken);
    if (!tokenHash) return failure(400, "INVALID_QUERY");
    const provider = {
      approvedProducts: jodloPlayMinuteProductMap(),
      licenseTestAccountBindings: configuredPlayLicenseTestBindings(env)!,
      accessToken: testOnly?.accessToken ?? productionAccessToken,
      request: testOnly?.playRequest, now, timeoutMs: testOnly?.timeoutMs,
    };
    const read = () => readSettlement(db, accountId, tokenHash, bearerHash);
    const hasPolicy = (row: SettlementRow) => row.policyVersion === policyVersion &&
      row.approvalSha256 === approvalSha256 && Number.isSafeInteger(row.purchasedAtMs) &&
      row.purchasedAtMs! > 0;
    const reply = async (row: SettlementRow | null, fallback = "pending_reconciliation") => {
      if (await hasOwnOpenRefundReview(db, accountId, bearerHash)) {
        if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
        return success({status: "manual_review"});
      }
      if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
      if (!row) return success({status: fallback});
      if (!hasPolicy(row) || row.status === "void_hold") return success({status: "manual_review"});
      return row.status === "consumed"
        ? success({status: "settled", productId: row.productId, minutes: row.seconds / 60})
        : success({status: "pending_reconciliation"});
    };
    let row = await read();
    if (row && (!hasPolicy(row) || row.status === "void_hold" || row.status === "consumed"))
      return reply(row);
    if (row?.status === "sending") {
      if (!Number.isSafeInteger(row.deadlineMs) || row.deadlineMs! > now()) return reply(row);
      if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
      await quarantineExpiredPlayConsume(db, accountId, tokenHash, now(), bearerHash);
      row = await read();
      if (!row || row.status !== "unknown") return reply(row);
    }
    if (row?.status === "unknown") {
      if (!hasPolicy(row) || row.purchasedAtMs! < now() - PLAY_VOIDED_SAFE_WINDOW_MS ||
          row.purchasedAtMs! > now() + 60_000 || !row.attemptId || !row.deadlineMs)
        return reply(null, "manual_review");
      const voids = await inspectJodloPlayRecentVoids(input.purchaseToken, now(), provider);
      if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
      if (voids === "matched") {
        await recordTrustedPlayRevocation(db, {sourceKeyHash: tokenHash,
          reason: "voided_purchase", recordedAtMs: now()}, {accountId, sessionHash: bearerHash});
        return reply(await read(), "manual_review");
      }
      if (voids !== "clear") return reply(row);
      await reconcileUnknownPlayConsume(db, {
        accountId, sourceKeyHash: tokenHash, productId: row.productId,
        attemptId: row.attemptId, deadlineMs: row.deadlineMs, sessionHash: bearerHash,
      }, input.purchaseToken, provider);
      return reply(await read());
    }
    // A new purchase OR definitely-unsent staged journal needs fresh checks.
    const screened = await inspectJodloPlayPurchaseWithVoids(accountId, input.purchaseToken, provider);
    if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
    if (screened.kind === "unavailable" || screened.kind === "unconfigured")
      return row ? reply(row) : failure(503, "SERVICE_UNAVAILABLE");
    if (screened.kind !== "screened_candidate") {
      // Another concurrent request may already have consumed this purchase.
      // Re-read the trusted journal before classifying that receipt as rejected.
      const fresh = await read();
      if (fresh?.status === "ready") {
        // A previously authorized but definitely-unsent grant now rejected by
        // Google needs explicit review. Independently confirmed recent voids
        // freeze it; an arbitrary malformed receipt is not called a refund.
        if (fresh.purchasedAtMs && fresh.purchasedAtMs >= now() - PLAY_VOIDED_SAFE_WINDOW_MS &&
            await inspectJodloPlayRecentVoids(input.purchaseToken, now(), provider) === "matched") {
          if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
          await recordTrustedPlayRevocation(db, {sourceKeyHash: tokenHash,
            reason: "voided_purchase", recordedAtMs: now()}, {accountId, sessionHash: bearerHash});
        }
        return reply(null, "manual_review");
      }
      return reply(fresh, "not_eligible");
    }
    if (row && (row.productId !== screened.productId || row.seconds !== screened.seconds ||
        row.purchasedAtMs !== screened.purchasedAtMs || row.purchaseEnvironment !== screened.purchaseEnvironment))
      return reply(null, "manual_review");
    const staged = await stageTrustedPlayConsumable(db, {
      accountId, sourceKeyHash: tokenHash, productId: screened.productId,
      seconds: screened.seconds, createdAtMs: now(),
    }, provider.approvedProducts, {sessionHash: bearerHash, policyVersion,
      approvalSha256, purchasedAtMs: screened.purchasedAtMs, purchaseEnvironment: screened.purchaseEnvironment});
    if (!await stillOwner()) return failure(401, "UNAUTHORIZED");
    if (staged === "void_hold") return reply(null, "manual_review");
    if (staged === "denied") return reply(null, "not_eligible");
    const claim = await claimPlayConsumeOnce(db, accountId, tokenHash, now(), bearerHash);
    if (claim) await deliverClaimedPlayConsume(db, claim, input.purchaseToken, provider);
    return reply(await read());
  } catch {
    // A request whose result was lost is recoverable through its durable token
    // hash journal. Never infer that a failed response means no credit occurred.
    return failure(503, "SERVICE_UNAVAILABLE");
  }
}
