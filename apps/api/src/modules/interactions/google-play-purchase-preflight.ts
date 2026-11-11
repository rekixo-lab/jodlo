import { validOpaqueId } from "../shared/identifiers.ts";

/** No JODLO Play SKUs, prices, billing launch or provider credentials are
 * authorized. This read-only, internal-only gate never mutates a ledger,
 * acknowledges or consumes a purchase, or grants an entitlement.
 *
 * A future trusted billing coordinator must add voided-purchase checks,
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
  accessToken(): Promise<string | null>;
  request?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;

export type PlayPreflightResult =
  | Readonly<{kind: "candidate"; productId: string; seconds: number; purchasedAtMs: number; sourceKeyHash: string}>
  | Readonly<{kind: "not_eligible" | "unavailable" | "unconfigured"}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function hexSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Canonical, non-reversible purchase token fingerprint shared by Google
 * GET verification, D1 outbox and an eventual consume attempt. */
export async function jodloPlayPurchaseFingerprint(purchaseToken: string): Promise<string | null> {
  if (typeof purchaseToken !== "string" ||
      !/^[A-Za-z0-9._~+\/=-]{20,4096}$/.test(purchaseToken)) return null;
  return hexSha256("jodlo-play-product-v2:" + JODLO_PLAY_PACKAGE + ":" + purchaseToken);
}

/** Stable, 64-character one-way account binding for a FUTURE signed-in
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
): {productId: string; seconds: number; purchasedAtMs: number} | null {
  const value = record(input);
  if (!value || !/^[0-9a-f]{64}$/.test(accountBinding) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      value.kind !== "androidpublisher#productPurchaseV2" ||
      value.obfuscatedExternalAccountId !== accountBinding ||
      value.testPurchaseContext !== undefined ||
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
  return {productId: line.productId, seconds: minutes! * 60, purchasedAtMs: completedAt};
}

function validProducts(products: ReadonlyMap<string, number>): boolean {
  if (!(products instanceof Map) || products.size < 1 || products.size > 16) return false;
  for (const [id, minutes] of products) {
    if (!/^[a-z][a-z0-9._]{2,99}$/.test(id) ||
        !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 500) return false;
  }
  return true;
}

async function cappedText(response: Response, budget: () => number): Promise<string | null> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))
    return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await withinBudget(() => reader.read(), budget);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return null;
      chunks.push(next.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) { combined.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder("utf-8", {fatal: true}).decode(combined);
}

/** Monotonic shared timeout for auth, provider GET and bounded JSON body.
 * A timed-out provider callback can never perform a late credit write
 * because this module has ZERO write operations.
 */
async function withinBudget<T>(work: () => Promise<T>, budget: () => number): Promise<T> {
  const remaining = budget();
  if (remaining <= 0) throw Error("Play verifier deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Play verifier deadline")), remaining);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Trusted caller only. A candidate is NOT a credit grant, Play
 * acknowledgement, refund check or verified settlement. */
export async function inspectJodloPlayOneTimePurchase(
  accountId: string, purchaseToken: string, deps: PlayPreflightDeps,
): Promise<PlayPreflightResult> {
  if (!validProducts(deps.approvedProducts)) return {kind: "unconfigured"};
  if (!validOpaqueId(accountId) || typeof purchaseToken !== "string" ||
      !/^[A-Za-z0-9._~+\/=-]{20,4096}$/.test(purchaseToken))
    return {kind: "not_eligible"};
  const timeoutMs = deps.timeoutMs ?? PLAY_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PLAY_PREFLIGHT_TIMEOUT_MS) return {kind: "unconfigured"};
  const now = deps.now ?? Date.now;
  const started = performance.now();
  const budget = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - started)));
  try {
    const expected = await withinBudget(() => jodloPlayAccountBinding(accountId), budget);
    if (!expected) return {kind: "not_eligible"};
    const oauth = await withinBudget(deps.accessToken, budget);
    if (!oauth || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(oauth))
      return {kind: "unavailable"};
    const endpoint = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      JODLO_PLAY_PACKAGE + "/purchases/productsv2/tokens/" + encodeURIComponent(purchaseToken);
    const request = deps.request ?? fetch;
    const response = await withinBudget(() => request(endpoint, {
      method: "GET", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(budget()),
      headers: {Authorization: "Bearer " + oauth, Accept: "application/json"},
    }), budget);
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return {kind: [401, 403, 408, 429].includes(response.status) ||
        response.status >= 500 ? "unavailable" : "not_eligible"};
    }
    const raw = await cappedText(response, budget);
    if (raw === null || budget() <= 0) return {kind: "unavailable"};
    const verified = validatePlayProductPurchaseV2(JSON.parse(raw), expected,
      deps.approvedProducts, now());
    if (!verified) return {kind: "not_eligible"};
    // The fingerprint is scoped to the canonical package AND token, NOT the
    // SKU, to prevent cross-SKU replay of the same Play purchase.
    const sourceKeyHash = await withinBudget(
      () => jodloPlayPurchaseFingerprint(purchaseToken), budget);
    if (sourceKeyHash === null) return {kind: "not_eligible"};
    return {kind: "candidate", ...verified, sourceKeyHash};
  } catch {
    return {kind: "unavailable"};
  }
}
