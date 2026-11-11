import type { Env } from "../../data/d1.ts";
import { authenticateJodloPlayPubSubPush } from "./google-play-pubsub-auth.ts";
import { reconcileAuthenticatedJodloPlayRevocation } from "./google-play-rtdn-reconciliation.ts";
import { createPlayAndroidPublisherAccessTokenSource } from
  "./google-play-androidpublisher-oauth.ts";
import type { JWTVerifyGetKey } from "jose";

/**
 * Default-OFF, narrowly scoped RTDN push ingress. This endpoint CANNOT
 * process purchases, grant minutes, acknowledge/consume purchases or debit a
 * refunded balance. Only independently Google-confirmed cancellation/void
 * records can create token-hash revocation fences in the local D1 schema.
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
    const limit = await env.PLAY_RTDN_LIMITER.limit({key:"google-play-rtdn"});
    if (!limit.success)
      return new Response(null,{
        status:429, headers:{"Retry-After":"60","Cache-Control":"no-store"},
      });
    const policy = {
      audience:env.PLAY_RTDN_AUDIENCE,
      email:env.PLAY_RTDN_PUSH_EMAIL,
      subscription:env.PLAY_RTDN_SUBSCRIPTION,
    };
    const authenticated = await authenticateJodloPlayPubSubPush(
      request, policy, testOnly?.nowMs ?? Date.now(),testOnly?.keys);
    if (authenticated.kind === "rejected")
      return new Response(null,{status:401,headers:{"Cache-Control":"no-store"}});
    if (authenticated.kind !== "authenticated")return unavailable();

    const accessToken = createPlayAndroidPublisherAccessTokenSource({
      email:env.PLAY_SERVICE_ACCOUNT_EMAIL,
      privateKey:env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY,
    },testOnly?.oauthRequest);
    const result = await reconcileAuthenticatedJodloPlayRevocation(
      env.DB, authenticated,{
        accessToken,
        request:testOnly?.playRequest,
        now:()=>testOnly?.nowMs ?? Date.now(),
      });
    if (result === "applied" || result === "replay")
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    return unavailable();
  } catch {
    return unavailable();
  }
}
