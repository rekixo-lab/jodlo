/** Local-only operational configuration. No secret values, provider calls or
 * inferred approvals. All optional features and scheduled work default OFF.
 * Binding semantics: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 * Cron/log config: https://developers.cloudflare.com/workers/wrangler/configuration/
 */
export const OPERATIONAL_FLAGS=Object.freeze([
  "CONTACT_BLOCKS_ENABLED","CALL_HISTORY_ENABLED","CALL_DEVICES_ENABLED",
  "CALL_SIGNALING_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED","CALL_USAGE_ENABLED",
  "PLAY_CATALOG_ENABLED","PLAY_ACCOUNT_VIEW_ENABLED","PLAY_VERIFICATION_ENABLED",
  "PLAY_SETTLEMENT_ENABLED","PLAY_RTDN_ENABLED","PLAY_REFUND_HOLDS_ENABLED","OPERATIONS_ENABLED",
]);
export const OPTIONAL_LIMITERS=Object.freeze({
  PLAY_VERIFICATION_LIMITER:{limit:6,period:60},
  PLAY_SETTLEMENT_LIMITER:{limit:6,period:60},
  PLAY_RTDN_LIMITER:{limit:120,period:60},
  CALL_USAGE_LIMITER:{limit:120,period:60},
  OPERATIONS_LIMITER:{limit:30,period:60},
});
export const PUBLIC_OPERATION_VARS=Object.freeze([
  "GOOGLE_CLIENT_ID","GOOGLE_ANDROID_CLIENT_ID","FCM_PROJECT_ID","FCM_SERVICE_ACCOUNT_EMAIL",
  "PLAY_SERVICE_ACCOUNT_EMAIL","PLAY_RTDN_AUDIENCE","PLAY_RTDN_PUSH_EMAIL","PLAY_RTDN_SUBSCRIPTION",
  "PLAY_SETTLEMENT_POLICY_VERSION","PLAY_SETTLEMENT_APPROVAL_SHA256",
  "CALL_USAGE_POLICY_VERSION","CALL_USAGE_APPROVAL_SHA256",
  "PLAY_REFUND_POLICY_VERSION","PLAY_REFUND_APPROVAL_SHA256","BUILD_COMMIT_SHA",
]);
const exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join("|")===keys.slice().sort().join("|");
function namespace(v){return typeof v==="string"&&/^[1-9][0-9]{0,9}$/.test(v)&&Number(v)<=2147483647&&v!=="1001"&&v!=="1002";}
function publicValue(name,value){
  if(typeof value!=="string"||value!==value.trim()||!value||value.length>300||/[\u0000-\u001f\u007f]/u.test(value))return false;
  if(name.endsWith("APPROVAL_SHA256"))return /^[a-f0-9]{64}$/.test(value)&&!/^0+$/.test(value);
  if(name.endsWith("POLICY_VERSION"))return value===({PLAY_SETTLEMENT_POLICY_VERSION:"jodlo-play-minutes-v1",CALL_USAGE_POLICY_VERSION:"agora-overlap-v1",PLAY_REFUND_POLICY_VERSION:"jodlo-play-refund-hold-v1"}[name]);
  if(name==="BUILD_COMMIT_SHA")return /^[a-f0-9]{40}$/.test(value)&&!/^0+$/.test(value);
  if(name==="GOOGLE_CLIENT_ID"||name==="GOOGLE_ANDROID_CLIENT_ID")return /^[0-9]{6,32}-[a-z0-9-]{5,100}\.apps\.googleusercontent\.com$/.test(value);
  if(name==="FCM_PROJECT_ID")return /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value);
  if(name.endsWith("EMAIL"))return /^[a-z0-9][a-z0-9._-]{1,100}@[a-z][a-z0-9-]{4,61}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value);
  if(name==="PLAY_RTDN_AUDIENCE")return value==="https://api.jodlo.rekixo.com/api/v1/play/rtdn";
  if(name==="PLAY_RTDN_SUBSCRIPTION")return /^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(value);
  return false;
}
export function productionOperationsTemplate(){
  return {kind:"JODLO_PRODUCTION_OPERATIONS_V1",flags:Object.fromEntries(OPERATIONAL_FLAGS.map(k=>[k,"0"])),
    publicVars:Object.fromEntries(PUBLIC_OPERATION_VARS.map(k=>[k,""])),
    rateNamespaces:Object.fromEntries(Object.keys(OPTIONAL_LIMITERS).map(k=>[k,""])),
    schedules:{historyCleanup:false,callUsageSettlement:false},observability:{enabled:false,samplingRate:0.1}};
}
/** Validate generated optional config, including unsafe hand edits. */
export function verifyOperationalFields(config){
  const optional=config.ratelimits?.slice(2)??[];
  const seen=new Set();
  for(const item of optional){
    const policy=OPTIONAL_LIMITERS[item?.name];
    if(!policy||seen.has(item.name)||!exact(item,["name","namespace_id","simple"])||!namespace(item.namespace_id)||
        !exact(item.simple,["limit","period"])||item.simple.limit!==policy.limit||item.simple.period!==policy.period)
      throw Error("Unreviewed optional rate limiter");
    seen.add(item.name);
  }
  const ids=(config.ratelimits??[]).map(x=>x.namespace_id);
  if(new Set(ids).size!==ids.length)throw Error("Every production rate limiter needs a distinct namespace");
  const vars=config.vars??{};
  if(!vars||typeof vars!=="object"||Array.isArray(vars))throw Error("Invalid production public variables");
  for(const [name,value] of Object.entries(vars)){
    if(OPERATIONAL_FLAGS.includes(name)){
      if(value!=="0"&&value!=="1")throw Error("Feature flags must be explicit strings 0 or 1");
    }else if(!PUBLIC_OPERATION_VARS.includes(name)||!publicValue(name,value))throw Error("Unknown/secret/invalid public operational variable");
  }
  if(config.triggers!==undefined&&(!exact(config.triggers,["crons"])||!Array.isArray(config.triggers.crons)||
    config.triggers.crons.some(c=>!["17 * * * *","* * * * *"].includes(c))||new Set(config.triggers.crons).size!==config.triggers.crons.length))
    throw Error("Only reviewed history and usage schedules are supported");
  if(config.observability!==undefined){
    const o=config.observability;
    if(!exact(o,["enabled","head_sampling_rate","logs"])||typeof o.enabled!=="boolean"||
       typeof o.head_sampling_rate!=="number"||!Number.isFinite(o.head_sampling_rate)||o.head_sampling_rate<=0||o.head_sampling_rate>1||
       !exact(o.logs,["invocation_logs"])||o.logs.invocation_logs!==false)
      throw Error("Use sampled app logs with invocation URL logging disabled");
  }
  const enabled=name=>vars[name]==="1";
  const requireVars=names=>{if(names.some(name=>!vars[name]))throw Error("Enabled feature is missing public provider/policy settings");};
  const requireFlags=names=>{if(names.some(name=>!enabled(name)))throw Error("Enabled feature is missing dependent feature flags");};
  if(enabled("CALL_HISTORY_ENABLED")&&!config.triggers?.crons.includes("17 * * * *"))throw Error("Call history requires its retention schedule");
  if(enabled("CALL_SIGNALING_ENABLED")){
    requireFlags(["CALL_DEVICES_ENABLED"]);requireVars(["GOOGLE_CLIENT_ID","FCM_PROJECT_ID","FCM_SERVICE_ACCOUNT_EMAIL"]);
  }
  if(enabled("CALL_MEDIA_VERIFICATION_ENABLED"))requireFlags(["CALL_SIGNALING_ENABLED"]);
  if(enabled("CALL_USAGE_ENABLED")){
    requireFlags(["CALL_SIGNALING_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED"]);
    requireVars(["CALL_USAGE_POLICY_VERSION","CALL_USAGE_APPROVAL_SHA256"]);
    if(!seen.has("CALL_USAGE_LIMITER")||!config.triggers?.crons.includes("* * * * *"))throw Error("Verified call usage requires limiter and settlement schedule");
  }
  if(enabled("PLAY_ACCOUNT_VIEW_ENABLED"))requireFlags(["PLAY_CATALOG_ENABLED"]);
  if(enabled("PLAY_VERIFICATION_ENABLED")){
    requireFlags(["PLAY_CATALOG_ENABLED"]);requireVars(["PLAY_SERVICE_ACCOUNT_EMAIL"]);
    if(!seen.has("PLAY_VERIFICATION_LIMITER"))throw Error("Play verification requires a dedicated limiter");
  }
  if(enabled("PLAY_RTDN_ENABLED")){
    requireVars(["PLAY_SERVICE_ACCOUNT_EMAIL","PLAY_RTDN_AUDIENCE","PLAY_RTDN_PUSH_EMAIL","PLAY_RTDN_SUBSCRIPTION"]);
    if(!seen.has("PLAY_RTDN_LIMITER"))throw Error("Play RTDN requires a dedicated limiter");
  }
  if(enabled("PLAY_SETTLEMENT_ENABLED")){
    requireFlags(["PLAY_CATALOG_ENABLED","PLAY_ACCOUNT_VIEW_ENABLED","PLAY_VERIFICATION_ENABLED","PLAY_RTDN_ENABLED","PLAY_REFUND_HOLDS_ENABLED"]);
    requireVars(["PLAY_SETTLEMENT_POLICY_VERSION","PLAY_SETTLEMENT_APPROVAL_SHA256"]);
    if(!seen.has("PLAY_SETTLEMENT_LIMITER"))throw Error("Play settlement requires a dedicated limiter");
  }
  if(enabled("PLAY_REFUND_HOLDS_ENABLED"))requireVars(["PLAY_REFUND_POLICY_VERSION","PLAY_REFUND_APPROVAL_SHA256"]);
  if(enabled("OPERATIONS_ENABLED")){
    requireVars(["BUILD_COMMIT_SHA"]);
    if(!seen.has("OPERATIONS_LIMITER"))throw Error("Operations require a dedicated limiter");
  }
}
export function applyOperationalSettings(config,settings){
  if(!exact(settings,["kind","flags","publicVars","rateNamespaces","schedules","observability"])||settings.kind!=="JODLO_PRODUCTION_OPERATIONS_V1"||
      !exact(settings.flags,OPERATIONAL_FLAGS)||!exact(settings.schedules,["historyCleanup","callUsageSettlement"])||
      typeof settings.schedules.historyCleanup!=="boolean"||typeof settings.schedules.callUsageSettlement!=="boolean"||
      !exact(settings.observability,["enabled","samplingRate"]))throw Error("Invalid operational settings manifest");
  for(const name of ["publicVars","rateNamespaces"])if(!settings[name]||typeof settings[name]!=="object"||Array.isArray(settings[name]))throw Error("Invalid "+name);
  if(Object.keys(settings.publicVars).some(k=>!PUBLIC_OPERATION_VARS.includes(k))||Object.keys(settings.rateNamespaces).some(k=>!Object.hasOwn(OPTIONAL_LIMITERS,k)))throw Error("Unknown operational setting or secret");
  const vars={...settings.flags};
  for(const [name,value] of Object.entries(settings.publicVars))if(value!=="")vars[name]=value;
  const limiters=[];
  for(const [name,value] of Object.entries(settings.rateNamespaces)){
    if(value==="")continue;
    if(!namespace(value))throw Error("Use a real operator-selected rate namespace");
    limiters.push({name,namespace_id:value,simple:{...OPTIONAL_LIMITERS[name]}});
  }
  const out={...structuredClone(config),vars,ratelimits:[...structuredClone(config.ratelimits.slice(0,2)),...limiters],
    triggers:{crons:[...(settings.schedules.historyCleanup?["17 * * * *"]:[]),...(settings.schedules.callUsageSettlement?["* * * * *"]:[])]},
    observability:{enabled:settings.observability.enabled,head_sampling_rate:settings.observability.samplingRate,logs:{invocation_logs:false}}};
  verifyOperationalFields(out);return out;
}
/** Names only; this tool never reads or stores provider secret values. */
export function requiredOperationalSecrets(config){
  const v=config.vars??{},out=[];
  if(v.CALL_SIGNALING_ENABLED==="1")out.push("FCM_SERVICE_ACCOUNT_PRIVATE_KEY");
  if(v.CALL_MEDIA_VERIFICATION_ENABLED==="1")out.push("AGORA_APP_CERTIFICATE");
  if(v.CALL_USAGE_ENABLED==="1")out.push("AGORA_NOTIFICATIONS_SECRET");
  if(v.PLAY_VERIFICATION_ENABLED==="1"||v.PLAY_RTDN_ENABLED==="1")out.push("PLAY_SERVICE_ACCOUNT_PRIVATE_KEY");
  if(v.OPERATIONS_ENABLED==="1")out.push("OPERATIONS_KEY");
  return out;
}
