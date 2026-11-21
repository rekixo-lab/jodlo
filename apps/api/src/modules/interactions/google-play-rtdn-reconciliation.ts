import { withinPlayDeadline, readPlayBoundedJson } from "./play-provider-bounds.ts";
import type { D1Database } from "../../data/d1.ts";
import {
  type AuthenticatedPlayPush,
} from "./google-play-pubsub-auth.ts";
import {
  recordTrustedPlayRevocation,
} from "./google-play-rtdn-fences.ts";
import {
  JODLO_PLAY_PACKAGE, jodloPlayPurchaseFingerprint,
} from "./google-play-purchase-preflight.ts";

const MAX_PROVIDER_MS = 5_000;
const MAX_VOIDS = 8;
const PAGE_SIZE = 200;
const MAX_PROVIDER_BODY = 128 * 1024;
const VOID_SEARCH_MS = 8 * 24 * 60 * 60 * 1000;
const publisher = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
  JODLO_PLAY_PACKAGE;

export type PlayRevocationResult = "applied" | "replay" | "retry" | "purchase_pending";

type Provider = Readonly<{
  accessToken(): Promise<string | null>;
  request?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function productCanceled(
  push: AuthenticatedPlayPush,
  get: (endpoint: string) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const data = await get(publisher + "/purchases/productsv2/tokens/" +
    encodeURIComponent(push.purchaseToken));
  const state = obj(data.purchaseStateContext);
  if (data.kind !== "androidpublisher#productPurchaseV2" ||
      state?.purchaseState !== "CANCELLED" ||
      !Array.isArray(data.productLineItem) || data.productLineItem.length !== 1)
    return false;
  const item = obj(data.productLineItem[0]);
  return item?.productId === push.hint.productId;
}

async function productVoided(
  push: AuthenticatedPlayPush, nowMs: number,
  get: (endpoint: string) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const first = nowMs - VOID_SEARCH_MS;
  if (push.hint.eventTimeMs < first) return false;
  let cursor: string | null = null;
  const seen = new Set<string>();
  let processed = 0;
  for (let page = 0; page < MAX_VOIDS; page++) {
    const endpoint = new URL(publisher + "/purchases/voidedpurchases");
    endpoint.searchParams.set("type", "0");
    endpoint.searchParams.set("includeQuantityBasedPartialRefund", "true");
    endpoint.searchParams.set("pageSelection.maxResults", String(PAGE_SIZE));
    if (cursor === null) {
      endpoint.searchParams.set("startTime", String(first));
      endpoint.searchParams.set("endTime", String(nowMs));
    } else endpoint.searchParams.set("pageSelection.token", cursor);
    const data = await get(endpoint.toString());
    const rows = data.voidedPurchases;
    if (rows !== undefined && (!Array.isArray(rows) || rows.length > PAGE_SIZE))
      return false;
    const pagination = data.tokenPagination === undefined
      ? null : obj(data.tokenPagination);
    if (data.tokenPagination !== undefined && !pagination) return false;
    const next = pagination?.nextPageToken;
    if (next !== undefined && next !== null &&
        (typeof next !== "string" || next.length < 1 || next.length > 4096 ||
         !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(next)))
      return false;
    const records = rows === undefined ? [] : rows as unknown[];
    if (next && !records.length) return false;
    for (const row of records) {
      const item = obj(row);
      if (!item || item.kind !== "androidpublisher#voidedPurchase" ||
          typeof item.purchaseToken !== "string" || !item.purchaseToken)
        return false;
      // An authenticated provider's exact token match is sufficient proof
      // of revocation; later pages cannot reverse a matching void entry.
      if (item.purchaseToken === push.purchaseToken) return true;
    }
    processed += records.length;
    const info = obj(data.pageInfo);
    if (info?.totalResults !== undefined &&
        (!Number.isSafeInteger(info.totalResults) ||
         (info.totalResults as number) < 0)) return false;
    if (!next) {
      if (info?.totalResults !== undefined &&
          (info.totalResults as number) > processed) return false;
      return false; // no authoritative matching row yet: retry later
    }
    if (seen.has(next)) return false;
    seen.add(next);
    cursor = next as string;
  }
  return false; // not a complete lookup, no revocation write
}

/**
 * Process a previously signature-VERIFIED Pub/Sub notification. Neither
 * the JWT nor the notification alone constitutes proof of a reversal.
 * Require an authenticated Google Developer API lookup for the exact token,
 * package and SKU (cancellation) or one-time void record (refund).
 *
 * Purchase notifications are intentionally NOT acknowledged or credited:
 * a separate user-authenticated entitlement coordinator is still required.
 * No provider POST, no fund transfer, no balance debit, no token persistence.
 */
export async function reconcileAuthenticatedJodloPlayRevocation(
  db: D1Database, push: AuthenticatedPlayPush, provider: Provider,
): Promise<PlayRevocationResult> {
  if (!push || push.kind !== "authenticated" ||
      push.hint?.kind === "purchase_hint") return "purchase_pending";
  if (push.hint.kind !== "canceled_hint" && push.hint.kind !== "voided_hint")
    return "retry";
  const timeoutMs = provider.timeoutMs ?? MAX_PROVIDER_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > MAX_PROVIDER_MS) return "retry";
  const now = provider.now ?? Date.now;
  const start = performance.now();
  const remaining = () => Math.max(0, Math.floor(timeoutMs - (performance.now() - start)));
  try {
    const nowMs = now();
    // Even an internal caller cannot fence an unrelated token digest.
    if (await withinPlayDeadline(
      () => jodloPlayPurchaseFingerprint(push.purchaseToken), remaining,
    ) !== push.hint.sourceKeyHash) return "retry";
    if (!Number.isSafeInteger(nowMs) || nowMs <= VOID_SEARCH_MS ||
        !Number.isSafeInteger(push.hint.eventTimeMs) ||
        push.hint.eventTimeMs > nowMs + 300_000 ||
        push.hint.eventTimeMs < nowMs - 7 * 24 * 60 * 60 * 1000)
      return "retry";
    const access = await withinPlayDeadline(provider.accessToken, remaining);
    if (!access || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(access))
      return "retry";
    const request = provider.request ?? fetch;
    const get = async (endpoint: string) => {
      const response = await withinPlayDeadline(() => request(endpoint, {
        method: "GET", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, remaining())),
        headers: {Authorization: "Bearer " + access, Accept: "application/json"},
      }), remaining);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw Error("Google Play status unavailable");
      }
      const data = obj(await readPlayBoundedJson(response, remaining, MAX_PROVIDER_BODY));
      if (!data) throw Error("Google Play malformed JSON");
      return data;
    };
    const confirmed = push.hint.kind === "canceled_hint"
      ? await productCanceled(push, get)
      : await productVoided(push, nowMs, get);
    if (!confirmed || remaining() <= 0) return "retry";
    // This is the only D1 write in this chain. An OIDC signature is only
    // transport authentication; provider read is the financial proof.
    const answer = await withinPlayDeadline(() => recordTrustedPlayRevocation(db, {
      sourceKeyHash: push.hint.sourceKeyHash,
      reason: push.hint.kind === "canceled_hint"
        ? "one_time_canceled" : "voided_purchase",
      recordedAtMs: now(),
    }), remaining);
    return answer === "applied" || answer === "replay" ? answer : "retry";
  } catch {
    return "retry";
  }
}
