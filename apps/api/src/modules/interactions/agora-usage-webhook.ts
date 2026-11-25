import type {Env} from "../../data/d1.ts";
import {readBodyChunkUntil} from "../../http/body.ts";
import {CALL_USAGE_POLICY_VERSION,recordVerifiedCallInterval} from "./verified-call-usage.ts";

const HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"};
const result=(status:number,code:string)=>new Response(JSON.stringify({ok:status===200,
  ...(status===200?{data:{received:true}}:{error:{code,message:"Call usage unavailable"}})}),{status,headers:HEADERS});

export function callUsageConfigured(env:Env):boolean{
  return env.CALL_USAGE_ENABLED==="1"&&env.CALL_USAGE_POLICY_VERSION===CALL_USAGE_POLICY_VERSION&&
    /^[a-f0-9]{64}$/.test(env.CALL_USAGE_APPROVAL_SHA256??"")&&
    env.CALL_USAGE_APPROVAL_SHA256!=="0".repeat(64)&&
    typeof env.AGORA_NOTIFICATIONS_SECRET==="string"&&env.AGORA_NOTIFICATIONS_SECRET.length>=16&&
    env.AGORA_NOTIFICATIONS_SECRET.length<=256&&!!env.CALL_USAGE_LIMITER&&!!env.DB;
}

async function rawNotification(request:Request):Promise<Uint8Array|null>{
  if(request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()!=="application/json"||
    request.headers.has("Content-Encoding")||!request.body)return null;
  const length=request.headers.get("Content-Length");
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>16384))return null;
  const reader=request.body.getReader(),deadline=Date.now()+2500;
  const chunks:Uint8Array[]=[];let size=0,complete=false;
  try{
    while(true){const {done,value}=await readBodyChunkUntil(reader,deadline);if(done){complete=true;break;}
      size+=value?.byteLength??0;if(size>16384)return null;if(value)chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return bytes;
  }catch{return null;}finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Agora RTC Notifications uses HMAC SHA256 over the unchanged request bytes.
 * Source: https://docs-legacy.agora.io/en/broadcast-streaming/advanced-features/receive-notifications
 * Only RTC product 1 / communication-mode leave 108 supplies a duration.
 * Authentication precedes the shared quota; unsigned clients cannot consume
 * legitimate provider delivery capacity. No account IDs are accepted. */
export async function handleAgoraUsageWebhook(request:Request,env:Env,
  now=Date.now()):Promise<Response>{
  if(env.CALL_USAGE_ENABLED!=="1")return result(404,"NOT_FOUND");
  if(request.method!=="POST")return new Response(JSON.stringify({ok:false,error:{
    code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}}),{status:405,headers:{...HEADERS,Allow:"POST"}});
  if(new URL(request.url).search)return result(400,"INVALID_QUERY");
  if(!callUsageConfigured(env))return result(503,"SERVICE_UNAVAILABLE");
  const signature=request.headers.get("Agora-Signature-V2");
  if(!signature||!/^[a-fA-F0-9]{64}$/.test(signature))return result(401,"UNAUTHORIZED");
  try{
    const raw=await rawNotification(request);if(!raw)return result(400,"INVALID_QUERY");
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.AGORA_NOTIFICATIONS_SECRET!),
      {name:"HMAC",hash:"SHA-256"},false,["verify"]);
    const sig=new Uint8Array(signature.match(/../g)!.map(byte=>parseInt(byte,16)));
    if(!(await crypto.subtle.verify("HMAC",key,sig,raw)))return result(401,"UNAUTHORIZED");
    const body:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
    if(!body||typeof body!=="object"||Array.isArray(body))return result(400,"INVALID_QUERY");
    const data=body as Record<string,unknown>;
    if(data.productId!==1||!Number.isSafeInteger(data.eventType)||
      typeof data.noticeId!=="string"||data.noticeId.length<1||data.noticeId.length>160||
      !Number.isSafeInteger(data.notifyMs)||Math.abs(Number(data.notifyMs)-now)>300_000)
      return result(400,"INVALID_QUERY");
    // Ignore irrelevant authenticated notifications. Never interpret channel
    // creation, ringing, joins, client reports or call-history as a usage debit.
    if(data.eventType!==108)return result(200,"OK");
    const payload=data.payload;
    if(!payload||typeof payload!=="object"||Array.isArray(payload))return result(400,"INVALID_QUERY");
    const p=payload as Record<string,unknown>;
    // The signed Agora Console health check uses these exact fixed values.
    // Acknowledge it without quota, identity, evidence or credit writes so the
    // operator can finish provider setup. Signature/freshness checks above
    // remain mandatory; a public client cannot use this branch as a bypass.
    if(p.channelName==="test_webhook"&&p.uid===12121212)return result(200,"OK");
    const id=typeof p.channelName==="string"?p.channelName.match(/^jodlo-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/)?.[1]:null;
    if(!id||(p.uid!==1&&p.uid!==2)||!Number.isSafeInteger(p.clientSeq)||Number(p.clientSeq)<0||
      !Number.isSafeInteger(p.ts)||!Number.isSafeInteger(p.duration)||Number(p.duration)<0||
      Number(p.duration)>30000||Number(p.ts)<=Number(p.duration)||Number(p.ts)*1000>now+30000||
      !Number.isInteger(p.reason)||Number(p.reason)<0||Number(p.reason)>999)return result(400,"INVALID_QUERY");
    if(!(await env.CALL_USAGE_LIMITER!.limit({key:"agora-rtc-usage-v1"})).success)
      return new Response(JSON.stringify({ok:false,error:{code:"RATE_LIMITED",message:"Try again later"}}),
        {status:429,headers:{...HEADERS,"Retry-After":"10"}});
    await recordVerifiedCallInterval(env.DB!,{invitationId:id,uid:p.uid as 1|2,
      clientSeq:Number(p.clientSeq),startedAtSeconds:Number(p.ts)-Number(p.duration),
      endedAtSeconds:Number(p.ts),reason:Number(p.reason)},now);
    return result(200,"OK");
  }catch{return result(503,"SERVICE_UNAVAILABLE");}
}
