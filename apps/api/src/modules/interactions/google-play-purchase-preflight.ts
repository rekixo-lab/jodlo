import { withinPlayDeadline, readPlayBoundedJson } from "./play-provider-bounds.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import { playPurchaseEnvironment, type PlayPurchaseEnvironment } from "./play-license-test-policy.ts";

/** This read-only, internal gate never mutates a ledger,
 * acknowledges or consumes a purchase, or grants an entitlement.
 *
 * The separately configured settlement coordinator must add voided-purchase checks,
 * account-bound entitlement recovery, consumption/ack handling and refunds
 * before any credit may reach recordTrustedCallCreditEvent().
 */
export const JODLO_PLAY_PACKAGE = "com.rekixo.jodlo";
export const PLAY_PREFLIGHT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 16_384;
const encoder = new TextEncoder();

export type PlayPreflightDeps = Readonly<{
  /** Trusted JODLO Play Console product IDs and exact minute quantities.
   * No default products are configured: callers must supply a nonempty map. */
  approvedProducts: ReadonlyMap<string, number>;
  /** Parsed server secret. An HTTP request must never choose these accounts. */
  licenseTestAccountBindings?: ReadonlySet<string>;
  accessToken(): Promise<string | null>;
  request?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;

export type PlayPreflightResult =
  | Readonly<{kind: "candidate"; productId: string; seconds: number; purchasedAtMs: number; sourceKeyHash: string; purchaseEnvironment: PlayPurchaseEnvironment}>
  | Readonly<{kind: "not_eligible" | "unavailable" | "unconfigured"}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function hexSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** One canonical Play V2 token shape shared by API ingress, preflight and
 * fingerprint. This is validation, never evidence a purchase was made. */
export function validJodloPlayPurchaseToken(input: unknown): input is string {
  return typeof input === "string" &&
    new RegExp("^[A-Za-z0-9._~+/=-]{20,4096}$").test(input);
}

/** Canonical, non-reversible purchase token fingerprint shared by Google
 * GET verification, D1 outbox and an eventual consume attempt. */
export async function jodloPlayPurchaseFingerprint(purchaseToken: string): Promise<string | null> {
  if (!validJodloPlayPurchaseToken(purchaseToken)) return null;
  return hexSha256("jodlo-play-product-v2:" + JODLO_PLAY_PACKAGE + ":" + purchaseToken);
}

/** Stable, 64-character one-way account binding for the signed-in
 * BillingFlowParams.setObfuscatedAccountId; do not send raw account IDs, email
 * or Google subject to Play. Never accept an arbitrary client-chosen binding.
 */
export async function jodloPlayAccountBinding(accountId: string): Promise<string | null> {
  if (!validOpaqueId(accountId)) return null;
  return hexSha256("jodlo-play-account-v1:" + JODLO_PLAY_PACKAGE + ":" + accountId);
}

/** Strictly one, full-price-equivalent consumable unit, unconsumed,
 * unacknowledged, PURCHASED and bound to the exact JODLO account.
 * This is only a fraud-screening preflight. An earlier voided/refunded
 * purchase could require additional checks even when this read is positive.
 */
export function validatePlayProductPurchaseV2(
  input: unknown, accountBinding: string,
  approvedProducts: ReadonlyMap<string, number>, nowMs: number,
  licenseTestAccountBindings?: ReadonlySet<string>,
): {productId: string; seconds: number; purchasedAtMs: number; purchaseEnvironment: PlayPurchaseEnvironment} | null {
  const value = record(input);
  const purchaseEnvironment = playPurchaseEnvironment(value?.testPurchaseContext);
  if (!value || !/^[0-9a-f]{64}$/.test(accountBinding) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      value.kind !== "androidpublisher#productPurchaseV2" ||
      value.obfuscatedExternalAccountId !== accountBinding ||
      !purchaseEnvironment || purchaseEnvironment === "license_test" &&
        !licenseTestAccountBindings?.has(accountBinding) ||
      value.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING" ||
      record(value.purchaseStateContext)?.purchaseState !== "PURCHASED" ||
      (value.orderId !== undefined && (typeof value.orderId !== "string" ||
        !/^GPA\.[A-Za-z0-9.\-]{8,120}$/.test(value.orderId))) ||
      typeof value.purchaseCompletionTime !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.purchaseCompletionTime))
    return null;
  const completedAt = Date.parse(value.purchaseCompletionTime);
  if (!Number.isFinite(completedAt) || completedAt <= 0 || completedAt > nowMs + 60_000)
    return null;
  if (!Array.isArray(value.productLineItem) || value.productLineItem.length !== 1)
    return null;
  const line = record(value.productLineItem[0]);
  const offer = record(line?.productOfferDetails);
  if (!line || !offer || typeof line.productId !== "string" ||
      !approvedProducts.has(line.productId) ||
      offer.quantity !== 1 || offer.refundableQuantity !== 1 ||
      offer.consumptionState !== "CONSUMPTION_STATE_YET_TO_BE_CONSUMED" ||
      offer.rentOfferDetails !== undefined || offer.preorderOfferDetails !== undefined)
    return null;
  const minutes = approvedProducts.get(line.productId);
  if (!Number.isSafeInteger(minutes) || minutes! < 1 || minutes! > 500)
    return null;
  return {productId: line.productId, seconds: minutes! * 60, purchasedAtMs: completedAt, purchaseEnvironment};
}

function validProducts(products: ReadonlyMap<string, number>): boolean {
  if (!(products instanceof Map) || products.size < 1 || products.size > 16) return false;
  for (const [id, minutes] of products) {
    if (!/^[a-z][a-z0-9._]{2,99}$/.test(id) ||
        !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 500) return false;
  }
  return true;
}

/** Trusted caller only. A candidate is NOT a credit grant, Play
 * acknowledgement, refund check or verified settlement. */
export async function inspectJodloPlayOneTimePurchase(
  accountId: string, purchaseToken: string, deps: PlayPreflightDeps,
): Promise<PlayPreflightResult> {
  if (!validProducts(deps.approvedProducts)) return {kind: "unconfigured"};
  if (!validOpaqueId(accountId) || !validJodloPlayPurchaseToken(purchaseToken))
    return {kind: "not_eligible"};
  const timeoutMs = deps.timeoutMs ?? PLAY_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PLAY_PREFLIGHT_TIMEOUT_MS) return {kind: "unconfigured"};
  const now = deps.now ?? Date.now;
  const started = performance.now();
  const budget = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - started)));
  try {
    const expected = await withinPlayDeadline(() => jodloPlayAccountBinding(accountId), budget);
    if (!expected) return {kind: "not_eligible"};
    const oauth = await withinPlayDeadline(deps.accessToken, budget);
    if (!oauth || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(oauth))
      return {kind: "unavailable"};
    const endpoint = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      JODLO_PLAY_PACKAGE + "/purchases/productsv2/tokens/" + encodeURIComponent(purchaseToken);
    const request = deps.request ?? fetch;
    const response = await withinPlayDeadline(() => request(endpoint, {
      method: "GET", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(budget()),
      headers: {Authorization: "Bearer " + oauth, Accept: "application/json"},
    }), budget);
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return {kind: [401, 403, 408, 429].includes(response.status) ||
        response.status >= 500 ? "unavailable" : "not_eligible"};
    }
    const receipt = await readPlayBoundedJson(response, budget, MAX_RESPONSE_BYTES);
    if (budget() <= 0) return {kind: "unavailable"};
    const verified = validatePlayProductPurchaseV2(receipt, expected,
      deps.approvedProducts, now(), deps.licenseTestAccountBindings);
    if (!verified) return {kind: "not_eligible"};
    // The fingerprint is scoped to the canonical package AND token, NOT the
    // SKU, to prevent cross-SKU replay of the same Play purchase.
    const sourceKeyHash = await withinPlayDeadline(
      () => jodloPlayPurchaseFingerprint(purchaseToken), budget);
    if (sourceKeyHash === null) return {kind: "not_eligible"};
    return {kind: "candidate", ...verified, sourceKeyHash};
  } catch {
    return {kind: "unavailable"};
  }
}
