import type { D1Database } from "../../data/d1.ts";
import { jodloPlayPurchaseFingerprint, JODLO_PLAY_PACKAGE } from "./google-play-purchase-preflight.ts";

/**
 * This parser accepts UNTRUSTED Pub/Sub push JSON and returns NON-AUTHORITATIVE
 * hints. It NEVER authenticates the Pub/Sub publisher, writes D1, grants
 * minutes or triggers a consume. Future RTDN HTTP ingestion MUST verify the
 * Google-signed OIDC JWT, exact audience + service-account identity, and an
 * approved subscription before interpreting a hint as trusted evidence.
 */
export type PlayRtdnHint = Readonly<{
  kind: "purchase_hint" | "canceled_hint" | "voided_hint";
  sourceKeyHash: string;
  eventTimeMs: number;
  productId: string | null;
}>;

const MAX_PUBSUB_DATA_BASE64 = 8192;
const MAX_PUBSUB_DATA_BYTES = 6144;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validProductId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9._]{2,99}$/.test(value);
}

function parseEventTime(value: unknown, nowMs: number): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{9,15}$/.test(value)) return null;
  const eventTimeMs = Number(value);
  return Number.isSafeInteger(eventTimeMs) &&
    eventTimeMs <= nowMs + MAX_FUTURE_SKEW_MS &&
    eventTimeMs >= nowMs - MAX_EVENT_AGE_MS ? eventTimeMs : null;
}

function validBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PUBSUB_DATA_BASE64 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

/** Zero side effects. Do not pass the returned hash directly to the writer:
 * a syntactically valid RTDN body is not a verified refund or cancellation.
 * Purchase hints also NEVER grant credit.
 */
export async function decodeUntrustedJodloRtdnHint(
  envelope: unknown, nowMs: number,
): Promise<PlayRtdnHint | null> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return null;
  const wrapper = obj(envelope);
  const message = obj(wrapper?.message);
  if (!wrapper || !message ||
      typeof wrapper.subscription !== "string" ||
      !/^projects\/[a-z][a-z0-9-]{4,80}\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%\-]{2,200}$/.test(wrapper.subscription) ||
      typeof message.messageId !== "string" ||
      !/^[0-9]{1,64}$/.test(message.messageId) ||
      !validBase64(message.data))
    return null;
  try {
    const raw = atob(message.data);
    if (raw.length > MAX_PUBSUB_DATA_BYTES) return null;
    const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
    const data = obj(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!data || data.version !== "1.0" || data.packageName !== JODLO_PLAY_PACKAGE)
      return null;
    const eventTimeMs = parseEventTime(data.eventTimeMillis, nowMs);
    if (eventTimeMs === null) return null;

    const oneTime = obj(data.oneTimeProductNotification);
    const voided = obj(data.voidedPurchaseNotification);
    const categories = [
      data.oneTimeProductNotification, data.voidedPurchaseNotification,
      data.subscriptionNotification, data.pendingRefundReviewNotification,
      data.testNotification,
    ].filter(value => value !== undefined);
    if (categories.length !== 1) return null;

    let kind: PlayRtdnHint["kind"];
    let token: unknown;
    let productId: string | null = null;

    if (oneTime && oneTime.version === "1.0" &&
        (oneTime.notificationType === 1 || oneTime.notificationType === 2) &&
        validProductId(oneTime.sku)) {
      token = oneTime.purchaseToken;
      productId = oneTime.sku;
      kind = oneTime.notificationType === 1 ? "purchase_hint" : "canceled_hint";
    } else if (voided && voided.productType === 2 &&
      (voided.refundType === 1 || voided.refundType === 2)) {
      token = voided.purchaseToken;
      kind = "voided_hint";
    } else return null;

    const sourceKeyHash = await jodloPlayPurchaseFingerprint(token as string);
    if (!sourceKeyHash) return null;
    return { kind, sourceKeyHash, eventTimeMs, productId };
  } catch {
    return null;
  }
}

export type TrustedPlayRevocation = Readonly<{
  sourceKeyHash: string;
  reason: "one_time_canceled" | "voided_purchase";
  recordedAtMs: number;
}>;

/** Internal, privileged, offline-only write seam. Its caller MUST independently
 * verify a Google Pub/Sub OIDC JWT/authorized subscription and the actual
 * provider purchase/refund state. A parsed RTDN hint is NEVER this proof.
 *
 * Account-independent SHA256 tombstones prevent later out-of-order purchase
 * grants; D1 triggers freeze an existing purchase, including in-flight sends.
 * Exactly-once replay is protected by a global source digest PRIMARY KEY.
 */
export async function recordTrustedPlayRevocation(
  db: D1Database, notification: TrustedPlayRevocation,
): Promise<"applied" | "replay" | "denied"> {
  if (!notification || typeof notification.sourceKeyHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(notification.sourceKeyHash) ||
      (notification.reason !== "one_time_canceled" &&
       notification.reason !== "voided_purchase") ||
      !Number.isSafeInteger(notification.recordedAtMs) ||
      notification.recordedAtMs <= 0)
    return "denied";
  const { results } = await db.prepare(
    "INSERT INTO play_revocation_fences(source_key_hash,reason,recorded_at_ms) " +
    "VALUES (?,?,?) ON CONFLICT(source_key_hash) DO NOTHING RETURNING source_key_hash",
  ).bind(notification.sourceKeyHash,notification.reason,notification.recordedAtMs)
    .all<{source_key_hash:string}>();
  return results.length === 1 ? "applied" : "replay";
}

/** Private operational visibility only, not a public HTTP route. Even a
 * known hashed key cannot reveal a token, owner, or purchase transaction. */
export async function isPlayPurchaseRevoked(
  db: D1Database, sourceKeyHash: string,
): Promise<boolean> {
  if (typeof sourceKeyHash !== "string" || !/^[0-9a-f]{64}$/.test(sourceKeyHash))
    return true;
  const { results } = await db.prepare(
    "SELECT 1 AS blocked FROM play_revocation_fences WHERE source_key_hash=?",
  ).bind(sourceKeyHash).all<{blocked:number}>();
  return results[0]?.blocked === 1;
}
