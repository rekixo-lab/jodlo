import { JODLO_PLAY_PACKAGE, validJodloPlayPurchaseToken } from "./google-play-purchase-preflight.ts";

/**
 * One canonical, bounded Google Play Voided Purchases pagination policy.
 * Both owner receipt screening and authenticated RTDN reconciliation use it.
 * The caller owns OAuth, GET-only transport, response byte limits and deadline;
 * this module NEVER grants, consumes, acknowledges, refunds or writes D1.
 *
 * "clear" means only that the supplied RECENT window was fully scanned.
 * It is NOT historical proof that a purchase was never refunded.
 */
export type PlayVoidedScanStatus = "matched" | "clear" | "incomplete";
export const MAX_PLAY_VOIDED_PAGES = 8;
const PAGE_SIZE = 200;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export async function scanJodloPlayVoidedPurchases(
  purchaseToken: string, startTimeMs: number, nowMs: number,
  readPage: (endpoint: string) => Promise<unknown>,
): Promise<PlayVoidedScanStatus> {
  if (!validJodloPlayPurchaseToken(purchaseToken) ||
      !Number.isSafeInteger(startTimeMs) || startTimeMs <= 0 ||
      !Number.isSafeInteger(nowMs) || nowMs <= startTimeMs)
    return "incomplete";

  const seen = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;
  for (let page = 0; page < MAX_PLAY_VOIDED_PAGES; page++) {
    const url = new URL(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      JODLO_PLAY_PACKAGE + "/purchases/voidedpurchases",
    );
    url.searchParams.set("type", "0");
    url.searchParams.set("includeQuantityBasedPartialRefund", "true");
    url.searchParams.set("pageSelection.maxResults", String(PAGE_SIZE));
    if (cursor === null) {
      url.searchParams.set("startTime", String(startTimeMs));
      url.searchParams.set("endTime", String(nowMs));
    } else {
      url.searchParams.set("pageSelection.token", cursor);
    }

    const data = object(await readPage(url.toString()));
    if (!data) return "incomplete";
    const rows = data.voidedPurchases;
    if (rows !== undefined && (!Array.isArray(rows) || rows.length > PAGE_SIZE))
      return "incomplete";
    const pagination = data.tokenPagination === undefined
      ? null : object(data.tokenPagination);
    if (data.tokenPagination !== undefined && !pagination)
      return "incomplete";
    const next = pagination?.nextPageToken;
    if (next !== undefined && next !== null &&
        (typeof next !== "string" || next.length < 1 || next.length > 4096 ||
         !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(next)))
      return "incomplete";
    const pageInfo = data.pageInfo === undefined ? null : object(data.pageInfo);
    if (data.pageInfo !== undefined && !pageInfo) return "incomplete";
    if (pageInfo?.totalResults !== undefined &&
        (!Number.isSafeInteger(pageInfo.totalResults) ||
         (pageInfo.totalResults as number) < 0))
      return "incomplete";
    const records = rows === undefined ? [] : rows as unknown[];
    if (next && records.length === 0) return "incomplete";
    for (const row of records) {
      const item = object(row);
      if (!item || item.kind !== "androidpublisher#voidedPurchase" ||
          typeof item.purchaseToken !== "string" || !item.purchaseToken)
        return "incomplete";
      // Exact match is decisive revocation evidence; a later page cannot undo it.
      if (item.purchaseToken === purchaseToken) return "matched";
    }
    scanned += records.length;
    if (!next) {
      if (pageInfo?.totalResults !== undefined &&
          (pageInfo.totalResults as number) > scanned) return "incomplete";
      return "clear";
    }
    if (seen.has(next as string)) return "incomplete";
    seen.add(next as string);
    cursor = next as string;
  }
  // Never treat a truncated scan as proof of no revocation.
  return "incomplete";
}
