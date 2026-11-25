import type {Env} from "../../data/d1.ts";
import {readBodyChunkUntil,hasEmptyBody} from "../../http/body.ts";
import {equalOperatorSecret} from "../shared/secret-auth.ts";
import {callUsageConfigured} from "../interactions/agora-usage-webhook.ts";
import {configuredPlayRefundPolicy,listReviewedPlayRefundCases,releaseReviewedPlayRefundHold} from "../interactions/play-refund-review.ts";
import {playSettlementConfigured} from "../interactions/google-play-settlement-handler.ts";

const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(status===200?{ok:true,data}:
  {ok:false,error:{code:status===401?"UNAUTHORIZED":status===404?"NOT_FOUND":status===429?"RATE_LIMITED":
    status===400?"INVALID_QUERY":"SERVICE_UNAVAILABLE",message:"Operations request unavailable"}}),{status,headers});
const requiredTables=["auth_sessions","worker_listings","catalog_services","call_usage_sessions",
  "call_usage_intervals","play_consume_outbox","play_refund_reviews"];

async function resolutionBody(request:Request):Promise<{caseKey:string;evidenceSha256:string}|null>{
  if(request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json"||!request.body||
    request.headers.has("Content-Encoding"))return null;
  const reader=request.body.getReader();let value="",bytes=0,complete=false;
  const decoder=new TextDecoder("utf-8",{fatal:true}),deadline=Date.now()+2500;
  try{
    while(true){const part=await readBodyChunkUntil(reader,deadline);if(part.done){complete=true;break;}
      bytes+=part.value?.byteLength??0;if(bytes>512)return null;value+=decoder.decode(part.value,{stream:true});}
    value+=decoder.decode();
    // An exact two-field grammar rejects duplicate/escaped keys and extras.
    if(!/^\s*\{\s*"(?:caseKey|evidenceSha256)"\s*:\s*"[a-f0-9]{64}"\s*,\s*"(?:caseKey|evidenceSha256)"\s*:\s*"[a-f0-9]{64}"\s*\}\s*$/.test(value))return null;
    const parsed=JSON.parse(value);
    if(Object.keys(parsed).length!==2||typeof parsed.caseKey!=="string"||typeof parsed.evidenceSha256!=="string")return null;
    return parsed;
  }catch{return null;}finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Dedicated operator-only endpoints. Configured flags and database schema
 * are evidence of deployment configuration, never proof of provider/device QA.
 * A refund review release records human case evidence and does not refund a
 * bank payment, erase history, charge debt or recreate a revoked purchase. */
export async function handleOperations(request:Request,env:Env,now=Date.now()):Promise<Response>{
  if(env.OPERATIONS_ENABLED!=="1")return reply(404,null);
  const token=request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]??null;
  if(!equalOperatorSecret(token,env.OPERATIONS_KEY))return reply(401,null);
  if(!env.DB||!env.OPERATIONS_LIMITER)return reply(503,null);
  const url=new URL(request.url);
  try{
    if(!(await env.OPERATIONS_LIMITER.limit({key:"jodlo-operator-v1"})).success)return reply(429,null);
    if(url.pathname.endsWith("/readiness")){
      if(request.method!=="GET"||url.search||!(await hasEmptyBody(request)))return reply(400,null);
      const placeholders=requiredTables.map(()=>"?").join(",");
      const schema=await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`)
        .bind(...requiredTables).all<{name:string}>();
      const schemaReady=schema.results.length===requiredTables.length;
      const configured={identity:!!(env.GOOGLE_CLIENT_ID&&env.LOGIN_BURST_LIMITER&&env.ACCOUNT_LOGIN_LIMITER),
        calling:env.CALL_SIGNALING_ENABLED==="1"&&env.CALL_DEVICES_ENABLED==="1"&&
          env.CALL_MEDIA_VERIFICATION_ENABLED==="1"&&!!(env.AGORA_APP_CERTIFICATE&&env.FCM_PROJECT_ID&&
            env.FCM_SERVICE_ACCOUNT_EMAIL&&env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY),
        callUsage:callUsageConfigured(env),refundHolds:!!configuredPlayRefundPolicy(env),
        playSettlement:playSettlementConfigured(env)};
      let queues:Record<string,number>|null=null;
      if(schemaReady){
        const count=await env.DB.prepare(`SELECT
          (SELECT count(*) FROM play_consume_outbox WHERE status IN('ready','sending','unknown')) AS pendingPurchases,
          (SELECT count(*) FROM play_refund_reviews WHERE state='open') AS refundReviews,
          (SELECT count(*) FROM call_usage_sessions WHERE state='active' AND settle_after_ms<?) AS overdueCallSettlements,
          (SELECT count(*) FROM call_usage_sessions WHERE evidence_conflict=1) AS conflictingCallEvidence`)
          .bind(now-120000).all<Record<string,number>>();
        queues=count.results[0]??null;
      }
      return reply(200,{sourceCommit:/^[a-f0-9]{40}$/.test(env.BUILD_COMMIT_SHA??"")?env.BUILD_COMMIT_SHA:null,
        schemaReady,configured,queues,evaluatedAtMs:now,providerAcceptance:"requires_external_evidence"});
    }
    if(url.pathname.endsWith("/refund-reviews")){
      const policy=configuredPlayRefundPolicy(env);if(!policy)return reply(503,null);
      if(request.method==="GET"){
        if(url.searchParams.size>(url.searchParams.has("after")?1:0)||!(await hasEmptyBody(request)))return reply(400,null);
        const after=url.searchParams.get("after")??undefined;
        if(after!==undefined&&!/^[a-f0-9]{64}$/.test(after))return reply(400,null);
        const cases=await listReviewedPlayRefundCases(env.DB,policy,after);
        return cases?reply(200,cases):reply(503,null);
      }
      if(request.method==="POST"&&!url.search){
        const input=await resolutionBody(request);if(!input)return reply(400,null);
        const resolution=await releaseReviewedPlayRefundHold(env.DB,{sourceKeyHash:input.caseKey,
          policy,resolutionEvidenceHash:input.evidenceSha256,resolvedAtMs:now});
        return reply(200,{status:resolution});
      }
      return reply(400,null);
    }
    return reply(404,null);
  }catch{return reply(503,null);}
}
