import {
  inspectJodloPlayOneTimePurchase, JODLO_PLAY_PACKAGE,
  PLAY_PREFLIGHT_TIMEOUT_MS,
} from "./google-play-purchase-preflight.ts";
import type { PlayPreflightDeps } from "./google-play-purchase-preflight.ts";

/** Google's Voided Purchases API covers recent revocations only. Do NOT
 * mistake a clean scan for a complete historical purchase/refund ledger.
 * Old purchases and incomplete pagination cannot be cleared. */
export const PLAY_VOIDED_SAFE_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 8;
const PAGE_SIZE = 200;
const MAX_JSON_BYTES = 128 * 1024;

type ScreenedResult =
  | Readonly<{kind: "screened_candidate"; productId: string; seconds: number; sourceKeyHash: string}>
  | Readonly<{kind: "not_eligible" | "unavailable" | "unconfigured"}>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function withinDeadline<T>(work: () => Promise<T>, timeLeft: () => number): Promise<T> {
  const remaining = timeLeft();
  if (remaining <= 0) throw new Error("Voided purchase scan deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Voided purchase scan deadline")), remaining);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function limitedJson(response: Response, timeLeft: () => number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES))
    throw new Error("Voided purchase oversized body");
  if (!response.body) throw new Error("Voided purchase missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const step = await withinDeadline(() => reader.read(), timeLeft);
      if (step.done) break;
      size += step.value.byteLength;
      if (size > MAX_JSON_BYTES) throw new Error("Voided purchase oversized body");
      chunks.push(step.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const full = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { full.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(full));
}

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

  // The 29-day window is deliberate: the API cannot reliably answer
  // whether a purchase older than its 30-day lookup window was refunded.
  const startTime = nowMs - PLAY_VOIDED_SAFE_WINDOW_MS;
  const timeoutMs = deps.timeoutMs ?? PLAY_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PLAY_PREFLIGHT_TIMEOUT_MS)
    return {kind: "unavailable"};
  const started = performance.now();
  const timeLeft = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - started)));

  try {
    const oauth = await withinDeadline(deps.accessToken, timeLeft);
    if (!oauth || !/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(oauth))
      return {kind: "unavailable"};

    const request = deps.request ?? fetch;
    const seenPageTokens = new Set<string>();
    let nextPage: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const endpoint = new URL("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
        JODLO_PLAY_PACKAGE + "/purchases/voidedpurchases");
      // Only in-app products; include quantity-based partial refunds.
      endpoint.searchParams.set("type", "0");
      endpoint.searchParams.set("includeQuantityBasedPartialRefund", "true");
      endpoint.searchParams.set("pageSelection.maxResults", String(PAGE_SIZE));
      if (nextPage === null) {
        endpoint.searchParams.set("startTime", String(startTime));
        endpoint.searchParams.set("endTime", String(nowMs));
      } else {
        endpoint.searchParams.set("pageSelection.token", nextPage);
      }

      const response = await withinDeadline(() => request(endpoint.toString(), {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, timeLeft())),
        headers: {Authorization: "Bearer " + oauth, Accept: "application/json"},
      }), timeLeft);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        return {kind: "unavailable"};
      }
      const responseObject = object(await limitedJson(response, timeLeft));
      if (!responseObject) return {kind: "unavailable"};
      const rows = responseObject.voidedPurchases;
      if (rows !== undefined && (!Array.isArray(rows) || rows.length > PAGE_SIZE))
        return {kind: "unavailable"};
      const pagination = responseObject.tokenPagination === undefined
        ? null : object(responseObject.tokenPagination);
      if (responseObject.tokenPagination !== undefined && !pagination)
        return {kind: "unavailable"};
      const rawNext = pagination?.nextPageToken;
      if (rawNext !== undefined && rawNext !== null &&
          (typeof rawNext !== "string" || rawNext.length < 1 ||
           rawNext.length > 4096 || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(rawNext)))
        return {kind: "unavailable"};
      const records = rows === undefined ? [] : rows as unknown[];
      const pageInfo = object(responseObject.pageInfo);
      if (records.length === 0 && pageInfo &&
          typeof pageInfo.totalResults === "number" && pageInfo.totalResults > 0)
        return {kind: "unavailable"};
      for (const row of records) {
        const item = object(row);
        // Missing token in a void record means we cannot safely exclude it.
        if (!item || item.kind !== "androidpublisher#voidedPurchase" ||
            typeof item.purchaseToken !== "string" || !item.purchaseToken)
          return {kind: "unavailable"};
        if (item.purchaseToken === purchaseToken) return {kind: "not_eligible"};
      }
      if (!rawNext) {
        if (timeLeft() <= 0) return {kind: "unavailable"};
        return {kind: "screened_candidate", productId: initial.productId,
          seconds: initial.seconds, sourceKeyHash: initial.sourceKeyHash};
      }
      if (seenPageTokens.has(rawNext)) return {kind: "unavailable"};
      seenPageTokens.add(rawNext);
      nextPage = rawNext;
    }
    // Never assert "not refunded" if there are more pages beyond our budget.
    return {kind: "unavailable"};
  } catch {
    // OAuth, unreadable response, timeouts and provider errors all fail closed.
    return {kind: "unavailable"};
  }
}
