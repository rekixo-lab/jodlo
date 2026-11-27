import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {openLocalDatabase,localD1Adapter} from "./helpers/local-db.mjs";
import {runtimeConfigurationReadiness,runtimeSchemaReady} from "../src/modules/system/runtime-readiness.ts";
import {OPERATIONAL_FLAGS} from "../../../scripts/production-operations.mjs";

const limit={limit:async()=>({success:true})};
const key=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({format:"pem",type:"pkcs8"});
const full=DB=>({DB,...Object.fromEntries(OPERATIONAL_FLAGS.map(name=>[name,"1"])),
  GOOGLE_CLIENT_ID:"123456789012-jodlo-test.apps.googleusercontent.com",
  GOOGLE_ANDROID_CLIENT_ID:"123456789012-android-test.apps.googleusercontent.com",
  LOGIN_BURST_LIMITER:limit,ACCOUNT_LOGIN_LIMITER:limit,
  OPERATIONS_KEY:"a".repeat(64),OPERATIONS_LIMITER:limit,BUILD_COMMIT_SHA:"b".repeat(40),
  SERVICE_MODERATION_KEY:"c".repeat(64),ACCOUNT_ERASURE_RELEASE_KEY:"d".repeat(64),
  FCM_PROJECT_ID:"jodlo-offline-test",FCM_SERVICE_ACCOUNT_EMAIL:"push@jodlo-offline-test.iam.gserviceaccount.com",
  FCM_SERVICE_ACCOUNT_PRIVATE_KEY:key,AGORA_APP_CERTIFICATE:"a".repeat(32),
  AGORA_NOTIFICATIONS_SECRET:"offline-agora-notification-test-only",CALL_USAGE_LIMITER:limit,
  CALL_USAGE_POLICY_VERSION:"agora-overlap-v1",CALL_USAGE_APPROVAL_SHA256:"e".repeat(64),
  PLAY_SERVICE_ACCOUNT_EMAIL:"play@jodlo-offline-test.iam.gserviceaccount.com",PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:key,
  PLAY_RTDN_AUDIENCE:"https://api.jodlo.rekixo.com/api/v1/play/rtdn",
  PLAY_RTDN_PUSH_EMAIL:"rtdn@jodlo-offline-test.iam.gserviceaccount.com",
  PLAY_RTDN_SUBSCRIPTION:"projects/jodlo-offline-test/subscriptions/jodlo-rtdn",
  PLAY_RTDN_LIMITER:limit,PLAY_VERIFICATION_LIMITER:limit,PLAY_SETTLEMENT_LIMITER:limit,
  PLAY_SETTLEMENT_POLICY_VERSION:"jodlo-play-minutes-v1",PLAY_SETTLEMENT_APPROVAL_SHA256:"f".repeat(64),
  PLAY_REFUND_POLICY_VERSION:"jodlo-play-refund-hold-v1",PLAY_REFUND_APPROVAL_SHA256:"1".repeat(64),
  PLAY_LICENSE_TEST_ACCOUNT_BINDINGS:"2".repeat(64)+","+"3".repeat(64),
});
const fakeDb={prepare(){throw Error("configuration inspection must not access the database");}};

test("intentionally disabled features need no provider credentials and inspection performs no provider or quota calls",()=>{
  const result=runtimeConfigurationReadiness({DB:fakeDb});
  assert.deepEqual(result.configurationErrors,[]);
  assert.equal(result.licenseTest,false);
  assert.deepEqual(result.configured,{identity:false,calling:false,callUsage:false,refundHolds:false,playSettlement:false});
  const unused=runtimeConfigurationReadiness({DB:fakeDb,CALL_SIGNALING_ENABLED:"0",PLAY_VERIFICATION_ENABLED:"0",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY:"inactive private key",PLAY_SERVICE_ACCOUNT_PRIVATE_KEY:"inactive private key"});
  assert.deepEqual(unused.configurationErrors,[]);
});

test("complete explicit feature settings are configured with license tests separately visible",()=>{
  const env=full(fakeDb),result=runtimeConfigurationReadiness(env);
  assert.deepEqual(result.configurationErrors,[]);
  assert.equal(result.licenseTest,true);
  assert.ok(Object.values(result.configured).every(Boolean));
  for(const value of [key,env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS,env.OPERATIONS_KEY])
    assert.ok(!JSON.stringify(result).includes(value));
  env.PLAY_LICENSE_TEST_ENABLED="0";
  delete env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS;
  assert.deepEqual(runtimeConfigurationReadiness(env).configurationErrors,[]);
  assert.equal(runtimeConfigurationReadiness(env).licenseTest,false);
});

test("every operational flag rejects malformed enabled values instead of silently treating them as OFF",()=>{
  for(const name of OPERATIONAL_FLAGS)for(const value of ["",true,1,"true"," 1"]){
    const result=runtimeConfigurationReadiness({...full(fakeDb),[name]:value});
    assert.ok(result.configurationErrors.includes(name+"_INVALID"),name+" must fail closed");
  }
});

test("feature prerequisites and shared identity admission are required only for enabled user features",()=>{
  for(const [flag,dependency] of [
    ["CALL_SIGNALING_ENABLED","CALL_DEVICES_ENABLED"],["CALL_MEDIA_VERIFICATION_ENABLED","CALL_SIGNALING_ENABLED"],
    ["CALL_USAGE_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED"],["PLAY_ACCOUNT_VIEW_ENABLED","PLAY_CATALOG_ENABLED"],
    ["PLAY_VERIFICATION_ENABLED","PLAY_CATALOG_ENABLED"],["PLAY_SETTLEMENT_ENABLED","PLAY_RTDN_ENABLED"],
    ["PLAY_SETTLEMENT_ENABLED","PLAY_REFUND_HOLDS_ENABLED"],["PLAY_LICENSE_TEST_ENABLED","PLAY_SETTLEMENT_ENABLED"],
  ]){
    const result=runtimeConfigurationReadiness({...full(fakeDb),[dependency]:"0"});
    assert.ok(result.configurationErrors.includes(flag+"_REQUIRES_"+dependency));
  }
  for(const missing of ["GOOGLE_CLIENT_ID","LOGIN_BURST_LIMITER","ACCOUNT_LOGIN_LIMITER"]){
    const env=full(fakeDb);delete env[missing];
    assert.ok(runtimeConfigurationReadiness(env).configurationErrors.includes(missing+"_MISSING_OR_INVALID"));
  }
  const bad=runtimeConfigurationReadiness({DB:fakeDb,GOOGLE_CLIENT_ID:"not a Google client"});
  assert.ok(bad.configurationErrors.includes("GOOGLE_CLIENT_ID_MISSING_OR_INVALID"));
  assert.equal(bad.configured.identity,false);
});

test("provider secrets, public identities, policy versions and limiters fail as bounded stable codes without exposing values",()=>{
  for(const [name,value,code] of [
    ["BUILD_COMMIT_SHA","0".repeat(40),"BUILD_COMMIT_SHA_MISSING_OR_INVALID"],
    ["GOOGLE_ANDROID_CLIENT_ID","PRIVATE_BAD_CLIENT","GOOGLE_ANDROID_CLIENT_ID_INVALID"],
    ["SERVICE_MODERATION_KEY","PRIVATE_BAD_MODERATION","SERVICE_MODERATION_KEY_INVALID"],
    ["ACCOUNT_ERASURE_RELEASE_KEY","PRIVATE_BAD_ERASURE","ACCOUNT_ERASURE_RELEASE_KEY_INVALID"],
    ["OPERATIONS_KEY","PRIVATE_BAD_OPERATOR","OPERATIONS_KEY_MISSING_OR_INVALID"],
    ["FCM_PROJECT_ID","x".repeat(31),"FCM_PROJECT_ID_MISSING_OR_INVALID"],
    ["FCM_SERVICE_ACCOUNT_EMAIL","PRIVATE_FCM_EMAIL","FCM_SERVICE_ACCOUNT_EMAIL_MISSING_OR_INVALID"],
    ["FCM_SERVICE_ACCOUNT_PRIVATE_KEY","PRIVATE_BAD_FCM_KEY","FCM_SERVICE_ACCOUNT_PRIVATE_KEY_MISSING_OR_INVALID"],
    ["AGORA_APP_CERTIFICATE","PRIVATE_BAD_AGORA_KEY","AGORA_APP_CERTIFICATE_MISSING_OR_INVALID"],
    ["AGORA_NOTIFICATIONS_SECRET","PRIVATE_BAD\nUSAGE_SECRET","CALL_USAGE_CONFIGURATION_INVALID"],
    ["CALL_USAGE_POLICY_VERSION","PRIVATE_POLICY","CALL_USAGE_CONFIGURATION_INVALID"],
    ["CALL_USAGE_LIMITER",{},"CALL_USAGE_CONFIGURATION_INVALID"],
    ["PLAY_SERVICE_ACCOUNT_PRIVATE_KEY","PRIVATE_BAD_PLAY_KEY","PLAY_SERVICE_ACCOUNT_PRIVATE_KEY_MISSING_OR_INVALID"],
    ["PLAY_SERVICE_ACCOUNT_EMAIL","PRIVATE_PLAY_EMAIL","PLAY_SERVICE_ACCOUNT_EMAIL_MISSING_OR_INVALID"],
    ["PLAY_RTDN_AUDIENCE","https://unrelated.invalid/rtdn","PLAY_RTDN_IDENTITY_CONFIGURATION_INVALID"],
    ["PLAY_RTDN_PUSH_EMAIL","PRIVATE_PUBSUB_EMAIL","PLAY_RTDN_IDENTITY_CONFIGURATION_INVALID"],
    ["PLAY_RTDN_LIMITER",{},"PLAY_RTDN_LIMITER_MISSING_OR_INVALID"],
    ["PLAY_VERIFICATION_LIMITER",{},"PLAY_VERIFICATION_LIMITER_MISSING_OR_INVALID"],
    ["PLAY_SETTLEMENT_LIMITER",{},"PLAY_SETTLEMENT_CONFIGURATION_INVALID"],
    ["PLAY_REFUND_APPROVAL_SHA256","0".repeat(64),"PLAY_REFUND_POLICY_CONFIGURATION_INVALID"],
    ["PLAY_SETTLEMENT_POLICY_VERSION","PRIVATE_POLICY","PLAY_SETTLEMENT_CONFIGURATION_INVALID"],
    ["PLAY_LICENSE_TEST_ACCOUNT_BINDINGS","PRIVATE_BINDING","PLAY_LICENSE_TEST_ACCOUNT_BINDINGS_MISSING_OR_INVALID"],
  ]){
    const result=runtimeConfigurationReadiness({...full(fakeDb),[name]:value});
    assert.ok(result.configurationErrors.includes(code),name);
    assert.ok(result.configurationErrors.length<80);
    assert.ok(result.configurationErrors.every(error=>/^[A-Z0-9_]{1,128}$/.test(error)));
    if(typeof value==="string")assert.ok(!JSON.stringify(result).includes(value),name+" must remain private");
  }
});

test("runtime schema checks all current migrations without mutating rows",async()=>{
  const f=openLocalDatabase();
  try{
    const before=f.db.prepare("SELECT total_changes() AS n").get().n;
    assert.equal(await runtimeSchemaReady(f.adapter),true);
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n,before);
    for(const name of ["preserve_play_purchase_environment","end_call_after_listing_withdrawal",
      "immutable_pending_play_refund_review","bind_pending_play_refund_review"]){
      f.db.exec("BEGIN");
      try{f.db.exec("DROP TRIGGER "+name);assert.equal(await runtimeSchemaReady(f.adapter),false,name);}
      finally{f.db.exec("ROLLBACK");}
    }
    f.db.exec("BEGIN");
    try{
      f.db.exec("ALTER TABLE play_pending_refund_reviews RENAME COLUMN submission_started_at_ms TO missing_submission_start");
      assert.equal(await runtimeSchemaReady(f.adapter),false,"same-named tables and triggers cannot hide a missing submission-fence column");
    }finally{f.db.exec("ROLLBACK");}
  }finally{f.db.close();}
});

test("table presence and migration trigger names cannot hide a missing purchase-environment column",async()=>{
  const db=new DatabaseSync(":memory:");
  try{
    const folder=new URL("../../../infra/migrations/",import.meta.url);
    for(const name of readdirSync(folder).filter(name=>/^\d{4}_.*\.sql$/.test(name)).sort()){
      if(name.startsWith("0032_"))continue;
      db.exec(readFileSync(new URL(name,folder),"utf8"));
    }
    // A partially restored schema has all table names, including 0034, but
    // omits the forward column. Even misleading same-named trigger markers
    // must not make the actual required projection appear healthy.
    for(const name of ["preserve_play_purchase_environment","require_play_license_test_authority"])
      db.exec("CREATE TRIGGER "+name+" BEFORE UPDATE ON play_consume_outbox BEGIN SELECT 1; END");
    assert.equal(db.prepare("PRAGMA table_info(play_consume_outbox)").all().some(x=>x.name==="purchase_environment"),false);
    assert.equal(await runtimeSchemaReady(localD1Adapter(db)),false);
  }finally{db.close();}
});

test("missing runtime tables and D1 inspection failure never report a ready schema",async()=>{
  const db=new DatabaseSync(":memory:");
  try{assert.equal(await runtimeSchemaReady(localD1Adapter(db)),false);}finally{db.close();}
  assert.equal(await runtimeSchemaReady({prepare(){throw Error("private database failure");}}),false);
});
