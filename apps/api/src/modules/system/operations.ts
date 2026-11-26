import type {Env} from "../../data/d1.ts";
import {readBodyChunkUntil,hasEmptyBody} from "../../http/body.ts";
import {equalOperatorSecret} from "../shared/secret-auth.ts";
import {configuredPlayRefundPolicy,canUsePlayRefundPolicy,listReviewedPlayRefundCases,releaseReviewedPlayRefundHold} from "../interactions/play-refund-review.ts";
import {listPendingPlayRefundReviews,recordPendingPlayRefundReviewOutcome,queuePendingPlayRefundReviewDecision} from "../interactions/play-pending-refund-review.ts";
import {runtimeConfigurationReadiness,runtimeSchemaReady} from "./runtime-readiness.ts";

const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(status===200?{ok:true,data}:
  {ok:false,error:{code:status===401?"UNAUTHORIZED":status===404?"NOT_FOUND":status===429?"RATE_LIMITED":
    status===400?"INVALID_QUERY":"SERVICE_UNAVAILABLE",message:"Operations request unavailable"}}),{status,headers});

type OperatorAction={caseKey:string;evidenceSha256:string}&(
  {kind:"record"}|{kind:"decision";refundPreference:"APPROVE"|"DECLINE"|"NEUTRAL";sampleContentProvided:boolean});
async function resolutionBody(request:Request,allowDecision=false):Promise<OperatorAction|null>{
  if(request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json"||!request.body||
    request.headers.has("Content-Encoding"))return null;
  const reader=request.body.getReader();let value="",bytes=0,complete=false;
  const decoder=new TextDecoder("utf-8",{fatal:true}),deadline=Date.now()+2500;
  try{
    while(true){const part=await readBodyChunkUntil(reader,deadline);if(part.done){complete=true;break;}
      bytes+=part.value?.byteLength??0;if(bytes>512)return null;value+=decoder.decode(part.value,{stream:true});}
    value+=decoder.decode();
    // Only literal, known fields and values are accepted. Checking written
    // key uniqueness before JSON parsing rejects duplicate/escaped keys.
    const field='(?:"(?:caseKey|evidenceSha256)"\\s*:\\s*"[a-f0-9]{64}"|"refundPreference"\\s*:\\s*"(?:APPROVE|DECLINE|NEUTRAL)"|"sampleContentProvided"\\s*:\\s*(?:true|false))';
    if(!new RegExp('^\\s*\\{\\s*'+field+'(?:\\s*,\\s*'+field+'){1,3}\\s*\\}\\s*$').test(value))return null;
    const fields=[...value.matchAll(/"([A-Za-z0-9]+)"\s*:/g)].map(match=>match[1]);
    if(new Set(fields).size!==fields.length)return null;
    const parsed=JSON.parse(value);
    if(typeof parsed.caseKey!=="string"||typeof parsed.evidenceSha256!=="string")return null;
    if(fields.length===2)return {kind:"record",caseKey:parsed.caseKey,evidenceSha256:parsed.evidenceSha256};
    if(allowDecision&&fields.length===4&&typeof parsed.sampleContentProvided==="boolean"&&
        ["APPROVE","DECLINE","NEUTRAL"].includes(parsed.refundPreference))
      return {kind:"decision",caseKey:parsed.caseKey,evidenceSha256:parsed.evidenceSha256,
        refundPreference:parsed.refundPreference,sampleContentProvided:parsed.sampleContentProvided};
    return null;
  }catch{return null;}finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Dedicated operator-only endpoints. Configured flags and database schema
 * are evidence of deployment configuration, never proof of provider/device QA.
 * A refund review release records human case evidence and does not refund a
 * bank payment, erase history, charge debt or recreate a revoked purchase.
 * A separate exact pending-review decision queues the operator's explicit
 * recommendation for one provider submission on authenticated RTDN redelivery;
 * this handler never sends the provider request itself. */
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
      const schemaReady=await runtimeSchemaReady(env.DB);
      const {configurationErrors,configured,licenseTest}=runtimeConfigurationReadiness(env);
      let queues:Record<string,number>|null=null;
      if(schemaReady){
        const policy=configuredPlayRefundPolicy(env);
        if(policy&&!await canUsePlayRefundPolicy(env.DB,policy)){
          configurationErrors.push("PLAY_REFUND_POLICY_REGISTRATION_CONFLICT");configurationErrors.sort();
          configured.refundHolds=false;configured.playSettlement=false;
        }
        // One snapshot and one aggregate scan of each queue, even as operator
        // monitoring expands to distinguish every unresolved submission state.
        const count=await env.DB.prepare(`SELECT purchases.*,holds.*,pending.*,calls.* FROM
          (SELECT
            COUNT(CASE WHEN purchase_environment='production' AND status IN('ready','sending','unknown') THEN 1 END) AS pendingPurchases,
            COUNT(CASE WHEN purchase_environment='license_test' THEN 1 END) AS licenseTestPurchases,
            COUNT(CASE WHEN purchase_environment='license_test' AND status IN('ready','sending','unknown') THEN 1 END) AS pendingLicenseTestPurchases
          FROM play_consume_outbox) AS purchases CROSS JOIN
          (SELECT
            COUNT(CASE WHEN o.purchase_environment='production' THEN 1 END) AS refundReviews,
            COUNT(CASE WHEN o.purchase_environment='license_test' THEN 1 END) AS licenseTestRefundReviews
          FROM play_refund_reviews r JOIN play_consume_outbox o ON o.source_key_hash=r.source_key_hash WHERE r.state='open') AS holds CROSS JOIN
          (SELECT
            COUNT(CASE WHEN purchase_environment='production' THEN 1 END) AS pendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' THEN 1 END) AS licenseTestPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='production' AND response_deadline_ms<=? THEN 1 END) AS overduePendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' AND response_deadline_ms<=? THEN 1 END) AS overdueLicenseTestPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='production' AND state='queued' THEN 1 END) AS queuedPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' AND state='queued' THEN 1 END) AS licenseTestQueuedPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='production' AND state='submitting' THEN 1 END) AS submittingPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' AND state='submitting' THEN 1 END) AS licenseTestSubmittingPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='production' AND state='unknown' THEN 1 END) AS unknownPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' AND state='unknown' THEN 1 END) AS licenseTestUnknownPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='production' AND state='expired' THEN 1 END) AS expiredPendingRefundReviews,
            COUNT(CASE WHEN purchase_environment='license_test' AND state='expired' THEN 1 END) AS licenseTestExpiredPendingRefundReviews
          FROM play_pending_refund_reviews WHERE state IN('open','queued','submitting','unknown','expired')) AS pending CROSS JOIN
          (SELECT
            COUNT(CASE WHEN state='active' AND settle_after_ms<? THEN 1 END) AS overdueCallSettlements,
            COUNT(CASE WHEN evidence_conflict=1 THEN 1 END) AS conflictingCallEvidence
          FROM call_usage_sessions) AS calls`)
          .bind(now,now,now-120000).all<Record<string,number>>();
        queues=count.results[0]??null;
      }
      return reply(200,{sourceCommit:/^[a-f0-9]{40}$/.test(env.BUILD_COMMIT_SHA??"")&&env.BUILD_COMMIT_SHA!=="0".repeat(40)?env.BUILD_COMMIT_SHA:null,
        schemaReady,readiness:{ready:schemaReady&&configurationErrors.length===0,configurationErrors},
        configured,licenseTest,queues,evaluatedAtMs:now,providerAcceptance:"requires_external_evidence"});
    }
    if(url.pathname.endsWith("/pending-refund-reviews")){
      const policy=configuredPlayRefundPolicy(env);if(!policy)return reply(503,null);
      if(request.method==="GET"){
        if(url.searchParams.size>(url.searchParams.has("after")?1:0)||!(await hasEmptyBody(request)))return reply(400,null);
        const after=url.searchParams.get("after")??null;
        if(after!==null&&!/^[a-f0-9]{64}$/.test(after))return reply(400,null);
        const cases=await listPendingPlayRefundReviews(env.DB,policy,after,now);
        return cases?reply(200,cases):reply(503,null);
      }
      if(request.method==="POST"&&!url.search){
        const input=await resolutionBody(request,true);if(!input)return reply(400,null);
        if(input.kind==="decision"){
          if(env.PLAY_RTDN_ENABLED!=="1")return reply(503,null);
          const decision=await queuePendingPlayRefundReviewDecision(env.DB,{caseId:input.caseKey,policy,
            refundPreference:input.refundPreference,sampleContentProvided:input.sampleContentProvided,
            decisionEvidenceHash:input.evidenceSha256,decidedAtMs:now});
          return reply(200,{status:decision,providerAction:decision==="applied"?
            "queued_single_recommendation_on_authenticated_rtdn_redelivery":decision==="replay"?
            "existing_decision_kept_no_new_submission":"not_queued"});
        }
        const resolution=await recordPendingPlayRefundReviewOutcome(env.DB,{caseId:input.caseKey,
          policy,resolutionEvidenceHash:input.evidenceSha256,reviewedAtMs:now});
        return reply(200,{status:resolution,providerAction:"recorded_external_review_only"});
      }
      return reply(400,null);
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
