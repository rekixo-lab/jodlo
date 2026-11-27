import test from "node:test";
import assert from "node:assert/strict";
import {productionOperationsTemplate,applyOperationalSettings,verifyOperationalFields,requiredOperationalSecrets,OPTIONAL_LIMITERS} from "./production-operations.mjs";
import {buildProductionConfig,verifyProductionConfig} from "./prepare-production-wrangler.mjs";
import {buildDomainConfig,verifyDomainConfig,refreshDomainConfig} from "./prepare-api-custom-domain.mjs";

const base=()=>buildProductionConfig({JODLO_CF_ACCOUNT_ID:"a13579bdf02468ace2468bdf13579abc",JODLO_D1_DATABASE_ID:"31a5b79d-2468-4123-9def-c16aef248062",JODLO_LOGIN_BURST_NAMESPACE_ID:"45130001",JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:"45130002"},
  {name:"jodlo-api",main:"src/index.ts",compatibility_date:"2026-10-27",workers_dev:false,send_metrics:false});
function full(){
  const s=productionOperationsTemplate();for(const k of Object.keys(s.flags))s.flags[k]="1";
  s.publicVars={GOOGLE_CLIENT_ID:"123456789012-jodlo-test.apps.googleusercontent.com",GOOGLE_ANDROID_CLIENT_ID:"123456789012-android-test.apps.googleusercontent.com",
    FCM_PROJECT_ID:"jodlo-test-project",FCM_SERVICE_ACCOUNT_EMAIL:"push@jodlo-test-project.iam.gserviceaccount.com",
    PLAY_SERVICE_ACCOUNT_EMAIL:"play@jodlo-test-project.iam.gserviceaccount.com",PLAY_RTDN_AUDIENCE:"https://api.jodlo.rekixo.com/api/v1/play/rtdn",
    PLAY_RTDN_PUSH_EMAIL:"rtdn@jodlo-test-project.iam.gserviceaccount.com",PLAY_RTDN_SUBSCRIPTION:"projects/jodlo-test-project/subscriptions/jodlo-rtdn",
    PLAY_SETTLEMENT_POLICY_VERSION:"jodlo-play-minutes-v1",PLAY_SETTLEMENT_APPROVAL_SHA256:"1".repeat(64),
    CALL_USAGE_POLICY_VERSION:"agora-overlap-v1",CALL_USAGE_APPROVAL_SHA256:"2".repeat(64),
    PLAY_REFUND_POLICY_VERSION:"jodlo-play-refund-hold-v1",PLAY_REFUND_APPROVAL_SHA256:"3".repeat(64),BUILD_COMMIT_SHA:"4".repeat(40)};
  s.rateNamespaces=Object.fromEntries(Object.keys(OPTIONAL_LIMITERS).map((k,i)=>[k,String(45130003+i)]));
  s.schedules={historyCleanup:true,callUsageSettlement:true};s.observability.enabled=true;return s;
}
test("template keeps every optional capability, schedule and logging OFF without dummy provider IDs",()=>{
  const s=productionOperationsTemplate(),c=applyOperationalSettings(base(),s);
  assert.ok(Object.values(c.vars).every(v=>v==="0"));assert.equal(c.ratelimits.length,2);
  assert.deepEqual(c.triggers,{crons:[]});assert.equal(c.observability.enabled,false);
  assert.equal(c.observability.logs.invocation_logs,false);
  assert.deepEqual(requiredOperationalSecrets(c),["SERVICE_MODERATION_KEY","ACCOUNT_ERASURE_RELEASE_KEY"]);
  assert.deepEqual(verifyProductionConfig(c),verifyProductionConfig(base()));
});
test("complete owner settings produce all seven distinct limiters and exact runtime schedules, without storing secret values",()=>{
  const input=base(),before=structuredClone(input),c=applyOperationalSettings(input,full());
  verifyProductionConfig(c);assert.deepEqual(input,before);
  assert.equal(c.ratelimits.length,7);assert.equal(new Set(c.ratelimits.map(x=>x.namespace_id)).size,7);
  assert.deepEqual(c.triggers.crons,["17 * * * *","* * * * *"]);
  assert.deepEqual(requiredOperationalSecrets(c),["SERVICE_MODERATION_KEY","ACCOUNT_ERASURE_RELEASE_KEY","FCM_SERVICE_ACCOUNT_PRIVATE_KEY","AGORA_APP_CERTIFICATE","AGORA_NOTIFICATIONS_SECRET","PLAY_SERVICE_ACCOUNT_PRIVATE_KEY","PLAY_LICENSE_TEST_ACCOUNT_BINDINGS","OPERATIONS_KEY"]);
  assert.equal(c.observability.logs.invocation_logs,false);
  assert.equal(JSON.stringify(c).includes("PRIVATE_KEY"),false);
  assert.deepEqual(verifyDomainConfig(buildDomainConfig(c)),verifyProductionConfig(c));
});
test("feature dependencies, unique namespace counters and supported approval versions are mandatory",()=>{
  for(const mutation of [
    s=>{s.rateNamespaces.PLAY_SETTLEMENT_LIMITER="";},s=>{s.rateNamespaces.PLAY_RTDN_LIMITER=s.rateNamespaces.PLAY_VERIFICATION_LIMITER;},
    s=>{s.rateNamespaces.CALL_USAGE_LIMITER="45130001";},s=>{s.rateNamespaces.PLAY_RTDN_LIMITER="1001";},
    s=>{s.flags.PLAY_RTDN_ENABLED="0";},s=>{s.flags.PLAY_CATALOG_ENABLED="0";},s=>{s.flags.CALL_DEVICES_ENABLED="0";},
    s=>{s.flags.PLAY_SETTLEMENT_ENABLED="0";},
    s=>{s.publicVars.PLAY_SETTLEMENT_APPROVAL_SHA256="0".repeat(64);},s=>{s.publicVars.CALL_USAGE_POLICY_VERSION="invented";},
    s=>{s.publicVars.PLAY_SETTLEMENT_POLICY_VERSION="future-version";},s=>{s.publicVars.PLAY_RTDN_AUDIENCE="https://other.example";},
    s=>{s.publicVars.FCM_PROJECT_ID="a".repeat(31);},
    s=>{s.publicVars.PLAY_RTDN_PUSH_EMAIL="xy@jodlo-test-project.iam.gserviceaccount.com";},
    s=>{s.publicVars.PLAY_RTDN_SUBSCRIPTION="projects/jodlo-test-project/subscriptions/"+"a".repeat(202);},
    s=>{s.publicVars.GOOGLE_CLIENT_ID="";},s=>{s.schedules.callUsageSettlement=false;},s=>{s.schedules.historyCleanup=false;},
    s=>{s.flags.CALL_HISTORY_ENABLED=true;},s=>{s.publicVars.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY="do not store me";},
    s=>{s.publicVars.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS="f".repeat(64);},
    s=>{s.rateNamespaces.UNKNOWN_LIMITER="8888";},s=>{s.observability.samplingRate=0;},s=>{s.observability.samplingRate=Infinity;},
  ]){const s=full();mutation(s);assert.throws(()=>applyOperationalSettings(base(),s));}
});
test("post-generation tampering and invocation URL logging fail the regular config validator",()=>{
  for(const mutation of [
    c=>{c.vars.PRIVATE_KEY="secret";},c=>{c.ratelimits[2].simple.limit=9999;},
    c=>{c.observability.logs.invocation_logs=true;},c=>{c.triggers.crons=["0 0 * * *"];},
    c=>{c.vars.CALL_USAGE_APPROVAL_SHA256="bad";},c=>{c.vars.PLAY_VERIFICATION_ENABLED="0";},
  ]){const c=applyOperationalSettings(base(),full());mutation(c);assert.throws(()=>verifyProductionConfig(c));}
});
test("domain refresh preserves actual account ownership and incorporates all operational settings",()=>{
  const old=buildDomainConfig(base()),configured=applyOperationalSettings(base(),full());
  const refreshed=refreshDomainConfig(old,configured);
  assert.deepEqual(refreshed,buildDomainConfig(configured));
  const wrong=structuredClone(configured);wrong.account_id="b".repeat(32);
  assert.throws(()=>refreshDomainConfig(old,wrong));
  const other=structuredClone(configured);other.d1_databases[0].database_id="41a5b79d-2468-4123-9def-c16aef248062";
  assert.throws(()=>refreshDomainConfig(old,other));
});
