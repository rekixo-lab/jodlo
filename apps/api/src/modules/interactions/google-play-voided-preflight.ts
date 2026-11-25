import { withinPlayDeadline, readPlayBoundedJson } from "./play-provider-bounds.ts";
import { scanJodloPlayVoidedPurchases } from "./play-voided-purchase-scan.ts";
import {
  inspectJodloPlayOneTimePurchase,
  PLAY_PREFLIGHT_TIMEOUT_MS,
} from "./google-play-purchase-preflight.ts";
import type { PlayPreflightDeps } from "./google-play-purchase-preflight.ts";

/** Google's Voided Purchases API covers recent revocations only. Do NOT
 * mistake a clean scan for a complete historical purchase/refund ledger.
 * Old purchases and incomplete pagination cannot be cleared. */
export const PLAY_VOIDED_SAFE_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 128 * 1024;

type ScreenedResult =
  | Readonly<{kind: "screened_candidate"; productId: string; seconds: number; sourceKeyHash: string; purchasedAtMs: number}>
  | Readonly<{kind: "not_eligible" | "unavailable" | "unconfigured"}>;

/** Returns a NON-PRIVILEGED candidate only after BOTH a Google V2 read and
 * a complete bounded one-time-product voided-purchases scan. This module:
 * - has no SQL/database/ledger imports or writes;
 * - never acknowledges, consumes, refunds or creates a purchase;
 * - is NOT exposed by an HTTP route;
 * - cannot detect revocations that happen AFTER the scan, and does not
 * replace RTDN, historical reconciliation, operator support or refund policy.
 */
export async function inspectJodloPlayPurchaseWithVoids(
  accountId: string, purchaseToken: string, deps: PlayPreflightDeps,
): Promise<ScreenedResult> {
  const initial = await inspectJodloPlayOneTimePurchase(accountId, purchaseToken, deps);
  if (initial.kind !== "candidate") return initial;

  const nowMs = (deps.now ?? Date.now)();
  if (!Number.isSafeInteger(nowMs) || nowMs <= PLAY_VOIDED_SAFE_WINDOW_MS ||
      initial.purchasedAtMs < nowMs - PLAY_VOIDED_SAFE_WINDOW_MS ||
      initial.purchasedAtMs > nowMs + 60_000)
    return {kind: "unavailable"};

  const outcome = await inspectJodloPlayRecentVoids(purchaseToken, nowMs, deps);
  if (outcome === "matched") return {kind: "not_eligible"};
  if (outcome !== "clear") return {kind: "unavailable"};
  return {kind: "screened_candidate", productId: initial.productId,
    seconds: initial.seconds, sourceKeyHash: initial.sourceKeyHash,
    purchasedAtMs: initial.purchasedAtMs};
}

/** Shared read-only void scan for initial screening and explicit recovery.
 * A caller MUST separately check the purchase timestamp lies inside this
 * window; a clear result is never evidence of lifetime refund history.
 */
export async function inspectJodloPlayRecentVoids(
  purchaseToken: string, nowMs: number, deps: PlayPreflightDeps,
): Promise<"clear" | "matched" | "unavailable"> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= PLAY_VOIDED_SAFE_WINDOW_MS)
    return "unavailable";
  // A recent clear scan is only screening, never lifetime refund proof.
  // The canonical pagination, cursor and malformed-provider policy is shared
  // with authenticated RTDN revocation processing.
  const startTime = nowMs - PLAY_VOIDED_SAFE_WINDOW_MS;
  const timeoutMs = deps.timeoutMs ?? PLAY_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PLAY_PREFLIGHT_TIMEOUT_MS)
    return "unavailable";
  const started = performance.now();
  const timeLeft = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - started)));

  try {
    const oauth = await withinPlayDeadline(deps.accessToken, timeLeft);
    if (!oauth || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(oauth))
      return "unavailable";

    const request = deps.request ?? fetch;
    const outcome = await scanJodloPlayVoidedPurchases(
      purchaseToken, startTime, nowMs, async endpoint => {
        const response = await withinPlayDeadline(() => request(endpoint, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(Math.max(1, timeLeft())),
          headers: {Authorization: "Bearer " + oauth, Accept: "application/json"},
        }), timeLeft);
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          throw Error("Google Play voided purchases unavailable");
        }
        return readPlayBoundedJson(response, timeLeft, MAX_JSON_BYTES);
      },
    );
    if (outcome === "matched") return "matched";
    return outcome === "clear" && timeLeft() > 0 ? "clear" : "unavailable";
  } catch {
    // OAuth, unreadable response, timeouts and provider errors all fail closed.
    return "unavailable";
  }
}
