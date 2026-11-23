import type { Env } from "../../data/d1.ts";
import {findSessionAccount, sessionHash, validSessionToken} from "../identity/sessions.ts";
import {jodloPlayAccountBinding} from "./google-play-purchase-preflight.ts";
import {jodloPlayMinuteProductMap} from "./play-minute-packs.ts";
import {inspectJodloPlayPurchaseWithVoids} from "./google-play-voided-preflight.ts";
import {createPlayAndroidPublisherAccessTokenSource} from "./google-play-androidpublisher-oauth.ts";
import {hasEmptyBody, readPlayPurchaseTokenBody} from "../../http/body.ts";

const HEADERS: Record<string,string> = {
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
};
const reply = (status:number, ok:boolean, data:unknown) =>
  new Response(JSON.stringify(ok?{ok:true,data}:{ok:false,error:data}),{
    status,headers:HEADERS,
  });
const failure=(status:number,code:string)=>reply(status,false,{
  code,message:"Play verification unavailable",
});

/**
 * A complete, read-only owner-bound proof transport:
 * GET  -- returns a hashed JODLO account binding for future Play billing flows.
 * POST -- checks a single transient purchase token against the server's
 * signed-in JODLO account, Google's ProductPurchaseV2 and a complete
 * bounded recent Voided Purchases scan.
 *
 * Owner authentication is revalidated after the rate limit, after a paused
 * request body and after Google network verification. A revoked/disabled
 * session cannot receive a delayed owner binding or purchase result.
 *
 * Neither result authorizes call credit. No D1 writes, token persistence,
 * Play acknowledgement/consume, or checkout are possible here. The router
 * never provides the test-only OAuth / Google request adapters.
 */
export async function handleConfiguredJodloPlayVerification(
  request:Request, env:Env,
  testOnly?:Readonly<{
    accessToken?:()=>Promise<string|null>;
    playRequest?:typeof fetch;
    now?:()=>number;
  }>,
):Promise<Response> {
  if(env.PLAY_VERIFICATION_ENABLED!=="1")
    return failure(404,"NOT_FOUND");
  if(request.method!=="GET"&&request.method!=="POST")
    return new Response(JSON.stringify({ok:false,error:{
      code:"METHOD_NOT_ALLOWED",message:"Method not allowed",
    }}),{status:405,headers:{...HEADERS,Allow:"GET, POST"}});
  if(new URL(request.url).search)
    return failure(400,"INVALID_QUERY");
  const match=request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  const bearer=match?.[1];
  if(!validSessionToken(bearer))
    return failure(401,"UNAUTHORIZED");
  // A single flag cannot bypass product setup, D1 identity, Google credentials
  // or abuse protection. Development Workers stay unconfigured by default.
  if(env.PLAY_CATALOG_ENABLED!=="1"||!env.DB||!env.PLAY_VERIFICATION_LIMITER||
     !env.PLAY_SERVICE_ACCOUNT_EMAIL||!env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY)
    return failure(503,"SERVICE_UNAVAILABLE");

  try{
    const owner=await findSessionAccount(env.DB,bearer);
    if(!owner)return failure(401,"UNAUTHORIZED");
    // Never rate-limit by raw bearer, email, account id or purchase token.
    const key="play-check-"+(await sessionHash(bearer)).slice(0,32);
    if(!(await env.PLAY_VERIFICATION_LIMITER.limit({key})).success)
      return new Response(JSON.stringify({ok:false,error:{
        code:"RATE_LIMITED",message:"Play verification temporarily limited",
      }}),{status:429,headers:{...HEADERS,"Retry-After":"60"}});
    // The limiter and request-body reader are asynchronous. Logout, account
    // disable or expiry may have occurred since the first session read.
    // Never begin a provider verification with a stale owner session.
    if(await findSessionAccount(env.DB,bearer)!==owner)
      return failure(401,"UNAUTHORIZED");
    if(request.method==="GET"){
      if(!(await hasEmptyBody(request)))return failure(400,"INVALID_QUERY");
      const accountBinding=await jodloPlayAccountBinding(owner);
      if(!accountBinding)return failure(503,"SERVICE_UNAVAILABLE");
      // No account binding may leave the Worker after logout or disable.
      if(await findSessionAccount(env.DB,bearer)!==owner)
        return failure(401,"UNAUTHORIZED");
      return reply(200,true,{accountBinding,verificationOnly:true});
    }
    const purchaseToken=await readPlayPurchaseTokenBody(request);
    if(!purchaseToken)return failure(400,"INVALID_QUERY");
    // A slow/paused POST upload is another revocation window. This check
    // precedes OAuth and all Google network calls.
    if(await findSessionAccount(env.DB,bearer)!==owner)
      return failure(401,"UNAUTHORIZED");
    const accessToken=testOnly?.accessToken ??
      createPlayAndroidPublisherAccessTokenSource({
        email:env.PLAY_SERVICE_ACCOUNT_EMAIL,
        privateKey:env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY,
      });
    const screened=await inspectJodloPlayPurchaseWithVoids(owner,purchaseToken,{
      approvedProducts:jodloPlayMinuteProductMap(),
      accessToken,
      request:testOnly?.playRequest,
      now:testOnly?.now,
    });
    // Google V2 and void-history reads can take seconds. Recheck the SAME
    // bearer against the SAME active owner before returning any screened
    // purchase status; another device's logout-all must win this race.
    // This is a read-only boundary, NOT entitlement settlement.
    if(await findSessionAccount(env.DB,bearer)!==owner)
      return failure(401,"UNAUTHORIZED");
    if(screened.kind==="unavailable"||screened.kind==="unconfigured")
      return failure(503,"SERVICE_UNAVAILABLE");
    if(screened.kind!=="screened_candidate")
      return reply(200,true,{status:"not_eligible"});
    const minutes=screened.seconds/60;
    // Deliberately omit the token and its fingerprint; even the good result
    // is a NON-AUTHORITATIVE screening response pending settlement policy.
    return reply(200,true,{
      status:"screened_pending_settlement",productId:screened.productId,minutes,
    });
  }catch{
    // Never echo Google replies, Play tokens, OAuth credentials or SQL errors.
    return failure(503,"SERVICE_UNAVAILABLE");
  }
}
