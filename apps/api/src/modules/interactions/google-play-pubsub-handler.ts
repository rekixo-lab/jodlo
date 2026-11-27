import type { Env } from "../../data/d1.ts";
import { authenticateJodloPlayPubSubPush } from "./google-play-pubsub-auth.ts";
import { reconcileAuthenticatedJodloPlayRevocation } from "./google-play-rtdn-reconciliation.ts";
import { createPlayAndroidPublisherAccessTokenSource } from
  "./google-play-androidpublisher-oauth.ts";
import type { JWTVerifyGetKey } from "jose";
import { configuredPlayRefundPolicy } from "./play-refund-review.ts";
import { recordAuthenticatedPendingPlayRefundReview } from "./play-pending-refund-review.ts";

/**
 * Default-OFF, narrowly scoped RTDN push ingress. This endpoint CANNOT
 * grant minutes, acknowledge/consume purchases or debit a
 * refunded balance. Only independently Google-confirmed cancellation/void
 * records can create token-hash revocation fences in the local D1 schema.
 * Separately verified pending chargebacks wait for an explicit operator
 * recommendation. A signed redelivery can send that immutable decision once;
 * it never chooses a refund verdict or changes a customer balance/hold.
 *
 * Production uses fixed Google JWKS + actual OAuth. Injected keys/network
 * adapters are used ONLY by isolated tests, never by the Worker router.
 */
export async function handleConfiguredJodloPlayRtdn(
  request: Request, env: Env,
  testOnly?: Readonly<{
    keys?: JWTVerifyGetKey;
    oauthRequest?: typeof fetch;
    playRequest?: typeof fetch;
    nowMs?: number;
  }>,
): Promise<Response> {
  const unavailable = () => new Response(null, {
    status:503,
    headers:{"Retry-After":"300","Cache-Control":"no-store"},
  });
  if (env.PLAY_RTDN_ENABLED !== "1") return new Response(null, {status:404});
  if (request.method !== "POST")
    return new Response(null, {status:405,headers:{Allow:"POST"}});
  if (new URL(request.url).search)
    return new Response(null, {status:400});
  if (!env.DB || !env.PLAY_RTDN_LIMITER ||
      !env.PLAY_RTDN_AUDIENCE ||
      !env.PLAY_RTDN_PUSH_EMAIL ||
      !env.PLAY_RTDN_SUBSCRIPTION ||
      !env.PLAY_SERVICE_ACCOUNT_EMAIL ||
      !env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY)
    return unavailable();

  try {
    const refundPolicy = configuredPlayRefundPolicy(env);
    if (env.PLAY_REFUND_HOLDS_ENABLED === "1" && !refundPolicy) return unavailable();
    const policy = {
      audience:env.PLAY_RTDN_AUDIENCE,
      email:env.PLAY_RTDN_PUSH_EMAIL,
      subscription:env.PLAY_RTDN_SUBSCRIPTION,
    };
    const authenticated = await authenticateJodloPlayPubSubPush(
      request, policy, testOnly?.nowMs ?? Date.now(),testOnly?.keys);
    if (authenticated.kind === "rejected")
      return new Response(null,{status:401,headers:{"Cache-Control":"no-store"}});
    // Acknowledge only the notification envelope. Purchases are settled by
    // the authenticated owner's separate provider-verification endpoint;
    // Console probes have no entitlement to change. Retrying either event
    // forever would starve the same subscription's refund notifications.
    if (authenticated.kind === "authenticated_noop" ||
        authenticated.kind === "authenticated" && authenticated.hint.kind === "purchase_hint")
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    if (authenticated.kind !== "authenticated" && authenticated.kind !== "authenticated_pending_refund_review")
      return unavailable();
    if (authenticated.kind === "authenticated_pending_refund_review" && !refundPolicy) return unavailable();
    // Only a fully Google-signed, exact-subscription payload may consume the
    // shared RTDN quota. Otherwise arbitrary unsigned traffic could exhaust
    // the quota and starve legitimate Pub/Sub retries of refund revocations.
    // Authentication is still bounded by the fixed Google JWKS and body caps.
    const limit = await env.PLAY_RTDN_LIMITER.limit({key:"google-play-rtdn"});
    if (!limit.success)
      return new Response(null,{
        status:429, headers:{"Retry-After":"60","Cache-Control":"no-store"},
      });

    const accessToken = createPlayAndroidPublisherAccessTokenSource({
      email:env.PLAY_SERVICE_ACCOUNT_EMAIL,
      privateKey:env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY,
    },testOnly?.oauthRequest);
    const result = authenticated.kind === "authenticated_pending_refund_review"
      ? await recordAuthenticatedPendingPlayRefundReview(env.DB, authenticated, {
        accessToken, request:testOnly?.playRequest, now:()=>testOnly?.nowMs ?? Date.now(), refundPolicy:refundPolicy!,
      }) : await reconcileAuthenticatedJodloPlayRevocation(
      env.DB, authenticated,{
        accessToken,
        request:testOnly?.playRequest,
        now:()=>testOnly?.nowMs ?? Date.now(),
        ...(refundPolicy ? {refundPolicy} : {}),
      });
    if (result === "applied" || result === "replay")
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    return unavailable();
  } catch {
    return unavailable();
  }
}
